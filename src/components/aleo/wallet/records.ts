/**
 * Record selection and helpers for credits/position records.
 * No RPC or client dependency — pure record logic.
 * Supports both Leo (decrypted: data.microcredits) and Shield (ciphertext) shapes.
 */

export type UnspentRecord = { record: unknown; value: number; id: string | null };

/** Parse microcredits from strings like "123u64", "123u64.private", "123". */
function parseMicrocreditsFromString(s: string): number {
  if (!s || typeof s !== 'string') return 0;
  const m = s.trim().match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Extract unique identifier from a record (id or commitment).
 */
export function getRecordId(record: unknown): string | null {
  if (!record) return null;
  if (typeof record === 'string') {
    return record.substring(0, 50);
  }
  if (typeof record === 'object' && record !== null) {
    const r = record as Record<string, unknown>;
    if (r.id) return String(r.id);
    if (r.commitment) return String(r.commitment);
    if (typeof r.recordCiphertext === 'string') {
      return r.recordCiphertext.substring(0, 50);
    }
    if (r.owner && r.data) {
      return `${r.owner}_${JSON.stringify(r.data).substring(0, 50)}`;
    }
  }
  return null;
}

/**
 * Check if two records are distinct (different IDs/commitments).
 */
export function areRecordsDistinct(record1: unknown, record2: unknown): boolean {
  const id1 = getRecordId(record1);
  const id2 = getRecordId(record2);
  if (!id1 || !id2) return true;
  return id1 !== id2;
}

/**
 * Extract microcredits value from a record.
 * Leo decrypted: data.microcredits, data.Microcredits, microcredits; formats "123u64", "123u64.private".
 * Shield encrypted: recordCiphertext → treat as "has value, unknown amount" (return 1).
 */
export function extractRecordValue(record: unknown): number {
  if (!record) return 0;
  if (typeof record === 'string') {
    const match = record.match(/microcredits["\s:]+([0-9]+)/);
    return match ? parseInt(match[1], 10) : 0;
  }
  if (typeof record === 'object' && record !== null) {
    const r = record as Record<string, unknown>;
    if (r.recordCiphertext) return 1;
    if (r.data) {
      const d = r.data as Record<string, unknown> | string;
      if (typeof d === 'object' && d) {
        const raw = (d.microcredits ?? d.Microcredits) as string | undefined;
        if (raw != null) return parseMicrocreditsFromString(String(raw));
      }
      if (typeof d === 'string') {
        const match = d.match(/microcredits["\s:]+([0-9]+)/);
        return match ? parseInt(match[1], 10) : 0;
      }
    }
    if (r.microcredits != null) return parseMicrocreditsFromString(String(r.microcredits));
  }
  return 0;
}

/** True if record has a ciphertext-like string (Shield / encrypted). */
function hasCiphertextLike(v: unknown): boolean {
  return typeof v === 'string' && v.startsWith('record') && v.length > 50;
}

/**
 * Filter and validate unspent records from wallet.
 * Keeps records that are unspent AND (have ciphertext OR have parseable microcredits).
 */
export function filterUnspentRecords(allRecords: unknown[]): UnspentRecord[] {
  const items: (UnspentRecord | null)[] = allRecords.map((record) => {
    if (typeof record === 'string') return null;
    if (typeof record !== 'object' || record === null) return null;
    const r = record as Record<string, unknown>;
    if (r.spent === true) return null;
    const hasCipher =
      hasCiphertextLike(r.recordCiphertext) ||
      hasCiphertextLike(r.ciphertext) ||
      hasCiphertextLike(r.record) ||
      hasCiphertextLike(r.value);
    if (hasCipher) return { record, value: 1, id: getRecordId(record) } as UnspentRecord;
    const value = extractRecordValue(record);
    if (value <= 0) return null;
    return { record, value, id: getRecordId(record) } as UnspentRecord;
  });
  return items.filter((item): item is UnspentRecord => item !== null);
}

/**
 * Pick one unspent record that can cover neededMicrocredits.
 * Prefers records with value >= neededMicrocredits; returns smallest sufficient or null.
 * If all records are ciphertext-only (value 0 or 1), returns null since amount cannot be verified.
 */
export function pickRecordForAmount(
  unspentRecords: UnspentRecord[],
  neededMicrocredits: number
): UnspentRecord | null {
  if (unspentRecords.length === 0) return null;
  const allCiphertextOnly = unspentRecords.every((r) => r.value <= 1);
  if (allCiphertextOnly && neededMicrocredits > 1) return null;
  const sufficient = unspentRecords.filter((r) => r.value >= neededMicrocredits);
  if (sufficient.length === 0) return null;
  sufficient.sort((a, b) => a.value - b.value);
  return sufficient[0];
}

/**
 * Find two distinct records: one for spending (program) and one for fee.
 */
export function findDistinctRecords(
  allRecords: unknown[],
  spendAmount: number,
  feeAmount: number
): { spendRecord: unknown; feeRecord: unknown } | null {
  const unspentRecords = filterUnspentRecords(allRecords);
  if (unspentRecords.length === 0) return null;

  const hasCiphertextRecords = unspentRecords.some((r) => {
    const x = r.record as Record<string, unknown>;
    const v = x?.recordCiphertext ?? x?.ciphertext ?? x?.record ?? x?.value;
    return typeof v === 'string' && v.startsWith('record') && (v as string).length > 50;
  });

  if (hasCiphertextRecords) {
    if (unspentRecords.length < 2) return null;
    const spendRecord = unspentRecords[0];
    const feeRecord = unspentRecords.find((r) =>
      areRecordsDistinct(r.record, spendRecord.record)
    );
    if (!feeRecord || !areRecordsDistinct(spendRecord.record, feeRecord.record))
      return null;
    return { spendRecord: spendRecord.record, feeRecord: feeRecord.record };
  }

  unspentRecords.sort((a, b) => b.value - a.value);
  const spendRecord = unspentRecords.find((r) => r.value >= spendAmount);
  if (!spendRecord) return null;
  const feeRecord = unspentRecords.find(
    (r) => areRecordsDistinct(r.record, spendRecord.record) && r.value >= feeAmount
  );
  if (!feeRecord || !areRecordsDistinct(spendRecord.record, feeRecord.record))
    return null;
  return { spendRecord: spendRecord.record, feeRecord: feeRecord.record };
}
