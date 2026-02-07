import { MarketState, UserPosition } from '@/types';
import { fetchMarketMappingValue, fetchMarketMappingValueString } from './chainRead';
import { findPositionRecordForMarket, parsePositionRecord } from './positionRecords';

const MARKET_STATE_CACHE_TTL_MS = 45 * 1000; // 45 seconds
const marketStateCache = new Map<string, { data: MarketState; timestamp: number }>();

/**
 * Clear the getMarketState cache. Call after refresh or when market state may have changed.
 */
export function clearMarketStateCache(): void {
  marketStateCache.clear();
}

/**
 * Get market state (AMM-based). Cached per marketId for 45 seconds to reduce API load.
 */
export async function getMarketState(marketId: string): Promise<MarketState> {
  const cached = marketStateCache.get(marketId);
  if (cached && Date.now() - cached.timestamp < MARKET_STATE_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const [status, yesReserve, noReserve, collateralPool, feeBps, outcomeValue] = await Promise.all([
      fetchMarketMappingValue('market_status', marketId),
      fetchMarketMappingValue('market_yes_reserve', marketId),
      fetchMarketMappingValue('market_no_reserve', marketId),
      fetchMarketMappingValue('market_collateral_pool', marketId),
      fetchMarketMappingValue('market_fee_bps', marketId),
      fetchMarketMappingValueString('market_outcome', marketId).catch(() => null),
    ]);

    const SCALE = 10000;
    const priceYes =
      Number(yesReserve) + Number(noReserve) > 0
        ? Math.floor((Number(noReserve) * SCALE) / (Number(yesReserve) + Number(noReserve)))
        : SCALE / 2;

    let outcome: boolean | null = null;
    if (outcomeValue != null && outcomeValue.trim().length > 0) {
      const cleaned = outcomeValue.trim().replace(/^["']|["']$/g, '').replace(/\.(private|public)$/i, '').trim();
      const raw = cleaned.toLowerCase();
      outcome = raw === 'true' || raw === '1';
    }

    const isPaused = Number(status) === 2;

    const state: MarketState = {
      status: Number(status),
      outcome,
      priceYes: Number(priceYes),
      collateralPool: Number(collateralPool),
      yesReserve: Number(yesReserve),
      noReserve: Number(noReserve),
      feeBps: Number(feeBps),
      isPaused,
    };
    marketStateCache.set(marketId, { data: state, timestamp: Date.now() });
    return state;
  } catch (error: any) {
    throw error;
  }
}

/**
 * Get user position from private Position records
 */
export async function getUserPositionRecords(
  wallet: any,
  programId: string,
  marketId: string,
  requestRecords?: (programId: string, decrypt?: boolean) => Promise<any[]>
): Promise<UserPosition | null> {
  try {
    if (!wallet) {
      throw new Error('Wallet adapter not available');
    }

    let requestRecordsFn: ((programId: string, decrypt?: boolean) => Promise<any[]>) | null = null;
    if (requestRecords && typeof requestRecords === 'function') {
      requestRecordsFn = requestRecords;
    } else if (typeof wallet.requestRecords === 'function') {
      requestRecordsFn = wallet.requestRecords.bind(wallet);
    } else if (wallet.wallet && typeof wallet.wallet.requestRecords === 'function') {
      requestRecordsFn = wallet.wallet.requestRecords.bind(wallet.wallet);
    } else if (wallet.adapter && typeof wallet.adapter.requestRecords === 'function') {
      requestRecordsFn = wallet.adapter.requestRecords.bind(wallet.adapter);
    }

    if (!requestRecordsFn) {
      throw new Error('Wallet adapter not available or does not support requestRecords');
    }

    const allRecords = await requestRecordsFn(programId);
    if (!allRecords || allRecords.length === 0) {
      return null;
    }

    const positionRecord = findPositionRecordForMarket(allRecords as any[], marketId);
    return positionRecord ? parsePositionRecord(positionRecord) : null;
  } catch (error) {
    throw error;
  }
}
