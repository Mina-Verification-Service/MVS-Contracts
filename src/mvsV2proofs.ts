import {
  PublicKey,
  Experimental,
  Field,
  SmartContract,
  State,
  state,
  Proof,
  PrivateKey,
  DeployArgs,
  Struct,
  Permissions,
  method,
  MerkleWitness,
} from 'o1js';
import type { JsonProof } from 'o1js';
import { ZKDatabaseStorage, Schema } from 'zkdb';

// Height of the Merkle Tree
const merkleHeight = 20;

// Extend Merkle witness at the same height as the Merkle Tree
class MVSMerkleWitness extends MerkleWitness(merkleHeight) {}

class UserProof extends Schema({
  userAddress: PublicKey,
  proof: Object as unknown as JsonProof,
}) {
  // Deserialize the document from a Uint8Array
  static deserialize(data: Uint8Array): UserProof {
    return new UserProof(UserProof.decode(data));
  }
  // Index the document by user public key
  index(): { userAddress: string } {
    return {
      userAddress: this.userAddress.toBase58(),
    };
  }
  json(): { userAddress: string; proof: JsonProof } {
    return {
      userAddress: this.userAddress.toBase58(),
      proof: this.proof,
    };
  }
}

export class MVSContract extends SmartContract {
  @state(Field) root = State<Field>();

  deploy(args: DeployArgs) {
    super.deploy(args);
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });
  }

  @method initStateRoot(stateRoot: Field) {
    this.root.set(stateRoot);
  }

  @method addNewUser(userProof: UserProof, userWitness: MVSMerkleWitness) {
    // Get the on-chain merkle root commitment,
    // Make sure it matches the one we have locally
    let commitment = this.root.get();
    this.root.assertEquals(commitment);

    // reconstruct user proof and verify
    let proof = Proof.fromJSON(userProof.proof);
    proof.verify();

    // ensure that witness path is empty
    const emptyroot = userWitness.calculateRoot(Field(0));
    commitment.assertEquals(emptyroot);

    // calculate root for new user.
    const newCommitment = userWitness.calculateRoot(userProof.hash());

    // update root
    this.root.set(newCommitment);
  }

  @method verifyUser(userProof: UserProof, userWitness: MVSMerkleWitness) {
    // Get the on-chain merkle root commitment,
    // Make sure it matches the one we have locally
    let commitment = this.root.get();
    this.root.assertEquals(commitment);

    // reconstruct user proof and verify
    let proof = Proof.fromJSON(userProof.proof);
    proof.verify();

    // check the user exists already within the committed Merkle tree
    const userCommitment = userWitness.calculateRoot(userProof.hash());

    commitment.assertEquals(userCommitment);
  }
}

class MVSState extends Struct({}) {}

const MVSProofGen = Experimental.ZkProgram({
  publicInput: Field,

  methods: {
    generate: {
      privateInputs: [],

      method(state: Field) {
        state.assertEquals(Field(0));
      },
    },
  },
});

(async () => {
  console.log('compiling...');

  await MVSProofGen.compile();

  const add = PrivateKey.random();
  const addkey = add.toPublicKey();

  console.log('making proof 0');

  const proof0 = await MVSProofGen.generate(Field(0));

  const newUser = new UserProof({
    userAddress: addkey,
    proof: proof0.toJSON(),
  });

  console.log(newUser.json());
})();
