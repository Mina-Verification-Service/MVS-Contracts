import { MVSContractV2, MVSMerkleWitnessV2, MVSProofGen } from '../build/src';
import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  Bool,
  verify,
} from 'o1js';
import { ZKDatabaseStorage } from 'zkdb';
import * as fs from 'fs';

let proofsEnabled = false;
const merkleHeight = 20;

describe('MVS PROOF TESTS', () => {
  let controllerAccount: PublicKey,
    controllerKey: PrivateKey,
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey,
    zkApp: MVSContractV2,
    zkdb: ZKDatabaseStorage;

  const Local = Mina.LocalBlockchain({ proofsEnabled });
  Mina.setActiveInstance(Local);

  const dbLocation = './database';

  async function cleanup() {
    if (fs.existsSync(dbLocation)) {
      fs.rmSync(dbLocation, { recursive: true, force: true });
    }
  }

  async function localDeploy() {
    ({ privateKey: controllerKey, publicKey: controllerAccount } =
      Local.testAccounts[0]);

    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    zkApp = new MVSContractV2(zkAppAddress);

    // initialize the zkdb storage
    await cleanup();
    zkdb = await ZKDatabaseStorage.getInstance('mvs', {
      storageEngine: 'local',
      merkleHeight,
      storageEngineCfg: {
        location: dbLocation,
      },
    });

    // get storage root from zkdb instance
    const storageRoot = await zkdb.getMerkleRoot();
    const txn = await Mina.transaction(controllerAccount, () => {
      AccountUpdate.fundNewAccount(controllerAccount);
      zkApp.deploy();
      zkApp.setZkdbRoot(storageRoot);
    });

    await txn.prove();
    await txn.sign([controllerKey, zkAppPrivateKey]).send();
  }

  beforeAll(async () => {
    if (proofsEnabled) await MVSContractV2.compile();
    await localDeploy();
  });

  it('should generate valid proof if ml result is true', async () => {
    // get curr of users
    const userCount = zkApp.numOfUsers.get();

    // get witness for user index
    const witness = new MVSMerkleWitnessV2(
      await zkdb.getWitnessByIndex(userCount.toBigInt())
    );

    let commitment = zkApp.storageRoot.get();

    let publicInput = Field.fromFields(witness.toFields());

    const { verificationKey } = await MVSProofGen.compile();

    const userProof = await MVSProofGen.getProof(
      publicInput,
      commitment,
      Bool(true)
    );

    const ok = await verify(userProof.toJSON(), verificationKey);

    expect(ok).toBeTruthy();
  });
});
