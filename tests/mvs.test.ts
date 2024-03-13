import {
  Mina,
  PrivateKey,
  AccountUpdate,
  PublicKey,
  CircuitString,
  Field,
} from 'o1js';
import { ZKDatabaseStorage } from 'zkdb';
import {
  UserSession,
  MVSMerkleWitness,
  UserData,
  MVSContract,
} from '../build/src';

describe('MVS Test', () => {
  const merkleHeight = 20;
  const doProofs = false;
  let mvsContract: MVSContract;
  let feePayer: PublicKey;
  let feePayerKey: PrivateKey;
  let zkappKey: PrivateKey;
  let zkappAddress: PublicKey;
  let zkdb: ZKDatabaseStorage;
  let initialBalance = 10_000_000_000;
  let Local = Mina.LocalBlockchain({ proofsEnabled: doProofs });
  Mina.setActiveInstance(Local);

  const accountPubKeyList = new Array(4)
    .fill(null)
    .map(() => PrivateKey.random().toPublicKey().toBase58());

  async function checkUser(userAddress: string) {
    // check for account from db
    const findRecord = zkdb.findOne('userAddress', userAddress);

    if (findRecord.isEmpty()) {
      throw new Error('User does not exist on DB');
    }
    // load account instance
    const accData = await findRecord.load(UserData);
    const accWitness = new MVSMerkleWitness(await findRecord.witness());

    // Perform the transaction
    let tx = await Mina.transaction(feePayer, () => {
      mvsContract.verifyUser(accData.hash(), accWitness);
    });

    await tx.prove();
    await tx.sign([feePayerKey, zkappKey]).send();
  }

  async function addUser(userAddress: string) {
    // check for account from db
    const findRecord = zkdb.findOne('userAddress', userAddress);

    if (findRecord.isEmpty()) {
      throw new Error('User does not exist on DB');
    }
    // load account instance
    const accData = await findRecord.load(UserData);
    const accWitness = new MVSMerkleWitness(await findRecord.witness());

    // Perform the transaction
    let tx = await Mina.transaction(feePayer, () => {
      mvsContract.addNewUser(accData.hash(), accWitness);
    });

    await tx.prove();
    await tx.sign([feePayerKey, zkappKey]).send();
  }

  async function changeCommitment() {
    // try to change commitment
    let newcommitment = Field(0);

    let tx = await Mina.transaction(feePayer, () => {
      mvsContract.setZkdbCommitment(newcommitment);
    });

    await tx.prove();
    await tx.sign([feePayerKey, zkappKey]).send();
  }

  async function deployContract() {
    feePayerKey = Local.testAccounts[0].privateKey;
    feePayer = Local.testAccounts[0].publicKey;

    // the zkapp account
    zkappKey = PrivateKey.random();
    zkappAddress = zkappKey.toPublicKey();

    // we now need "wrap" the Merkle tree around our off-chain storage
    // we initialize a new Merkle Tree with height 8
    zkdb = await ZKDatabaseStorage.getInstance('zkdb-mvs', {
      storageEngine: 'local',
      merkleHeight,
      storageEngineCfg: {
        location: './data',
      },
    });
    // Merkle Tree root commitment at the time of contract initialization
    const initialCommitment = await zkdb.getMerkleRoot();

    mvsContract = new MVSContract(zkappAddress);

    if (doProofs) {
      await MVSContract.compile();
    }
    let tx = await Mina.transaction(feePayer, () => {
      AccountUpdate.fundNewAccount(feePayer).send({
        to: zkappAddress,
        amount: initialBalance,
      });
      mvsContract.deploy();
      mvsContract.setZkdbCommitment(initialCommitment);
    });

    await tx.prove();
    await tx.sign([feePayerKey, zkappKey]).send();
  }

  beforeAll(async () => {
    await deployContract();
  });

  it('add user successfully', async () => {
    for (let i = 0; i < accountPubKeyList.length; i++) {
      await zkdb.add(
        new UserData({
          userAddress: PublicKey.fromBase58(accountPubKeyList[i]),
          session: new UserSession({
            name: CircuitString.fromString(`user${i}`),
            email: CircuitString.fromString(`user${i}@email.com`),
            image: CircuitString.fromString(`user${i}.png`),
          }),
        })
      );

      await addUser(accountPubKeyList[i]);
    }

    const zkdbRoot = await zkdb.getMerkleRoot();
    const contractRoot = mvsContract.root.get();
    expect(zkdbRoot.toString()).toEqual(contractRoot.toString());
  });

  it('check user successfully', async () => {
    for (let i = 0; i < accountPubKeyList.length; i++) {
      await checkUser(accountPubKeyList[i]);
    }
    const zkdbRoot = await zkdb.getMerkleRoot();
    const contractRoot = mvsContract.root.get();
    expect(zkdbRoot.toString()).toEqual(contractRoot.toString());
  });

  it('should fail when trying to add new commitment after deploy', async () => {
    await expect(changeCommitment()).rejects.toThrow();
  });
});
