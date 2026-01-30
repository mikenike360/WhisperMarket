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
  
  // Extract values, handling .private suffixes
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
 * Calculate expected swap output using AMM formula
 * When swapping collateral for YES:
 *   - Mint equal YES + NO tokens (1:1 with collateral)
 *   - Apply fee to NO tokens being swapped
 *   - Swap NO → YES: yes_out = (no_after_fee * yes_reserve) / (no_reserve + no_after_fee)
 *   - Total YES = minted_yes + yes_out
 *
 * When swapping collateral for NO:
 *   - Mint equal YES + NO tokens (1:1 with collateral)
 *   - Apply fee to YES tokens being swapped
 *   - Swap YES → NO: no_out = (yes_after_fee * no_reserve) / (yes_reserve + yes_after_fee)
 *   - Total NO = minted_no + no_out
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

  // Mint equal YES and NO tokens (1:1 with collateral)
  const mintedYes = collateralInU128;
  const mintedNo = collateralInU128;

  if (side === 'yes') {
    // Swap NO → YES
    // Apply fee to NO tokens being swapped
    const fee = (mintedNo * feeBpsU64) / FEE_SCALE;
    const noAfterFee = mintedNo - fee;

    // Swap NO → YES using CPMM
    // yes_out = (no_after_fee * yes_reserve) / (no_reserve + no_after_fee)
    const yesOut = (noAfterFee * yesReserveU128) / (noReserveU128 + noAfterFee);

    // Total YES = minted_yes + yes_out
    return Number(mintedYes + yesOut);
  } else {
    // Swap YES → NO
    // Apply fee to YES tokens being swapped
    const fee = (mintedYes * feeBpsU64) / FEE_SCALE;
    const yesAfterFee = mintedYes - fee;

    // Swap YES → NO using CPMM
    // no_out = (yes_after_fee * no_reserve) / (yes_reserve + yes_after_fee)
    const noOut = (yesAfterFee * noReserveU128) / (yesReserveU128 + yesAfterFee);

    // Total NO = minted_no + no_out
    return Number(mintedNo + noOut);
  }
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
