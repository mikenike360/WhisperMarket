/**
 * Example calls / unit-style checks for createTransactionOptions and findWalletAdapter.
 * Run with: npx tsx src/components/aleo/wallet/tx.example.test.ts
 * Or paste into a test runner when one is added.
 *
 * createTransactionOptions: init inputs become
 *   ["4000000u64", "1000000u64", "30u64", "122...field", "12345field", <recordCiphertextString>]
 * Primitives are normalized; salt at index 4; record at index 5 is converted to its ciphertext string
 * (Shield and adapters expect inputs: string[]).
 *
 * findWalletAdapter: returns adapter for nested structures like
 *   { adapter: { executeTransaction } }, { wallet: { requestRecords } }.
 */

import { createTransactionOptions } from './tx';
import { findWalletAdapter } from './adapter';
import { PREDICTION_MARKET_PROGRAM_ID } from '@/types';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// --- createTransactionOptions: init encoding ---
const recordCiphertext = 'record1qvqsq72mc5ryzd4tahskdpgpmyvf4vwvm3e0s24leuqxktuuj4szwqq3qyxx66trwfhkxun9v35hguerqqpqzqzdze44th9p0maa7wsw3d5k2dra8yzuk0434m52g486w0xcahdvp2m3l3grh5dx37g4l8392swgvtegwrv9hksrlxjwr7hdcwye5rssz5pkk7m';
const recordObject = { recordCiphertext, owner: 'aleo1...' };
const initInputs: unknown[] = [
  4000000,
  1000000,
  30,
  '122abc456field',
  '12345field', // salt for market_id = hash(creator || metadata_hash || salt)
  recordObject,
];
const options = createTransactionOptions(
  PREDICTION_MARKET_PROGRAM_ID,
  'init',
  initInputs,
  100_000,
  false,
  [5] // record at index 5
);

assert(Array.isArray(options.inputs), 'inputs must be array');
assert(options.inputs.length === 6, 'init must have 6 inputs');
assert(options.inputs[0] === '4000000u64', 'input 0 must be 4000000u64');
assert(options.inputs[1] === '1000000u64', 'input 1 must be 1000000u64');
assert(options.inputs[2] === '30u64', 'input 2 must be 30u64');
assert((options.inputs[3] as string).endsWith('field'), 'input 3 must end with field');
assert((options.inputs[4] as string).endsWith('field'), 'input 4 must be salt (field)');
assert(options.inputs[5] === recordCiphertext, 'input 5 must be record ciphertext string (Shield expects string[])');

// --- findWalletAdapter: nested structures ---
const mockExecute = () => Promise.resolve({ transactionId: 'tx1' });
const mockRequestRecords = () => Promise.resolve([]);

assert(findWalletAdapter(null) === null, 'null wallet -> null');
assert(findWalletAdapter(undefined) === null, 'undefined wallet -> null');

const adapterOnly = { executeTransaction: mockExecute };
assert(findWalletAdapter(adapterOnly) !== null, 'direct adapter found');
assert((findWalletAdapter(adapterOnly) as any)?.executeTransaction === mockExecute, 'direct executeTransaction returned');

const nestedAdapter = { adapter: { executeTransaction: mockExecute } };
assert(findWalletAdapter(nestedAdapter) !== null, 'wallet.adapter found');
assert((findWalletAdapter(nestedAdapter) as any)?.executeTransaction === mockExecute, 'wallet.adapter.executeTransaction returned');

const nestedWallet = { wallet: { requestRecords: mockRequestRecords } };
assert(findWalletAdapter(nestedWallet) !== null, 'wallet.wallet with requestRecords found');

const nestedWalletAdapter = { wallet: { adapter: { executeTransaction: mockExecute } } };
assert(findWalletAdapter(nestedWalletAdapter) !== null, 'wallet.wallet.adapter found');

// Test checks passed
export {};
