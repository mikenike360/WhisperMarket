/**
 * Convert Aleo bech32 address to the field key used for user_collateral (and other) mappings.
 * In Leo, "address as field" uses the address bytes (bech32m payload) as little-endian field element.
 */
import { bech32m } from 'bech32';

/**
 * Returns the mapping key string for a given Aleo address (e.g. for user_collateral).
 * Address uses bech32m; the 32-byte payload interpreted as LE bigint is the field representation.
 */
export function addressToFieldKey(address: string): string {
  const trimmed = address.trim();
  if (!trimmed || trimmed.length < 10) {
    throw new Error('Invalid Aleo address');
  }
  // If already in "numberfield" form, return as-is
  if (/^\d+field$/.test(trimmed)) {
    return trimmed;
  }
  const decoded = bech32m.decode(trimmed);
  const bytes = bech32m.fromWords(decoded.words);
  if (bytes.length !== 32) {
    throw new Error(`Expected 32-byte address payload, got ${bytes.length}`);
  }
  let fieldValue = 0n;
  for (let i = 0; i < bytes.length; i++) {
    fieldValue += BigInt(bytes[i]) * (256n ** BigInt(i));
  }
  return `${fieldValue}field`;
}
