/**
 * Transaction options builder for Aleo executeTransaction.
 *
 * "Failed to parse input #5 ('credits.aleo/credits.record')" means the wallet is
 * trying to parse our value AS that type — it expects the decrypted record string
 * (plaintext / struct string), same as Leo wallet. Do not pass ciphertext.
 * For record slots: pass the decrypted record (string or object with plaintext/struct fields).
 * Primitives (u64, field, etc.) are normalized to ABI strings.
 */

import type { TransactionOptions } from '@provablehq/aleo-types';
import { normalizeCreditsRecordInput, redactForLog } from './recordSanitizer';

const DEBUG_RECORD_INPUTS =
  typeof process !== 'undefined' &&
  process.env?.NEXT_PUBLIC_DEBUG_RECORD_INPUTS === 'true';

function isRecordSlot(index: number, recordIndices?: number[]): boolean {
  return Boolean(recordIndices && recordIndices.includes(index));
}

/**
 * Convert record to string for adapter. Same for Leo and Shield.
 * Uses normalizeCreditsRecordInput: only decrypted/plaintext accepted; ciphertext rejected.
 */
function recordToInputForAdapter(input: unknown): string {
  return normalizeCreditsRecordInput(input);
}

function normalizePrimitive(input: unknown, _index: number): string {
  if (input === null || input === undefined) {
    return String(input);
  }
  if (typeof input === 'boolean') {
    return input ? 'true' : 'false';
  }
  if (typeof input === 'number') {
    return `${input}u64`;
  }
  if (typeof input === 'string') {
    const s = input.trim();
    if (/^\d+$/.test(s)) return `${s}u64`;
    if (s.endsWith('u64')) return s;
    if (s.endsWith('field')) return s;
    if (s.endsWith('.private') || s.endsWith('.public')) return s;
    if (s.endsWith('u8')) return s;
    if (s.endsWith('u128')) return s;
    if (s === 'true' || s === 'false') return s;
    return s.includes('field') ? s : `${s.replace(/field$/, '')}field`;
  }
  return String(input);
}

/**
 * Build options for executeTransaction. Primitives normalized to ABI strings.
 * Record indices use recordToInputForAdapter (decrypted record string only).
 * Same path for Leo and Shield.
 */
export function createTransactionOptions(
  programId: string,
  functionName: string,
  inputs: unknown[],
  fee: number,
  privateFee: boolean = true,
  recordIndices?: number[]
): TransactionOptions {
  const processedInputs: unknown[] = inputs.map((input, index) => {
    if (isRecordSlot(index, recordIndices)) {
      const beforeStr =
        typeof input === 'string'
          ? input
          : typeof input === 'object' && input !== null
            ? JSON.stringify(input).slice(0, 80)
            : String(input);
      const result = recordToInputForAdapter(input);
      if (DEBUG_RECORD_INPUTS) {
        console.log(
          `[Record sanitizer] input #${index}: before=${redactForLog(beforeStr)}, after=${redactForLog(result)}`
        );
      }
      return result;
    }
    return normalizePrimitive(input, index);
  });

  return {
    program: programId,
    function: functionName,
    inputs: processedInputs as string[],
    fee,
    privateFee,
  };
}

/** Placeholder for intent path: wallet (e.g. Shield) will replace these with records. */
export const RECORD_TYPE_CREDITS = 'credits.aleo/credits';
export const RECORD_TYPE_POSITION = 'whisper_market.aleo/Position';

/** Placeholder for intent path when no record is provided; wallet will prompt for record selection. */
export const RECORD_PLACEHOLDER_INTENT = '';

export type IntentTransactionOptions = TransactionOptions & { recordIndices?: number[] };

/**
 * Build transaction options for intent path (Shield / record-opaque wallets).
 * Pass placeholders at record indices; wallet will prompt user to select records.
 * Fee is passed through in microcredits (caller uses getFeeForFunction).
 */
export function createIntentTransactionOptions(
  programId: string,
  functionName: string,
  inputs: unknown[],
  fee: number,
  privateFee: boolean,
  recordIndices: number[]
): IntentTransactionOptions {
  const processOne = (input: unknown, index: number): unknown =>
    recordIndices.includes(index)
      ? typeof input === 'string' ? input : String(input)
      : normalizePrimitive(input, index);

  const processedInputs = inputs.map((input, index) => processOne(input, index));

  return {
    program: programId,
    function: functionName,
    inputs: processedInputs as string[],
    fee,
    privateFee,
    recordIndices,
  };
}
