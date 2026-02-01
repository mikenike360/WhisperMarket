/**
 * Sanitizes Shield-returned credits records into plaintext format for executeTransaction.
 * Shield expects plaintext (Leo struct string), not ciphertext. Shield's adapter may return
 * plaintext wrapped with double quotes and escaped newlines — we unescape and normalize.
 */

const PLAINTEXT_KEYS = ['plaintext', 'recordPlaintext', 'record', 'value', 'data'] as const;

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
 * Sanitize a string that may have surrounding quotes and escaped newlines.
 */
function sanitizeString(s: string): string {
  let out = s.trim();
  // Strip surrounding double quotes if present
  if (out.length >= 2 && out.startsWith('"') && out.endsWith('"')) {
    out = out.slice(1, -1);
  }
  // Replace literal \n (backslash + n) with actual newline
  out = out.replace(/\\n/g, '\n');
  // Normalize whitespace: collapse multiple spaces/newlines to single space
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
 */
function extractPlaintextFromObject(obj: Record<string, unknown>): string | null {
  for (const key of PLAINTEXT_KEYS) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val;
    }
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
      return normalizeCreditsRecordInput(extracted);
    }

    throw new Error(
      'Record object has no decrypted/plaintext field. Pass plaintext (plaintext, recordPlaintext, record, value, data) or a Leo-shaped object (owner, microcredits). Ciphertext is not accepted.'
    );
  }

  throw new Error(`Invalid record input: expected string or object, got ${typeof recordLike}.`);
}
