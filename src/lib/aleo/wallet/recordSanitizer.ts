/**
 * Sanitizes Shield-returned credits records into plaintext format for executeTransaction.
 * Shield expects plaintext (Leo struct string), not ciphertext. Shield's adapter may return
 * plaintext wrapped with double quotes and escaped newlines — we unescape and normalize.
 *
 * Chain/indexer record shape (e.g. whisper_market Position) has recordPlaintext with the
 * decrypted struct string; we use that directly for the transaction input.
 */

const PLAINTEXT_KEYS = ['recordPlaintext', 'record_plaintext', 'plaintext', 'record', 'value', 'data'] as const;

/**
 * Redact a string for safe logging. Never log full record content.
 */
export function redactForLog(s: string, maxChars: number = 30): string {
  if (!s || typeof s !== 'string') return '(empty)';
  const len = s.length;
  const preview = s.length <= maxChars ? s : s.slice(0, maxChars) + '...';
  return `[${len} chars] "${preview.replace(/"/g, '')}"`;
}

/**
 * Check if a string looks like ciphertext (record1...).
 */
function isCiphertext(s: string): boolean {
  const t = s.trim();
  return t.startsWith('record') && t.length > 50;
}

/**
 * Strip double-quotes and \\n newline characters from record plaintext.
 * Wallet/site often returns plaintext wrapped in quotes with escaped newlines; remove so the adapter can parse.
 * Exported for use in tx layer so the final value sent to the wallet is always cleaned.
 */
export function stripQuotesAndNewlines(s: string): string {
  let out = s.trim();
  // Remove surrounding double-quotes (repeat in case of nested wrapping)
  while (out.length >= 2 && out.startsWith('"') && out.endsWith('"')) {
    out = out.slice(1, -1).trim();
  }
  // Remove literal \n and \r (backslash + n/r) so they don't break parsing
  out = out.replace(/\\n/g, ' ');
  out = out.replace(/\\r/g, ' ');
  // Replace any real newline characters with space
  out = out.replace(/\r\n?|\n/g, ' ');
  // Collapse whitespace to single line
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

/**
 * Sanitize record plaintext from wallet/site: remove surrounding quotes and
 * all newlines/blank lines so the wallet adapter can parse it.
 */
function sanitizeString(s: string): string {
  let out = stripQuotesAndNewlines(s);
  // Also strip single quotes (in case of alternate wrapping)
  while (out.length >= 2 && out.startsWith("'") && out.endsWith("'")) {
    out = out.slice(1, -1).trim();
  }
  out = out.replace(/\u2028|\u2029/g, ' ');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

/**
 * Convert Leo-shaped record object to struct string format.
 * Shield expects: { owner: aleo1...private, microcredits: 15000000u64.private, _nonce: ..., _version: 1u8.public }
 */
function leoObjectToStructString(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    const formatted =
      typeof val === 'string'
        ? val
        : typeof val === 'object' && val !== null && !Array.isArray(val)
          ? leoObjectToStructString(val as Record<string, unknown>)
          : String(val);
    parts.push(`${key}: ${formatted}`);
  }
  return `{ ${parts.join(', ')} }`;
}

/**
 * Try to extract plaintext string from an object.
 * When record has .data as object (e.g. Shield Position/credits), serialize the inner struct so the wallet gets the correct ABI shape.
 */
function extractPlaintextFromObject(obj: Record<string, unknown>): string | null {
  for (const key of PLAINTEXT_KEYS) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val;
    }
  }
  // Wrapper with inner struct: { data: { owner, market_id, ... }, spent } — serialize inner .data for transaction input
  const dataVal = obj.data;
  if (typeof dataVal === 'object' && dataVal !== null && !Array.isArray(dataVal)) {
    return leoObjectToStructString(dataVal as Record<string, unknown>);
  }
  // Leo-shaped object: owner, microcredits, _nonce, _version — use struct format for Shield
  if ('owner' in obj || 'microcredits' in obj || '_nonce' in obj || 'data' in obj) {
    return leoObjectToStructString(obj);
  }
  return null;
}

/**
 * Normalize any credits record for executeTransaction. Same handling for Leo and Shield.
 * We always pass the decrypted record as a string (plaintext / struct string), like the Leo wallet.
 * Ciphertext is not accepted — the wallet must provide decrypted/plaintext record.
 *
 * - Plaintext string: sanitize (strip quotes, unescape \n)
 * - Object: extract plaintext or convert to struct string (owner, microcredits, data, etc.)
 *
 * @param recordLike - Record from requestRecords (decrypted string or object with plaintext/struct fields)
 * @returns Normalized decrypted record string
 */
export function normalizeCreditsRecordInput(recordLike: unknown): string {
  if (recordLike === null || recordLike === undefined) {
    throw new Error('Record input is null or undefined.');
  }

  if (typeof recordLike === 'string') {
    const s = recordLike.trim();
    if (isCiphertext(s)) {
      throw new Error(
        'Ciphertext is not accepted. Pass the decrypted record as a string (plaintext), e.g. from record.plaintext or record.recordPlaintext.'
      );
    }
    return sanitizeString(recordLike);
  }

  if (typeof recordLike === 'object' && recordLike !== null) {
    const obj = recordLike as Record<string, unknown>;

    const extracted = extractPlaintextFromObject(obj);
    if (extracted) {
      // Wallet/site often returns plaintext with double-quotes and \n; strip so the adapter can parse
      return normalizeCreditsRecordInput(sanitizeString(extracted));
    }

    throw new Error(
      'Record object has no decrypted/plaintext field. Pass plaintext (plaintext, recordPlaintext, record, value, data) or a Leo-shaped object (owner, microcredits). Ciphertext is not accepted.'
    );
  }

  throw new Error(`Invalid record input: expected string or object, got ${typeof recordLike}.`);
}

/**
 * Normalize Position record for executeTransaction. Same logic as credits: sanitize and pass through.
 * No parse/rebuild — pass the decrypted plaintext through (strip quotes and \\n) so the wallet sees the same format it produced.
 * (Stripping to 6 ABI fields fixes prover but breaks wallet parse; full plaintext parses but prover may fail.)
 */
export function normalizePositionRecordInput(recordLike: unknown): string {
  if (recordLike === null || recordLike === undefined) {
    throw new Error('Position record input is null or undefined.');
  }

  if (typeof recordLike === 'string') {
    const s = recordLike.trim();
    if (isCiphertext(s)) {
      throw new Error('Position record: ciphertext is not accepted. Pass the decrypted record.');
    }
    return sanitizeString(recordLike);
  }

  if (typeof recordLike === 'object' && recordLike !== null) {
    const obj = recordLike as Record<string, unknown>;

    const extracted = extractPlaintextFromObject(obj);
    if (extracted) {
      return normalizePositionRecordInput(sanitizeString(extracted));
    }

    throw new Error(
      'Position record object has no decrypted/plaintext field. Pass plaintext (recordPlaintext, plaintext, record, value, data) or a Leo-shaped object.'
    );
  }

  throw new Error(`Invalid Position record input: expected string or object, got ${typeof recordLike}.`);
}

/**
 * Extra cleaning for Shield wallet: trim, collapse whitespace, remove control characters.
 * Use only when forShield is true so the wallet displays the record input correctly.
 */
export function sanitizeRecordForShield(recordString: string): string {
  if (!recordString || typeof recordString !== 'string') return recordString;
  let out = recordString.trim();
  // Collapse any whitespace (including \t, \r, \n) to single space
  out = out.replace(/\s+/g, ' ');
  // Strip control characters that might break Shield display
  out = out.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  return out.trim();
}
