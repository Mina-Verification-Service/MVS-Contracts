import {
  Field,
  Experimental,
  MerkleWitness,
  Bool,
  CircuitString,
  SmartContract,
  State,
  state,
  PublicKey,
  method,
  Signature,
  SelfProof,
} from 'o1js';
import { Schema } from './serializer';

// Height of the Merkle Tree
const merkleHeight = 20;

// Extend Merkle witness at the same height as the Merkle Tree
export class MVSMerkleWitnessV2 extends MerkleWitness(merkleHeight) {}

export const MVSProofGen = Experimental.ZkProgram({
  name: 'mvs-proof-gen',
  publicInput: MVSMerkleWitnessV2, //userProofRecord

  methods: {
    getProof: {
      // private inputs the, the db commitment and ml check result.
      privateInputs: [Field, Bool],
      method(
        publicInput: MVSMerkleWitnessV2,
        commitmentRoot: Field,
        result: Bool
      ) {
        // check user path does not exist in commitment
        let emptyRoot = publicInput.calculateRoot(Field(0));
        commitmentRoot.assertEquals(emptyRoot);
        // check that result is true from ml checker
        result.assertEquals(Bool(true));
      },
    },
  },
});

export class ProofRecord extends Schema({
  userId: CircuitString,
  userPubKey: PublicKey,
  proof: [Field],
}) {
  // Deserialize the document from a Uint8Array
  static deserialize(data: Uint8Array): ProofRecord {
    return new ProofRecord(ProofRecord.decode(data));
  }
  // Index the document by user id
  index(): { userId: string } {
    return {
      userId: this.userId.toString(),
    };
  }
  json(): { userId: string; userPubKey: string; proof: Field[] } {
    return {
      userId: this.userId.toString(),
      userPubKey: this.userPubKey.toBase58(),
      proof: this.proof,
    };
  }
}

export class MVSContractV2 extends SmartContract {
  @state(Field) storageRoot = State<Field>();
  @state(Field) numOfUsers = State<Field>();
  @state(PublicKey) mvsController = State<PublicKey>();
  @state(Bool) initialized = State<Bool>();

  init() {
    super.init();
    // init numofusers
    this.numOfUsers.set(Field(0));
    // set state to false
    this.initialized.set(Bool(false));
    // set controller
    this.mvsController.set(this.sender);
  }

  // can only be called by controller
  @method setZkdbRoot(storageRoot: Field) {
    // get states
    const initialized = this.initialized.getAndAssertEquals();
    const controller = this.mvsController.getAndAssertEquals();
    // check if controller is txn sender
    controller.assertEquals(this.sender);
    // check if contract has been locked or fail
    initialized.assertEquals(Bool(false));
    // set storageRoot
    this.storageRoot.set(storageRoot);
    // lock the contract
    this.initialized.set(Bool(true));
  }

  // can only be called by controller
  @method addProofRecord(record: Field, witness: MVSMerkleWitnessV2) {
    // get contract states
    const controller = this.mvsController.getAndAssertEquals();
    const initialized = this.initialized.getAndAssertEquals();
    const storageRoot = this.storageRoot.getAndAssertEquals();
    const noOfUsers = this.numOfUsers.getAndAssertEquals();
    // check if controller is txn sender
    controller.assertEquals(this.sender);
    // check if contract has been initialized
    initialized.assertEquals(Bool(false));
    // get user root;
    let emptyRoot = witness.calculateRoot(Field(0));
    // ensure that witness path at index is empty, i.e address has not been added before
    emptyRoot.assertEquals(storageRoot);
    // calculate root for new address addition
    const newRoot = witness.calculateRoot(record);
    // update root and counter
    this.storageRoot.set(newRoot);
    this.numOfUsers.set(noOfUsers.add(1));
  }

  // can be called by anybody
  @method verifyProofRecord(
    record: Field,
    witness: MVSMerkleWitnessV2,
    signature: Signature,
    proof: SelfProof<MVSMerkleWitnessV2, void>,
    proofAsFields: [Field],
    userPubKey: PublicKey
  ) {
    // get storage
    const storageRoot = this.storageRoot.getAndAssertEquals();
    // calculate root
    const userRoot = witness.calculateRoot(record);
    // ensure that storage root and user root are the same
    storageRoot.assertEquals(userRoot);
    // check if proof signature is valid
    const validSignature = signature.verify(userPubKey, proofAsFields);
    // Check that the signature is valid
    validSignature.assertTrue();
    // then verify proof
    proof.verify();
  }
}
