import {
  MVSContractV2,
  MVSMerkleWitnessV2,
  MVSProofGen,
  ProofRecord,
} from '../build/src';
import {
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  Bool,
  verify,
  CircuitString,
  Provable,
  JsonProof,
  Encoding,
} from 'o1js';
import { ZKDatabaseStorage } from 'zkdb';
import * as fs from 'fs';

let proofsEnabled = false;
const merkleHeight = 20;

describe('MVS PROOF TESTS', () => {
  let controllerAccount: PublicKey,
    controllerKey: PrivateKey,
    userAccount: PublicKey,
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
    const txn = await Mina.transaction(controllerAccount, () => {
      AccountUpdate.fundNewAccount(controllerAccount);
      zkApp.deploy();
    });
    await txn.prove();
    await txn.sign([controllerKey, zkAppPrivateKey]).send();
  }

  beforeAll(async () => {
    if (proofsEnabled) await MVSContractV2.compile();
    await localDeploy();
  });

  it('should set the commitment root', async () => {
    // get storage root from zkdb instance
    const storageRoot = await zkdb.getMerkleRoot();
    const txn2 = await Mina.transaction(controllerAccount, () => {
      zkApp.setZkdbRoot(storageRoot);
    });
    await txn2.prove();
    const txnResult = await txn2.sign([controllerKey, zkAppPrivateKey]).send();
    expect(txnResult.isSuccess).toBeTruthy();
  });

  it('should fail if commitment root is tried to be set by non controller', async () => {
    ({ publicKey: userAccount } = Local.testAccounts[1]);
    // get storage root from zkdb instance
    const storageRoot = await zkdb.getMerkleRoot();
    await expect(
      Mina.transaction(userAccount, () => {
        zkApp.setZkdbRoot(storageRoot);
      })
    ).rejects.toThrow();
  });

  it('should fail if commitment root is tried to be reset', async () => {
    // get storage root from zkdb instance
    const storageRoot = await zkdb.getMerkleRoot();
    await expect(
      Mina.transaction(controllerAccount, () => {
        zkApp.setZkdbRoot(storageRoot);
      })
    ).rejects.toThrow();
  });

  it('should generate valid proof if ml result is true', async () => {
    // get curr of users
    const userCount = zkApp.numOfUsers.get();
    // get witness for user index
    const witness = new MVSMerkleWitnessV2(
      await zkdb.getWitnessByIndex(userCount.toBigInt())
    );
    let commitment = zkApp.storageRoot.get();
    const { verificationKey } = await MVSProofGen.compile();
    const userProof = await MVSProofGen.getProof(
      witness,
      commitment,
      Bool(true)
    );
    const ok = await verify(userProof.toJSON(), verificationKey);
    console.log(userProof.toJSON());
    expect(ok).toBeTruthy();
  });

  it('should not generate valid proof if ml result is false', async () => {
    // get curr of users
    const userCount = zkApp.numOfUsers.get();
    // get witness for user index
    const witness = new MVSMerkleWitnessV2(
      await zkdb.getWitnessByIndex(userCount.toBigInt())
    );
    let commitment = zkApp.storageRoot.get();
    await MVSProofGen.compile();
    await expect(
      MVSProofGen.getProof(witness, commitment, Bool(false))
    ).rejects.toThrow();
  });

  it('should store proof properly in zkdb', async () => {
    // get curr of users
    const userCount = zkApp.numOfUsers.get();
    // get witness for user index
    const witness = new MVSMerkleWitnessV2(
      await zkdb.getWitnessByIndex(userCount.toBigInt())
    );
    let commitment = zkApp.storageRoot.get();
    const { verificationKey } = await MVSProofGen.compile();
    const userProof = await MVSProofGen.getProof(
      witness,
      commitment,
      Bool(true)
    );

    const proofJson = userProof.toJSON();
    const proofString = JSON.stringify(proofJson);

    const encoder = new TextEncoder();
    const bytes = encoder.encode(proofString);

    const encodedProof = Encoding.Bijective.Fp.fromBytes(bytes);
    const ok = await verify(proofJson, verificationKey);

    const proofRecord = new ProofRecord({
      userId: CircuitString.fromString('dummy'),
      proof: encodedProof,
    });

    zkdb.add(proofRecord);
    expect(ok).toBeTruthy();
  });

  it('should get proof properly in zkdb', async () => {
    const findRecord = zkdb.findOne('userId', 'dummy');

    if (findRecord.isEmpty()) {
      throw new Error('User does not exist on DB');
    }
    // load instance
    const proofRecord = await findRecord.load(ProofRecord);
    const { verificationKey } = await MVSProofGen.compile();
    const proofRecordJson = proofRecord.json();
    const decodedProof = Encoding.Bijective.Fp.toBytes(proofRecordJson.proof);
    // // Decode the bytes back to a string
    const decoder = new TextDecoder();
    const decodedStr = decoder.decode(decodedProof);
    const proofJson = JSON.parse(decodedStr) as JsonProof;
    const ok = await verify(proofJson, verificationKey);
    expect(ok).toBeTruthy();
  });
});
