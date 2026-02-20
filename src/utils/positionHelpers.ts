/**
 * Utility functions for working with Position records and AMM calculations
 */

import { UserPosition } from '@/types';

const SCALE = 10000; // Basis points scale

/**
 * Parse Position record from Aleo record format
 * @param record - Aleo record object
 */
export function parsePositionRecord(record: any): UserPosition {
  const recordData = record.data || record;

  // Extract values, handling .private suffixes. collateral_available removed in global-collateral program; default 0.
  const marketId = extractFieldValue(recordData.market_id);
  const yesShares = extractU128Value(recordData.yes_shares);
  const noShares = extractU128Value(recordData.no_shares);
  const collateralAvailable = recordData.collateral_available !== undefined ? extractU128Value(recordData.collateral_available) : 0;
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
 * Calculate YES price from AMM reserves
 * Formula: priceYes = (noReserve * SCALE) / (yesReserve + noReserve)
 * @param yesReserve - YES token reserve
 * @param noReserve - NO token reserve
 * @returns Price in basis points (0-10000)
 */
export function calculatePriceFromReserves(
  yesReserve: number,
  noReserve: number
): number {
  if (yesReserve === 0 && noReserve === 0) {
    return SCALE / 2; // Default to 50% if no reserves
  }
  return Math.floor((noReserve * SCALE) / (yesReserve + noReserve));
}

/**
 * Calculate expected swap output using AMM formula (matches mint_yes_only_private / mint_no_only_private).
 * When swapping collateral for YES:
 *   - Apply fee to collateral: net = collateral_in - (collateral_in * fee_bps / FEE_SCALE)
 *   - Mint net YES + net NO tokens
 *   - Swap net NO → YES: no_effective = net * (FEE_SCALE - fee_bps) / FEE_SCALE
 *   - Swap output: yes_out = (no_effective * yes_reserve) / (no_reserve + no_effective)
 *   - Total YES = net + yes_out
 *
 * When swapping collateral for NO:
 *   - Apply fee to collateral: net = collateral_in - (collateral_in * fee_bps / FEE_SCALE)
 *   - Mint net YES + net NO tokens
 *   - Swap net YES → NO: yes_effective = net * (FEE_SCALE - fee_bps) / FEE_SCALE
 *   - Swap output: no_out = (yes_effective * no_reserve) / (yes_reserve + yes_effective)
 *   - Total NO = net + no_out
 *
 * Units: collateralIn, yesReserve, and noReserve must be in microcredits.
 * Return value is in microcredits. Use toCredits() for display.
 *
 * @param collateralIn - Collateral amount to swap (microcredits)
 * @param yesReserve - Current YES reserve (microcredits)
 * @param noReserve - Current NO reserve (microcredits)
 * @param feeBps - Fee in basis points
 * @param side - 'yes' or 'no'
 * @returns Expected output tokens (microcredits)
 */
export function calculateSwapOutput(
  collateralIn: number,
  yesReserve: number,
  noReserve: number,
  feeBps: number,
  side: 'yes' | 'no'
): number {
  if (yesReserve === 0 || noReserve === 0) {
    throw new Error('Reserves cannot be zero');
  }

  const collateralInU128 = BigInt(collateralIn);
  const yesReserveU128 = BigInt(yesReserve);
  const noReserveU128 = BigInt(noReserve);
  const feeBpsU64 = BigInt(feeBps);
  const FEE_SCALE = BigInt(SCALE);

  // Step 1: Apply fee to collateral (mint fee)
  const mintFee = (collateralInU128 * feeBpsU64) / FEE_SCALE;
  const net = collateralInU128 - mintFee;

  if (side === 'yes') {
    // Step 2: Swap net NO for YES
    const noAmount = net;
    const noEffective = (noAmount * (FEE_SCALE - feeBpsU64)) / FEE_SCALE;
    const yesOut = (noEffective * yesReserveU128) / (noReserveU128 + noEffective);
    // Step 3: Total YES = net (from mint) + yes_out (from swap)
    return Number(net + yesOut);
  } else {
    // Step 2: Swap net YES for NO
    const yesAmount = net;
    const yesEffective = (yesAmount * (FEE_SCALE - feeBpsU64)) / FEE_SCALE;
    const noOut = (yesEffective * noReserveU128) / (yesReserveU128 + yesEffective);
    // Step 3: Total NO = net (from mint) + no_out (from swap)
    return Number(net + noOut);
  }
}

/**
 * Return only the swap output (yes_out or no_out) for mint_yes_only / mint_no_only.
 * Use this to compute min_yes_out / min_no_out: the program asserts on the swap output, not the total.
 *
 * @returns Swap output in microcredits (yes_out for 'yes', no_out for 'no')
 */
export function calculateSwapOutputPart(
  collateralIn: number,
  yesReserve: number,
  noReserve: number,
  feeBps: number,
  side: 'yes' | 'no'
): number {
  if (yesReserve === 0 || noReserve === 0) {
    throw new Error('Reserves cannot be zero');
  }

  const collateralInU128 = BigInt(collateralIn);
  const yesReserveU128 = BigInt(yesReserve);
  const noReserveU128 = BigInt(noReserve);
  const feeBpsU64 = BigInt(feeBps);
  const FEE_SCALE = BigInt(SCALE);

  const mintFee = (collateralInU128 * feeBpsU64) / FEE_SCALE;
  const net = collateralInU128 - mintFee;

  if (side === 'yes') {
    const noEffective = (net * (FEE_SCALE - feeBpsU64)) / FEE_SCALE;
    const yesOut = (noEffective * yesReserveU128) / (noReserveU128 + noEffective);
    return Number(yesOut);
  } else {
    const yesEffective = (net * (FEE_SCALE - feeBpsU64)) / FEE_SCALE;
    const noOut = (yesEffective * noReserveU128) / (yesReserveU128 + yesEffective);
    return Number(noOut);
  }
}

/**
 * Calculate net output from mint_pairs_private (equal YES and NO).
 * Matches Leo: net = collateral_in - (collateral_in * fee_bps / FEE_SCALE)
 *
 * @param collateralIn - Collateral amount (microcredits)
 * @param feeBps - Fee in basis points
 * @returns Net amount received for each of YES and NO (microcredits)
 */
export function calculateMintNetOutput(
  collateralIn: number,
  feeBps: number
): number {
  const collateralInU128 = BigInt(collateralIn);
  const feeBpsU64 = BigInt(feeBps);
  const FEE_SCALE = BigInt(SCALE);
  const fee = (collateralInU128 * feeBpsU64) / FEE_SCALE;
  const net = collateralInU128 - fee;
  return Number(net);
}

/**
 * Calculate minimum output for mint_pairs_private with slippage.
 * Used for both min_yes_out and min_no_out (mint gives equal amounts).
 *
 * @param collateralIn - Collateral amount (microcredits)
 * @param feeBps - Fee in basis points
 * @param slippageTolerance - Slippage tolerance (e.g. 0.01 for 1%)
 * @returns Minimum output for each side (microcredits)
 */
export function calculateMintMinOutput(
  collateralIn: number,
  feeBps: number,
  slippageTolerance: number
): number {
  const net = calculateMintNetOutput(collateralIn, feeBps);
  const minOutput = Math.floor(net * (1 - slippageTolerance));
  return minOutput;
}

/**
 * Calculate collateral received when selling YES shares (v1 semantics; for display only).
 * In v2, selling YES gives NO tokens; use calculateSellYesNoOut for min_no_out.
 */
export function calculateSellYesOutput(
  yesIn: number,
  yesReserve: number,
  noReserve: number,
  feeBps: number
): number {
  return calculateSellYesNoOut(yesIn, yesReserve, noReserve, feeBps);
}

/**
 * v2: NO tokens received when selling YES (swap_yes_no_private). Fee on input: yes_effective = yes_amount * (FEE_SCALE - fee_bps) / FEE_SCALE; no_out = (yes_effective * no_reserve) / (yes_reserve + yes_effective).
 */
export function calculateSellYesNoOut(
  yesIn: number,
  yesReserve: number,
  noReserve: number,
  feeBps: number
): number {
  if (yesReserve === 0 || noReserve === 0) {
    throw new Error('Reserves cannot be zero');
  }
  const FEE_SCALE = BigInt(SCALE);
  const yesInU128 = BigInt(yesIn);
  const yesReserveU128 = BigInt(yesReserve);
  const noReserveU128 = BigInt(noReserve);
  const feeBpsU64 = BigInt(feeBps);
  const yesEffective = (yesInU128 * (FEE_SCALE - feeBpsU64)) / FEE_SCALE;
  const noOut = (yesEffective * noReserveU128) / (yesReserveU128 + yesEffective);
  return Number(noOut);
}

/**
 * Calculate collateral received when selling NO shares (v1 semantics; for display only).
 * In v2, selling NO gives YES tokens; use calculateSellNoYesOut for min_yes_out.
 */
export function calculateSellNoOutput(
  noIn: number,
  yesReserve: number,
  noReserve: number,
  feeBps: number
): number {
  return calculateSellNoYesOut(noIn, yesReserve, noReserve, feeBps);
}

/**
 * v2: YES tokens received when selling NO (swap_no_yes_private). Fee on input: no_effective = no_amount * (FEE_SCALE - fee_bps) / FEE_SCALE; yes_out = (no_effective * yes_reserve) / (no_reserve + no_effective).
 */
export function calculateSellNoYesOut(
  noIn: number,
  yesReserve: number,
  noReserve: number,
  feeBps: number
): number {
  if (yesReserve === 0 || noReserve === 0) {
    throw new Error('Reserves cannot be zero');
  }
  const FEE_SCALE = BigInt(SCALE);
  const noInU128 = BigInt(noIn);
  const yesReserveU128 = BigInt(yesReserve);
  const noReserveU128 = BigInt(noReserve);
  const feeBpsU64 = BigInt(feeBps);
  const noEffective = (noInU128 * (FEE_SCALE - feeBpsU64)) / FEE_SCALE;
  const yesOut = (noEffective * yesReserveU128) / (noReserveU128 + noEffective);
  return Number(yesOut);
}

/**
 * Find Position record for specific market from array of records
 * @param records - Array of Aleo records
 * @param marketId - Field-based market ID to search for
 * @returns Position record or null if not found
 */
export function findPositionRecord(records: any[], marketId: string): any | null {
  if (!records || records.length === 0) {
    return null;
  }

  return records.find((record: any) => {
    if (record.spent) return false;
    
    const recordData = record.data || record;
    if (recordData.market_id) {
      const recordMarketId = extractFieldValue(recordData.market_id);
      return recordMarketId === marketId;
    }
    return false;
  }) || null;
}

/**
 * Helper to extract field value from Aleo record format
 */
function extractFieldValue(value: any): string {
  if (typeof value === 'string') {
    return value.replace(/\.private$/, '');
  }
  if (value && typeof value === 'object') {
    return String(value);
  }
  return String(value);
}

/**
 * Extract u128 value from Aleo record format
 */
function extractU128Value(value: any): number {
  if (typeof value === 'string') {
    const cleanValue = value.replace(/\.private$/, '').replace(/u128$/, '');
    return parseInt(cleanValue, 10) || 0;
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

/**
 * Extract boolean value from Aleo record format
 */
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
