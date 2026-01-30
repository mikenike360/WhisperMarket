/**
 * Transaction options builder for Aleo executeTransaction.
 *
 * Shield record rule: Shield's executeTransaction expects inputs to be string[].
 * For record slots (recordIndices), pass the record CIPHERTEXT STRING (e.g. from
 * record.recordCiphertext). Do not pass the whole record object — Shield rejects
 * that with "Invalid transaction payload". Never pass type-name strings like
 * "credits.aleo/credits.record"; use only the actual ciphertext from requestRecords.
 * Primitives (u64, field, etc.) are normalized to ABI strings.
 */

import type { TransactionOptions } from '@provablehq/aleo-types';

function isRecordSlot(index: number, recordIndices?: number[]): boolean {
  return Boolean(recordIndices && recordIndices.includes(index));
}

/**
 * Convert record/ciphertext to the format the adapter expects.
 * Shield: ciphertext string. Leo: can accept decrypted record object (owner, data, spent).
 * Returns string for ciphertext, or the object as-is for Leo decrypted records.
 */
function recordToInputForAdapter(input: unknown): string | unknown {
  if (typeof input === 'string') {
    if (input.startsWith('record') && input.length > 50) return input;
    if (input.includes('credits.aleo/credits') && !input.startsWith('record')) {
      throw new Error('Invalid record: do not pass type name; use record ciphertext from requestRecords.');
    }
    throw new Error(`Invalid record string: expected ciphertext (starts with "record", length > 50), got length ${input.length}.`);
  }
  if (input && typeof input === 'object') {
    const r = input as Record<string, unknown>;
    const cipher = (r.recordCiphertext ?? r.ciphertext ?? r.cipherText ?? r.record ?? r.value) as string | undefined;
    if (typeof cipher === 'string' && cipher.startsWith('record') && cipher.length > 50) {
      return cipher;
    }
    if ('owner' in r || 'data' in r || 'spent' in r) {
      return input;
    }
    throw new Error('Record has no ciphertext (recordCiphertext, ciphertext, record, or value). Use requestRecords(program, false) and allow the wallet to show the record picker.');
  }
  throw new Error(`Invalid record at record index: expected string or object with ciphertext, got ${typeof input}.`);
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
 * Build options for executeTransaction. Primitives are normalized to ABI
 * strings. For record indices, record values are passed as ciphertext string
 * (Shield) or as full record object (Leo decrypted) via recordToInputForAdapter.
 *
 * We do NOT pass recordIndices to the adapter when we've already serialized
 * records. Shield may interpret recordIndices as "replace these inputs with
 * records from wallet" and overwrite our value with the type name.
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
      return recordToInputForAdapter(input);
    }
    return normalizePrimitive(input, index);
  });

  return {
    program: programId,
    function: functionName,
    inputs: processedInputs,
    fee,
    privateFee,
  };
}
