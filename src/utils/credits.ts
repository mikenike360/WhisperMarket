/**
 * Credit / microcredit conversion for Aleo (1 credit = 1,000,000 microcredits).
 * Use for UI ↔ program boundary: user input in credits, chain/program in microcredits.
 */

export const MICROCREDITS_PER_CREDIT = 1_000_000;

export function toMicrocredits(credits: number): number {
  return credits * MICROCREDITS_PER_CREDIT;
}

export function toCredits(microcredits: number): number {
  return microcredits / MICROCREDITS_PER_CREDIT;
}

/**
 * Format microcredits for display as credits (e.g. "1.5 credits").
 */
export function formatCredits(microcredits: number): string {
  return `${toCredits(microcredits).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} credits`;
}
