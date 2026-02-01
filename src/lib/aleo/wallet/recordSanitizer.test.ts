/**
 * Unit tests for normalizeCreditsRecordInput.
 * Run with: npx tsx src/lib/aleo/wallet/recordSanitizer.test.ts
 */

import {
  normalizeCreditsRecordInput,
  redactForLog,
} from './recordSanitizer';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertThrows(fn: () => void, expectedSubstr: string): void {
  try {
    fn();
    throw new Error(`Expected to throw containing "${expectedSubstr}"`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes(expectedSubstr)) {
      throw new Error(`Expected error containing "${expectedSubstr}", got: ${msg}`);
    }
  }
}

// --- redactForLog ---
assert(redactForLog('short') === '[5 chars] "short"', 'redact short string');
assert(redactForLog('a'.repeat(50)).includes('50 chars'), 'redact long string');
assert(redactForLog('') === '(empty)', 'redact empty');

// --- Surrounding quotes ---
const withQuotes = '"{\\"owner\\": \\"aleo1...\\", \\"microcredits\\": \\"1000u64\\"}"';
const out1 = normalizeCreditsRecordInput(withQuotes);
assert(out1.startsWith('{'), 'strip surrounding quotes: starts with {');
assert(!out1.startsWith('"'), 'strip surrounding quotes: no leading quote');

// --- Escaped newlines \\n ---
const withEscapedNewlines = '"{\\n  owner: aleo1...\\n}"';
const out2 = normalizeCreditsRecordInput(withEscapedNewlines);
assert(out2.includes('owner'), 'unescape \\n preserves content');
assert(!out2.includes('\\n'), 'unescape \\n: no literal backslash-n');

// --- Actual newlines \n ---
const withActualNewlines = '{\n  owner: aleo1...\n}';
const out3 = normalizeCreditsRecordInput(withActualNewlines);
assert(out3.includes('owner'), 'actual newlines: preserves content');

// --- Already clean ---
const clean = '{ owner: aleo1....private, microcredits: 15000000u64.private }';
const out4 = normalizeCreditsRecordInput(clean);
assert(out4 === clean, 'already clean: unchanged');

// --- Ciphertext string is rejected (we require decrypted record) ---
const ciphertext = 'record1qvqsq72mc5ryzd4tahskdpgpmyvf4vwvm3e0s24leuqxktuuj4szwqq3qyxx66trwfhkxun9v35hguerqqpqzqzdze44th9p0maa7wsw3d5k2dra8yzuk0434m52g486w0xcahdvp2m3l3grh5dx37g4l8392swgvtegwrv9hksrlxjwr7hdcwye5rssz5pkk7m';
assertThrows(() => normalizeCreditsRecordInput(ciphertext), 'decrypted');

// --- Object with plaintext key ---
const objPlaintext = {
  plaintext: '"{ owner: aleo1...private, microcredits: 100u64.private }"',
};
const out5 = normalizeCreditsRecordInput(objPlaintext);
assert(out5.includes('owner'), 'object plaintext: extracts and sanitizes');

// --- Object with recordPlaintext key ---
const objRecordPlaintext = {
  recordPlaintext: '{\\n  owner: x\\n  microcredits: 50u64\\n}',
};
const out6 = normalizeCreditsRecordInput(objRecordPlaintext);
assert(out6.includes('owner'), 'object recordPlaintext: extracts and sanitizes');

// --- Object with only ciphertext is rejected (no decrypted/plaintext field) ---
const objWithCiphertextOnly = {
  recordCiphertext:
    'record1qvqsq72mc5ryzd4tahskdpgpmyvf4vwvm3e0s24leuqxktuuj4szwqq3qyxx66trwfhkxun9v35hguerqqpqzqzdze44th9p0maa7wsw3d5k2dra8yzuk0434m52g486w0xcahdvp2m3l3grh5dx37g4l8392swgvtegwrv9hksrlxjwr7hdcwye5rssz5pkk7m',
};
assertThrows(() => normalizeCreditsRecordInput(objWithCiphertextOnly), 'decrypted');

// --- null/undefined throws ---
assertThrows(() => normalizeCreditsRecordInput(null), 'null');
assertThrows(() => normalizeCreditsRecordInput(undefined), 'undefined');

// --- Leo-shaped object (owner, microcredits) -> struct string ---
const leoObj = {
  owner: 'aleo1abc...private',
  microcredits: '15000000u64.private',
  _nonce: '123group.public',
  _version: '1u8.public',
};
const out7 = normalizeCreditsRecordInput(leoObj);
assert(out7.includes('owner'), 'Leo object: produces struct string');
assert(out7.includes('15000000u64'), 'Leo object: includes microcredits');

console.log('All recordSanitizer tests passed.');
export {};
