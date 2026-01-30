/**
 * Market Registry - On-chain Market Enumeration
 * 
 * This module provides efficient market discovery by reading enumeration mappings
 * directly from the Aleo chain:
 * 
 * - `total_markets[0u64]` → total count of markets
 * - `market_index[i]` → market_id at index i (for i in [0..count-1])
 * 
 * For each market_id, we fetch:
 * - `market_status[market_id]` → status (0=open, 1=resolved, 2=paused)
 * - `market_metadata_hash[market_id]` → metadata hash
 * - `market_creator[market_id]` → creator address
 * - `last_price_update[market_id]` → last price update timestamp
 * 
 * This replaces the previous transaction-based discovery approach with a more
 * efficient on-chain enumeration system.
 */

import {
  getTotalMarketsCount,
  getMarketIdAtIndex,
  fetchMarketMappingValue,
  fetchMarketMappingValueString,
  fetchMarketCreator,
} from '@/components/aleo/rpc/chainRead';

export interface MarketRegistryEntry {
  marketId: string;
  status: number | null; // 0=open, 1=resolved, 2=paused
  metadataHash: string | null;
  creator: string | null;
  lastPriceUpdate: number | null;
}

interface CacheEntry {
  data: MarketRegistryEntry[];
  timestamp: number;
}

// In-memory cache with 5 minute TTL
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cache: CacheEntry | null = null;

/**
 * Clear the market registry cache
 * Call this after market creation to ensure fresh data
 */
export function clearMarketRegistryCache(): void {
  cache = null;
}

/**
 * Get all market IDs from chain enumeration
 * Reads total_markets[0] and iterates market_index[i] for all indices
 * 
 * @param limit - Optional limit on number of markets to fetch (for pagination)
 * @param offset - Optional offset for pagination
 * @returns Array of market IDs
 */
export async function getAllMarketsFromChain(
  limit?: number,
  offset: number = 0
): Promise<string[]> {
  try {
    // Get total count from mapping
    const totalCount = await getTotalMarketsCount();
    
    if (totalCount === 0) return [];

    const startIndex = offset;
    const endIndex = limit ? Math.min(offset + limit, totalCount) : totalCount;
    const marketIds: string[] = [];
    
    for (let i = startIndex; i < endIndex; i++) {
      try {
        const marketId = await getMarketIdAtIndex(i);
        if (marketId && marketId.length > 0) marketIds.push(marketId);
      } catch {
        continue;
      }
    }

    return marketIds;
  } catch {
    return [];
  }
}

/**
 * Fetch registry data for a single market
 * Gets status, metadata_hash, creator, and last_price_update
 * 
 * @param marketId - Market ID to fetch data for
 * @returns MarketRegistryEntry with data, or null if market doesn't exist
 */
export async function getMarketRegistryData(
  marketId: string
): Promise<MarketRegistryEntry | null> {
  try {
    // Fetch all market data in parallel
    const [status, metadataHash, creator, lastPriceUpdate] = await Promise.allSettled([
      fetchMarketMappingValue('market_status', marketId).catch(() => null),
      fetchMarketMappingValueString('market_metadata_hash', marketId).catch(() => null),
      fetchMarketCreator(marketId).catch(() => null),
      fetchMarketMappingValue('last_price_update', marketId).catch(() => null),
    ]);

    // Extract values from Promise.allSettled results
    const statusValue = status.status === 'fulfilled' ? status.value : null;
    const metadataHashValue = metadataHash.status === 'fulfilled' ? metadataHash.value : null;
    const creatorValue = creator.status === 'fulfilled' ? creator.value : null;
    const lastPriceUpdateValue = lastPriceUpdate.status === 'fulfilled' ? lastPriceUpdate.value : null;

    // If status is null, market doesn't exist
    if (statusValue === null) {
      return null;
    }

    return {
      marketId,
      status: statusValue !== null ? Number(statusValue) : null,
      metadataHash: metadataHashValue,
      creator: creatorValue,
      lastPriceUpdate: lastPriceUpdateValue !== null ? Number(lastPriceUpdateValue) : null,
    };
  } catch {
    return {
      marketId,
      status: null,
      metadataHash: null,
      creator: null,
      lastPriceUpdate: null,
    };
  }
}

/**
 * Get all markets with their registry data
 * Combines enumeration + data fetching with error handling
 * 
 * @param limit - Optional limit on number of markets to fetch
 * @param offset - Optional offset for pagination
 * @param useCache - Whether to use cached data (default: true)
 * @returns Array of MarketRegistryEntry objects
 */
export async function getAllMarketsWithData(
  limit?: number,
  offset: number = 0,
  useCache: boolean = true
): Promise<MarketRegistryEntry[]> {
  // Check cache if enabled
  if (useCache && cache) {
    const cacheAge = Date.now() - cache.timestamp;
    if (cacheAge < CACHE_TTL_MS) {
      const cachedMarkets = cache.data;
      if (offset === 0 && (!limit || limit >= cachedMarkets.length)) return cachedMarkets;
      return cachedMarkets.slice(offset, limit ? offset + limit : undefined);
    }
  }

  try {
    // Get all market IDs from enumeration
    const marketIds = await getAllMarketsFromChain(limit, offset);
    
    if (marketIds.length === 0) return [];

    // Fetch data for all markets in parallel (with error handling)
    const marketDataPromises = marketIds.map(marketId => getMarketRegistryData(marketId));
    const results = await Promise.allSettled(marketDataPromises);
    
    const markets: MarketRegistryEntry[] = [];
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        markets.push(result.value);
      } else {
        // If market data fetch failed, include with null fields
        const marketId = marketIds[results.indexOf(result)];
        markets.push({
          marketId,
          status: null,
          metadataHash: null,
          creator: null,
          lastPriceUpdate: null,
        });
      }
    }

    // Update cache if fetching all markets (no pagination)
    if (useCache && offset === 0 && (!limit || limit >= markets.length)) {
      cache = {
        data: markets,
        timestamp: Date.now(),
      };
    }

    return markets;
  } catch {
    return [];
  }
}

/**
 * Get only active markets (status === 0)
 * Filters markets where status is STATUS_OPEN (0)
 * 
 * @param limit - Optional limit on number of markets to fetch
 * @param offset - Optional offset for pagination
 * @param useCache - Whether to use cached data (default: true)
 * @returns Array of active MarketRegistryEntry objects
 */
export async function getActiveMarkets(
  limit?: number,
  offset: number = 0,
  useCache: boolean = true
): Promise<MarketRegistryEntry[]> {
  const allMarkets = await getAllMarketsWithData(limit, offset, useCache);
  
  return allMarkets.filter(market => market.status === 0);
}

/**
 * Get active market IDs only (for backward compatibility)
 * Returns just the market IDs, not full registry data
 * 
 * @returns Array of active market IDs
 */
export async function getActiveMarketIds(): Promise<string[]> {
  const activeMarkets = await getActiveMarkets();
  return activeMarkets.map(m => m.marketId);
}
