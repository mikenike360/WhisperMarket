import { UserPosition, PREDICTION_MARKET_PROGRAM_ID } from '@/types';
import { requestPositionRecords, normalizeRecordsResponse } from './transactionHelpers';

/**
 * Normalize market ID to a canonical string for comparison.
 * URL/market page may use "123" while records may have "123field" or "123.private".
 */
export function normalizeMarketId(value: string | undefined | null): string {
  if (value == null || value === '') return '';
  let s = String(value).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/\.private$/i, '').replace(/\.field$/i, '').replace(/field$/i, '').trim();
  return s;
}

/** Numeric core of a market ID for flexible matching (e.g. "5099...5667field" and "5099...5667" match). */
export function marketIdNumericCore(value: string | undefined | null): string {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  const match = s.match(/\d+/);
  return match ? match[0] : s;
}

/**
 * Helper to extract field value from Aleo record format
 * Handles .private suffixes and field formatting; returns normalized form for market_id
 */
export function extractFieldValue(value: any): string {
  if (typeof value === 'string') {
    return normalizeMarketId(value);
  }
  if (value && typeof value === 'object') {
    return normalizeMarketId(String(value));
  }
  return normalizeMarketId(String(value));
}

/** Check if a record is spent. Handles true, "true", 1, etc. from wallet/indexer. */
export function isRecordSpent(record: any): boolean {
  if (record == null) return false;
  const s = record.spent;
  if (s === true || s === 1) return true;
  if (typeof s === 'string' && s.toLowerCase() === 'true') return true;
  return false;
}

/** Extract market_id from plaintext string (e.g. "market_id: 123field", "market_id: 123field.private", or JSON-like "market_id": "123field"). */
export function extractMarketIdFromPlaintext(plaintext: string): string | null {
  if (!plaintext || typeof plaintext !== 'string') return null;
  let m = plaintext.match(/market_id\s*:\s*([^\s,}\]"']+)/);
  if (m) return normalizeMarketId(m[1]);
  m = plaintext.match(/market_id\s*:\s*["']([^"']+)["']/);
  if (m) return normalizeMarketId(m[1]);
  m = plaintext.match(/"market_id"\s*:\s*["']?([^"',}\s]+)/);
  if (m) return normalizeMarketId(m[1]);
  m = plaintext.match(/market_id\s*:\s*(\d+[^\s,}\]]*)/);
  if (m) return normalizeMarketId(m[1]);
  return null;
}

/** Extract value for a key from plaintext struct (e.g. "yes_shares: 0u128.private" -> "0u128.private"). Stops at comma, newline, or closing brace. */
function extractValueFromPlaintext(plaintext: string, key: string): string | null {
  if (!plaintext || typeof plaintext !== 'string') return null;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = plaintext.match(new RegExp(`${escaped}\\s*:\\s*([^,\\n}\\]]+)`, 'm'));
  if (!m) return null;
  return m[1].trim().replace(/\s*[})\]]\s*$/, '').trim();
}

