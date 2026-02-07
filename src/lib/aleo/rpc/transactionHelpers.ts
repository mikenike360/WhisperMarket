import { PREDICTION_MARKET_PROGRAM_ID } from '@/types';
import { findWalletAdapter } from '../wallet/adapter';

/** Log transaction options before and after send to detect if the wallet mutates them. */
export async function executeTransactionWithLog(
  walletAdapter: { executeTransaction: (opts: unknown) => Promise<unknown> },
  transactionOptions: { program?: string; function?: string; inputs?: unknown[]; fee?: number; recordIndices?: number[]; privateFee?: boolean }
): Promise<unknown> {
  const beforeSnapshot = {
    program: transactionOptions.program,
    function: transactionOptions.function,
    inputs: transactionOptions.inputs ? [...transactionOptions.inputs] : [],
    inputsLength: transactionOptions.inputs?.length,
    fee: transactionOptions.fee,
    recordIndices: transactionOptions.recordIndices ? [...(transactionOptions.recordIndices)] : undefined,
    privateFee: transactionOptions.privateFee,
  };
  console.log('[Transaction] BEFORE send to wallet:', beforeSnapshot);

  const result = await walletAdapter.executeTransaction(transactionOptions);

  console.log('[Transaction] AFTER send to wallet (options object now):', {
    program: transactionOptions.program,
    function: transactionOptions.function,
    inputs: transactionOptions.inputs,
    inputsLength: transactionOptions.inputs?.length,
    fee: transactionOptions.fee,
    recordIndices: transactionOptions.recordIndices,
    privateFee: transactionOptions.privateFee,
  });

  return result;
}

/** Recursively find first string in obj that starts with "at" (Provable tx id). */
function findAtIdInObject(obj: unknown, depth: number): string | null {
  if (depth <= 0 || obj == null) return null;
  if (typeof obj === 'string') {
    const s = obj.trim();
    return s.startsWith('at') ? s : null;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findAtIdInObject(item, depth - 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof obj === 'object') {
    const o = obj as Record<string, unknown>;
    for (const key of ['id', 'transactionId', 'txId', 'transaction_id']) {
      const found = findAtIdInObject(o[key], depth - 1);
      if (found) return found;
    }
    for (const v of Object.values(o)) {
      const found = findAtIdInObject(v, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

/** Provable Explorer expects transaction IDs in bech32 format (prefix "at"). Prefer "at" id; fallback to any id so the popup always shows. */
export function extractTransactionId(result: unknown): string | null {
  if (result == null) return null;
  const candidates: string[] = [];
  const r = result as Record<string, unknown>;
  for (const key of ['transactionId', 'id', 'txId', 'transaction_id']) {
    const v = r[key];
    if (typeof v === 'string' && v.trim()) candidates.push(v.trim());
  }
  const data = r.data as Record<string, unknown> | undefined;
  if (data && typeof data === 'object') {
    for (const key of ['transactionId', 'id', 'txId', 'transaction_id']) {
      const v = data[key];
      if (typeof v === 'string' && v.trim()) candidates.push(v.trim());
    }
  }
  const nested = r.result as Record<string, unknown> | undefined;
  if (nested && typeof nested === 'object') {
    for (const key of ['transactionId', 'id', 'txId', 'transaction_id']) {
      const v = nested[key];
      if (typeof v === 'string' && v.trim()) candidates.push(v.trim());
    }
  }
  const atId = candidates.find((s) => s.startsWith('at'));
  if (atId) return atId;
  const atIdDeep = findAtIdInObject(result, 8);
  if (atIdDeep) return atIdDeep;
  return candidates[0] ?? null;
}

/** Resolve requestRecords from optional param or wallet (adapter, wallet, nested paths). */
export function resolveRequestRecordsFn(
  wallet: any,
  requestRecords?: (programId: string, decrypt?: boolean) => Promise<any[]>
): ((programId: string, decrypt?: boolean) => Promise<any[]>) | null {
  if (requestRecords && typeof requestRecords === 'function') {
    return requestRecords;
  }
  if (!wallet || typeof wallet !== 'object') return null;
  const adapter = findWalletAdapter(wallet);
  if (adapter && typeof adapter.requestRecords === 'function') {
    return adapter.requestRecords.bind(adapter);
  }
  if (typeof (wallet as any).requestRecords === 'function') {
    return (wallet as any).requestRecords.bind(wallet);
  }
  if ((wallet as any).wallet && typeof (wallet as any).wallet.requestRecords === 'function') {
    return (wallet as any).wallet.requestRecords.bind((wallet as any).wallet);
  }
  if ((wallet as any).adapter && typeof (wallet as any).adapter.requestRecords === 'function') {
    return (wallet as any).adapter.requestRecords.bind((wallet as any).adapter);
  }
  if ((wallet as any).adapter?.wallet && typeof (wallet as any).adapter.wallet.requestRecords === 'function') {
    return (wallet as any).adapter.wallet.requestRecords.bind((wallet as any).adapter.wallet);
  }
  if ((wallet as any).wallet?.adapter && typeof (wallet as any).wallet.adapter.requestRecords === 'function') {
    return (wallet as any).wallet.adapter.requestRecords.bind((wallet as any).wallet.adapter);
  }
  return null;
}

/** Program ID variants some wallets use for whisper_market Position records. */
const POSITION_PROGRAM_IDS = [PREDICTION_MARKET_PROGRAM_ID, 'whisper_market'] as const;

export function normalizeRecordsResponse(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw != null && typeof raw === 'object' && Array.isArray((raw as any).records)) return (raw as any).records;
  if (raw != null) return [raw];
  return [];
}

/**
 * Request Position records from the wallet, trying multiple program ID variants
 * (e.g. "whisper_market.aleo" and "whisper_market") so we get records regardless of wallet naming.
 */
export async function requestPositionRecords(
  requestRecordsFn: (programId: string, decrypt?: boolean) => Promise<any[]>,
  decrypt: boolean
): Promise<unknown[]> {
  let combined: unknown[] = [];
  const seen = new Set<string>();
  for (const programId of POSITION_PROGRAM_IDS) {
    try {
      const raw = await requestRecordsFn(programId, decrypt);
      const list = normalizeRecordsResponse(raw);
      for (const r of list) {
        const key = typeof r === 'string' ? r.slice(0, 200) : JSON.stringify(r).slice(0, 200);
        if (!seen.has(key)) {
          seen.add(key);
          combined.push(r);
        }
      }
    } catch {
      // Skip this program ID variant
    }
  }
  return combined;
}
