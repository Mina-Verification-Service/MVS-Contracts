import {
  Field,
  Experimental,
  MerkleWitness,
  Bool,
  JsonProof,
  CircuitString,
  SmartContract,
  State,
  state,
  PublicKey,
  method,
} from 'o1js';
import { Schema } from 'zkdb';

// Height of the Merkle Tree
const merkleHeight = 20;

// Extend Merkle witness at the same height as the Merkle Tree
export class MVSMerkleWitnessV2 extends MerkleWitness(merkleHeight) {}

export const MVSProofGen = Experimental.ZkProgram({
  name: 'mvs-proof-gen',
  publicInput: Field, //userProofRecord

  methods: {
    getProof: {
      // private inputs the, the db commitment and ml check result.
      privateInputs: [Field, Bool],

      method(publicInput: Field, commitmentRoot: Field, result: Bool) {
        let publicFields = publicInput.toFields();
        let witness = MVSMerkleWitnessV2.fromFields(publicFields);
        // check user path does not exist in commitment
        let emptyRoot = witness.calculateRoot(Field(0));
        commitmentRoot.assertEquals(emptyRoot);
        // check that result is true from ml checker
        result.assertEquals(true);
      },
    },
  },
});

export class ProofRecord extends Schema({
  userId: CircuitString,
  proof: Object as unknown as JsonProof,
}) {
  // Deserialize the document from a Uint8Array
  static deserialize(data: Uint8Array): ProofRecord {
    return new ProofRecord(ProofRecord.decode(data));
  }
  // Index the document by user public key
  index(): { userId: string } {
    return {
      userId: this.userId.toString(),
    };
  }
  json(): { userId: string; proof: JsonProof } {
    return {
      userId: this.userId.toString(),
      proof: this.proof,
    };
  }
}

export class MVSContractV2 extends SmartContract {
  @state(Field) storageRoot = State<Field>();
  @state(Field) numOfUsers = State<Field>();
  @state(PublicKey) mvsController = State<PublicKey>();
  @state(Bool) initiated = State<Bool>();

  @method setZkdbRoot(storageRoot: Field) {
    const initiated = this.initiated.get();
    this.initiated.assertEquals(initiated);

    // check if contract has been locked or fail
    initiated.assertEquals(Bool(false));

    this.storageRoot.set(storageRoot);
    this.numOfUsers.set(Field(0));

    // set controller
    this.mvsController.set(this.sender);

    // lock the contract
    this.initiated.set(Bool(true));
  }

  @method addUser(record: Field, witness: MVSMerkleWitnessV2) {
    // get contract states
    const controller = this.mvsController.get();
    this.mvsController.assertEquals(controller);

    const initiated = this.initiated.get();
    this.initiated.assertEquals(initiated);

    const storageRoot = this.storageRoot.get();
    this.storageRoot.assertEquals(storageRoot);

    const noOfUsers = this.numOfUsers.get();
    this.numOfUsers.assertEquals(noOfUsers);

    // check if controller is txn sender
    controller.assertEquals(this.sender);

    // check if contract has been initiated
    initiated.assertEquals(Bool(false));

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
}
