/**
 * Deploys a contract to Local or Berkeley
 *
 * Usage:
 * ~~~
 * node build/contracts/src/deploy/deploy-zkapp.js Berkeley proofsEnabled ContractName
 * ~~~
 */
import 'dotenv/config';
import { deployContract } from './deploy-helper.js';
import { getAccountsForTesting, getArgvs } from './test-helper.js';
let [netw, proofsEnabled, contractName] = getArgvs();

const { deployerAccount, deployerKey } = await getAccountsForTesting(
  netw,
  proofsEnabled
);

// set network and some accounts
let zkApp = await deployContract(
  contractName,
  deployerAccount,
  deployerKey,
  proofsEnabled === undefined ? true : proofsEnabled
);
