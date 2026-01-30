/**
 * Price-per-share display: basis points (0–10000) to cents (0–100).
 * Polymarket-style "price per share in cents".
 */

/**
 * Convert price in basis points to cents (0–100 scale).
 */
export function priceBpsToCents(priceBps: number): number {
  return priceBps / 100;
}

/**
 * Format price in basis points as cents string, e.g. "65¢" or "65.0¢".
 * @param priceBps - Price in basis points (0–10000)
 * @param opts.decimals - 0 or 1 decimal place (default 0)
 */
export function formatPriceCents(
  priceBps: number,
  opts?: { decimals?: number }
): string {
  const decimals = opts?.decimals ?? 0;
  const cents = priceBpsToCents(priceBps);
  const formatted =
    decimals === 0
      ? Math.round(cents).toString()
      : cents.toFixed(1);
  return `${formatted}¢`;
}
