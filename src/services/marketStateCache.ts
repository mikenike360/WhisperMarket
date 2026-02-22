/**
 * Cache market chain state (reserves, status, outcome) in Supabase.
 * Reduces Provable RPC calls on markets page load.
 */
import { getSupabase } from '@/lib/supabase';
import type { MarketState } from '@/types';
import { getMarketState } from '@/lib/aleo/rpc';

const TABLE = 'market_state_cache';
const CACHE_TTL_SEC = 60; // Treat cache as fresh for 60 seconds

function rowToState(row: MarketStateCacheRow): MarketState {
  return {
    status: Number(row.status),
    outcome: row.outcome === null ? null : row.outcome === true,
    priceYes: Number(row.price_yes),
    collateralPool: Number(row.collateral_pool),
    yesReserve: Number(row.yes_reserve),
    noReserve: Number(row.no_reserve),
    feeBps: Number(row.fee_bps),
    isPaused: Boolean(row.is_paused),
  };
}

interface MarketStateCacheRow {
  market_id: string;
  status: number;
  outcome: boolean | null;
  price_yes: number;
  collateral_pool: number;
  yes_reserve: number;
  no_reserve: number;
  fee_bps: number;
  is_paused: boolean;
  updated_at: string;
}

/**
 * Get market IDs that have status open (0) in the cache.
 * No TTL filter so we can show whatever we have for fast first paint.
 */
export async function getOpenMarketIdsFromCache(): Promise<string[]> {
  const client = getSupabase();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from(TABLE)
      .select('market_id')
      .eq('status', 0);

    if (error || !data || !Array.isArray(data)) return [];
    return (data as { market_id: string }[]).map((r) => r.market_id);
  } catch {
    return [];
  }
}

/**
 * Get cached market states for the given market IDs.
 * Only returns entries that are within CACHE_TTL_SEC unless allowStale is true.
 */
export async function getCachedMarketStates(
  marketIds: string[],
  options?: { allowStale?: boolean }
): Promise<Record<string, MarketState>> {
  const client = getSupabase();
  if (!client || marketIds.length === 0) return {};

  try {
    let query = client.from(TABLE).select('*').in('market_id', marketIds);
    if (!options?.allowStale) {
      const cutoff = new Date(Date.now() - CACHE_TTL_SEC * 1000).toISOString();
      query = query.gte('updated_at', cutoff);
    }
    const { data, error } = await query;

    if (error || !data || !Array.isArray(data)) return {};

    const out: Record<string, MarketState> = {};
    for (const row of data as MarketStateCacheRow[]) {
      out[row.market_id] = rowToState(row);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Upsert cached state for one or more markets.
 */
export async function setCachedMarketStates(
  entries: Array<{ marketId: string; state: MarketState }>
): Promise<void> {
  const client = getSupabase();
  if (!client || entries.length === 0) return;

  try {
    const rows = entries.map(({ marketId, state }) => ({
      market_id: marketId,
      status: state.status,
      outcome: state.outcome,
      price_yes: state.priceYes,
      collateral_pool: state.collateralPool,
      yes_reserve: state.yesReserve,
      no_reserve: state.noReserve,
      fee_bps: state.feeBps,
      is_paused: state.isPaused,
      updated_at: new Date().toISOString(),
    }));

    await client.from(TABLE).upsert(rows, {
      onConflict: 'market_id',
    });
  } catch {
    // Non-blocking; ignore
  }
}

/**
 * Fetch on-chain state for the given market IDs and write to market_state_cache.
 * Used when backfilling markets table so the cache table stays in sync.
 * Non-throwing; returns the number of markets successfully cached.
 */
export async function backfillMarketStateCache(marketIds: string[]): Promise<number> {
  const client = getSupabase();
  if (!client || marketIds.length === 0) return 0;

  try {
    const results = await Promise.allSettled(
      marketIds.map((marketId) => getMarketState(marketId))
    );
    const entries: Array<{ marketId: string; state: MarketState }> = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value) {
        entries.push({ marketId: marketIds[i], state: result.value });
      }
    });
    if (entries.length > 0) {
      await setCachedMarketStates(entries);
    }
    return entries.length;
  } catch {
    return 0;
  }
}