/** Extract u128 value from Aleo record format. */
function extractU128Value(value: any): number {
  if (typeof value === 'string') {
    let s = value.trim().replace(/^["']|["']$/g, '').replace(/\.private/gi, '').replace(/u128/gi, '').trim();
    const match = s.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (value && typeof value === 'object') {
    const str = String(value);
    const match = str.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }
  return 0;
}

/** Extract boolean value from Aleo record format */
function extractBoolValue(value: any): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const cleanValue = value.replace(/\.private$/, '');
    return cleanValue === 'true';
  }
  return false;
}

/** Keys that may hold the decrypted plaintext string (wallet/chain shape). */
const POSITION_PLAINTEXT_KEYS = [
  'recordPlaintext',
  'record_plaintext',
  'plaintext',
  'record',
  'value',
  'decryptedRecord',
  'decrypted',
  'data',
];

/**
 * Get the plaintext string from a single record (wallet may return object with plaintext key or the raw string).
 */
export function getPositionPlaintext(r: any): string | undefined {
  if (typeof r === 'string' && r.trim().length > 0) return r.trim();
  const recordData = r?.data ?? r;
  if (typeof recordData === 'string' && recordData.trim().length > 0) return recordData.trim();
  for (const key of POSITION_PLAINTEXT_KEYS) {
    const val = recordData?.[key] ?? (r as any)?.[key];
    if (typeof val === 'string' && val.length > 0) return val;
  }
  return undefined;
}

/** Parse Position from chain/indexer record plaintext (recordPlaintext string). */
function parsePositionFromPlaintext(plaintext: string): UserPosition {
  const marketId = extractMarketIdFromPlaintext(plaintext) ?? '';
  const yesSharesStr = extractValueFromPlaintext(plaintext, 'yes_shares');
  const noSharesStr = extractValueFromPlaintext(plaintext, 'no_shares');
  const collateralAvailableStr = extractValueFromPlaintext(plaintext, 'collateral_available');
  const collateralCommittedStr = extractValueFromPlaintext(plaintext, 'collateral_committed');
  const payoutClaimedStr = extractValueFromPlaintext(plaintext, 'payout_claimed');
  return {
    marketId,
    yesShares: yesSharesStr != null ? extractU128Value(yesSharesStr) : 0,
    noShares: noSharesStr != null ? extractU128Value(noSharesStr) : 0,
    collateralAvailable: collateralAvailableStr != null ? extractU128Value(collateralAvailableStr) : 0,
    collateralCommitted: collateralCommittedStr != null ? extractU128Value(collateralCommittedStr) : 0,
    payoutClaimed: payoutClaimedStr != null ? extractBoolValue(payoutClaimedStr) : false,
  };
}

/**
 * Parse Position record from Aleo record format.
 * Supports (1) object with top-level market_id, yes_shares, etc. and (2) chain/indexer shape with recordPlaintext string.
 */
export function parsePositionRecord(record: any): UserPosition {
  const recordData = record?.data ?? record;
  const plaintext = getPositionPlaintext(record);

  if (typeof plaintext === 'string' && plaintext.length > 0 && extractMarketIdFromPlaintext(plaintext) !== null) {
    return parsePositionFromPlaintext(plaintext);
  }

  const marketId = extractFieldValue(recordData.market_id);
  const yesShares = extractU128Value(recordData.yes_shares);
  const noShares = extractU128Value(recordData.no_shares);
  const collateralAvailable = extractU128Value(recordData.collateral_available);
  const collateralCommitted = extractU128Value(recordData.collateral_committed);
  const payoutClaimed = extractBoolValue(recordData.payout_claimed);

  return {
    marketId,
    yesShares,
    noShares,
    collateralAvailable,
    collateralCommitted,
    payoutClaimed,
  };
}

/**
 * Find the unspent Position record for a given market from raw records.
 */
export function findPositionRecordForMarket(
  records: any[],
  marketId: string,
  minCollateralRequired?: number
): any | null {
  if (!records || records.length === 0) return null;
  const normalizedMarketId = normalizeMarketId(marketId);
  const marketIdCore = marketIdNumericCore(marketId);

  const matches = records.filter((r: any) => {
    if (isRecordSpent(r)) return false;
    const recordData = r?.data ?? r;
    let marketMatch = false;
    if (recordData && recordData.market_id != null) {
      const recordMarketId = extractFieldValue(recordData.market_id);
      if (recordMarketId === normalizedMarketId || (marketIdCore && marketIdNumericCore(recordMarketId) === marketIdCore)) {
        marketMatch = true;
      }
    }
    if (!marketMatch) {
      const plaintext = getPositionPlaintext(r);
      if (typeof plaintext === 'string' && plaintext.length > 0) {
        const extracted = extractMarketIdFromPlaintext(plaintext);
        marketMatch = Boolean(
          extracted !== null && (extracted === normalizedMarketId || (marketIdCore && marketIdNumericCore(extracted) === marketIdCore))
        );
      }
    }
    return marketMatch;
  });

  let found: any = null;
  if (minCollateralRequired != null && minCollateralRequired > 0) {
    const withCollateral = matches
      .map((r) => {
        try {
          const pos = parsePositionRecord(r);
          return { record: r, collateralAvailable: pos.collateralAvailable };
        } catch {
          return { record: r, collateralAvailable: 0 };
        }
      })
      .filter((x) => x.collateralAvailable >= minCollateralRequired)
      .sort((a, b) => b.collateralAvailable - a.collateralAvailable);
    found = withCollateral.length > 0 ? withCollateral[0].record : null;
  }
  if (!found && matches.length > 0) {
    found = matches[0];
  }
  return found ?? null;
}

/**
 * Get all user positions across all markets.
 */
export async function getAllUserPositions(
  wallet: any,
  programId: string,
  requestRecords?: (programId: string, decrypt?: boolean) => Promise<any[]>
): Promise<Array<{ position: UserPosition; record: any; records: any[] }>> {
  try {
    if (!wallet) {
      throw new Error('Wallet adapter not available');
    }

    let requestRecordsFn: ((programId: string, decrypt?: boolean) => Promise<any[]>) | null = null;
    if (requestRecords && typeof requestRecords === 'function') {
      requestRecordsFn = requestRecords;
    } else {
      if (typeof wallet.requestRecords === 'function') {
        requestRecordsFn = wallet.requestRecords.bind(wallet);
      } else if (wallet.wallet && typeof wallet.wallet.requestRecords === 'function') {
        requestRecordsFn = wallet.wallet.requestRecords.bind(wallet.wallet);
      } else if (wallet.adapter && typeof wallet.adapter.requestRecords === 'function') {
        requestRecordsFn = wallet.adapter.requestRecords.bind(wallet.adapter);
      }
    }

    if (!requestRecordsFn) {
      throw new Error(
        'requestRecords not available. ' +
        'Please ensure your wallet is properly connected and supports record access.'
      );
    }

    let allRecords: any[] = [];
    const usePositionHelper = programId === PREDICTION_MARKET_PROGRAM_ID || programId === 'whisper_market';
    try {
      allRecords = usePositionHelper
        ? ((await requestPositionRecords(requestRecordsFn, true)) as any[])
        : ((normalizeRecordsResponse(await requestRecordsFn(programId, true)) as any[]));
    } catch {
      try {
        allRecords = usePositionHelper
          ? ((await requestPositionRecords(requestRecordsFn, false)) as any[])
          : ((normalizeRecordsResponse(await requestRecordsFn(programId, false)) as any[]));
      } catch {
        allRecords = [];
      }
    }
    if (!allRecords || allRecords.length === 0) {
      return [];
    }

    const byMarket = new Map<string, { position: UserPosition; records: any[] }>();

    for (const record of allRecords) {
      if (isRecordSpent(record)) continue;

      const recordData = record?.data ?? record;
      const plaintext = getPositionPlaintext(record);
      const hasMarketIdDirect = recordData && recordData.market_id != null;
      const hasMarketIdInPlaintext = typeof plaintext === 'string' && extractMarketIdFromPlaintext(plaintext) !== null;
      if (!hasMarketIdDirect && !hasMarketIdInPlaintext) continue;

      try {
        const position = parsePositionRecord(record);
        const existing = byMarket.get(position.marketId);
        if (existing) {
          existing.position.collateralAvailable += position.collateralAvailable;
          existing.position.collateralCommitted += position.collateralCommitted;
          existing.position.yesShares += position.yesShares;
          existing.position.noShares += position.noShares;
          existing.records.push(record);
        } else {
          byMarket.set(position.marketId, {
            position: { ...position },
            records: [record],
          });
        }
      } catch {
        // Skip records that can't be parsed
      }
    }

    return Array.from(byMarket.entries()).map(([, { position, records }]) => {
      const allClaimed = records.every((r) => {
        try {
          return parsePositionRecord(r).payoutClaimed;
        } catch {
          return true;
        }
      });
      position.payoutClaimed = allClaimed;

      const unclaimedRecords = records.filter((r) => {
        try {
          return !parsePositionRecord(r).payoutClaimed;
        } catch {
          return false;
        }
      });
      const candidates = unclaimedRecords.length > 0 ? unclaimedRecords : records;
      const bestRecord =
        candidates.length <= 1
          ? candidates[0]
          : candidates.reduce((best, r) => {
              try {
                const pos = parsePositionRecord(r);
                const bestPos = parsePositionRecord(best);
                return pos.collateralAvailable >= bestPos.collateralAvailable ? r : best;
              } catch {
                return best;
              }
            });
      return { position, record: bestRecord, records };
    });
  } catch {
    return [];
  }
}

/**
 * Pick a position record that can be redeemed for the given resolved outcome.
 */
export function pickRecordToRedeem(records: any[], outcome: boolean | null): any | null {
  if (!records?.length || outcome === null) return null;

  const unspent = records.filter((r) => !isRecordSpent(r));
  if (unspent.length === 0) return null;

  const redeemable = unspent.filter((r) => {
    try {
      const pos = parsePositionRecord(r);
      if (pos.payoutClaimed) return false;
      if (outcome === true) {
        return pos.yesShares > 0;
      }
      if (outcome === false) {
        return pos.noShares > 0;
      }
      return false;
    } catch {
      return false;
    }
  });

  if (redeemable.length === 0) return null;
  if (redeemable.length === 1) return redeemable[0];

  return redeemable.reduce((best, r) => {
    try {
      const pos = parsePositionRecord(r);
      const bestPos = parsePositionRecord(best);
      const bestWinning = outcome ? bestPos.yesShares : bestPos.noShares;
      const curWinning = outcome ? pos.yesShares : pos.noShares;
      return curWinning >= bestWinning ? r : best;
    } catch {
      return best;
    }
  });
}
