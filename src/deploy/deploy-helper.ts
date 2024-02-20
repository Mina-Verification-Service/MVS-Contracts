/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  fetchAccount,
  VerificationKey,
  Field,
} from 'o1js';
import { MVSContract } from '../mvsV1.js';
import { makeRequest } from './test-helper.js';
import XMLHttpRequestTs from 'xmlhttprequest-ts';

const SERVER_ENDPOINT = 'http://localhost:1234/zkdb/';

const NodeXMLHttpRequest =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  XMLHttpRequestTs.XMLHttpRequest as any as typeof XMLHttpRequest;

const CONTRACTS: any = {
  MVSv1: MVSContract,
};

const DEPLOY_TX_FEE = 300_000_000;
const INITIAL_FEE = 10_000_000_000;

export async function deployContract(
  name: string,
  deployerAccount: PublicKey,
  deployerKey: PrivateKey,
  proofsEnabled: boolean
): Promise<any> {
  // if proofsEnabled we need to compile first !
  if (proofsEnabled) {
    console.log(`\nCompiling ${name}Contract ..`);
    const { verificationKey } = await CONTRACTS[
      name as keyof typeof CONTRACTS
    ].compile();
    console.log(
      `zkApp verificationKey=${(
        verificationKey as VerificationKey
      ).hash.toString()}`
    );
    console.log(`compiled done !`);
  }

  console.log(`\nDeploying '${name} Contract' ...`);

  // we need to generate a new key pair for each deploy !
  const zkAppKey = PrivateKey.random();
  const zkAppAddr = zkAppKey.toPublicKey();
  console.log(`zkApp instance Addr=${zkAppAddr.toBase58()}`);
  console.log(`zkApp instance Key=${zkAppKey.toBase58()}`);

  let zkApp = new CONTRACTS[name](zkAppAddr);
  console.log(`zkApp instance created for ${name}Contract`);

  await fetchAccount({ publicKey: deployerAccount });

  const zkdbRoot = await getZKDBRoot();

  // deploy it
  let txn = await Mina.transaction(
    { sender: deployerAccount, fee: DEPLOY_TX_FEE },
    () => {
      // IMPORTANT: the deployer account must already be funded
      // or this will fail miserably ughhh
      AccountUpdate.fundNewAccount(deployerAccount).send({
        to: zkAppAddr,
        amount: INITIAL_FEE,
      });
      // NOTE: this calls `init()` if this is the first deploy
      zkApp.deploy();
      zkApp.setZkdbCommitment(Field(zkdbRoot));
    }
  );
  await txn.prove();

  // this tx needs .sign(), because `deploy()` adds an account update
  // that requires signature authorization
  await txn.sign([deployerKey, zkAppKey]).send();
  console.log('zkApp instance deployed !');

  // wait for account ...
  await fetchAccount({ publicKey: zkAppAddr });
  console.log('zkApp account exists !');

  await loopUntilAccountExists({
    account: zkAppAddr,
    eachTimeNotExist: () => {
      console.log('... waiting for zkApp account to be fully available ...');
    },
    isZkAppAccount: true,
  });
  console.log('zkApp is available now !');

  return zkApp;
}

async function getZKDBRoot() {
  // fetch database root from storage
  const response = await makeRequest(
    'GET',
    SERVER_ENDPOINT + 'getDBRoot',
    null,
    NodeXMLHttpRequest
  );

  return JSON.parse(response);
}

async function loopUntilAccountExists({
  account,
  eachTimeNotExist,
  isZkAppAccount,
}: {
  account: PublicKey;
  eachTimeNotExist: () => void;
  isZkAppAccount: boolean;
}) {
  for (;;) {
    let response = await fetchAccount({ publicKey: account });
    let accountExists = response.account !== undefined;

    if (isZkAppAccount) {
      // CHANGED: accountExists = response.account?.appState !== undefined;
      accountExists = response.account?.zkapp?.appState !== undefined;
    }
    console.log('account exists ? ', accountExists);

    if (!accountExists) {
      eachTimeNotExist();
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } else {
      // TODO add optional check that verification key is correct once this is available in SnarkyJS
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return response.account!;
    }
  }
}
