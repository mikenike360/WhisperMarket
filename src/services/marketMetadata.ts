/**
 * Market metadata CRUD via Supabase.
 * Falls back gracefully when Supabase is not configured or fails.
 */
import { getSupabase } from '@/lib/supabase';
import type { MarketMetadata } from '@/types';

export type CreateMarketMetadataInput = {
  market_id: string;
  title: string;
  description: string;
  category?: string;
  creator_address?: string;
  transaction_id?: string;
  metadata_hash?: string;
};

const TABLE = 'markets';

export async function createMarketMetadata(data: CreateMarketMetadataInput): Promise<boolean> {
  const client = getSupabase();
  if (!client) return false;
  try {
    // Use upsert to handle cases where metadata might already exist
    // This prevents errors if we try to save the same market_id twice
    const { error } = await client.from(TABLE).upsert({
      market_id: data.market_id,
      title: data.title,
      description: data.description,
      category: data.category ?? 'General',
      creator_address: data.creator_address ?? null,
      transaction_id: data.transaction_id ?? null,
      metadata_hash: data.metadata_hash ?? null,
    }, {
      onConflict: 'market_id', // Update if market_id already exists
    });
    
    if (error) return false;
    return true;
  } catch {
    return false;
  }
}

export async function getMarketMetadata(marketId: string): Promise<MarketMetadata | null> {
  const client = getSupabase();
  if (!client) return null;
  try {
    const { data, error } = await client.from(TABLE).select('market_id, title, description, category').eq('market_id', marketId).single();
    if (error || !data) return null;
    return {
      marketId: data.market_id,
      title: data.title,
      description: data.description,
      category: data.category ?? 'General',
    };
  } catch {
    return null;
  }
}

export async function getMarketsMetadata(marketIds: string[]): Promise<Record<string, Omit<MarketMetadata, 'marketId'>>> {
  const client = getSupabase();
  if (!client || marketIds.length === 0) return {};
  try {
    const { data, error } = await client.from(TABLE).select('market_id, title, description, category').in('market_id', marketIds);
    if (error || !data) return {};
    const map: Record<string, Omit<MarketMetadata, 'marketId'>> = {};
    for (const row of data) {
      map[row.market_id] = {
        title: row.title,
        description: row.description,
        category: row.category ?? 'General',
      };
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * Save market metadata for markets that don't exist in Supabase yet
 * Uses registry data (creator, metadata_hash) when available
 * 
 * @param markets - Array of market registry entries to save
 * @returns Number of markets successfully saved
 */
export async function saveMissingMarketMetadata(
  markets: Array<{
    marketId: string;
    creator: string | null;
    metadataHash: string | null;
  }>
): Promise<number> {
  const client = getSupabase();
  if (!client || markets.length === 0) return 0;

  try {
    // Get list of market IDs that already exist in Supabase
    const marketIds = markets.map(m => m.marketId);
    const { data: existingMarkets } = await client
      .from(TABLE)
      .select('market_id')
      .in('market_id', marketIds);

    const existingIds = new Set(existingMarkets?.map((m: any) => m.market_id) || []);

    // Filter to only markets that don't exist yet
    const marketsToSave = markets.filter(m => !existingIds.has(m.marketId));

    if (marketsToSave.length === 0) return 0;

    // Save each market (using upsert to be safe)
    // But only if it doesn't already exist with real metadata
    // Also check localStorage for pending metadata from market creation
    let savedCount = 0;
    for (const market of marketsToSave) {
      try {
        // Double-check if market exists with real metadata (race condition protection)
        const { data: existing } = await client
          .from(TABLE)
          .select('market_id, title, description')
          .eq('market_id', market.marketId)
          .single();
        
        // Skip if market exists and has real metadata (not defaults)
        if (existing && existing.title && 
            !existing.title.startsWith('Market ') && 
            existing.description !== 'Prediction market discovered on-chain') {
          continue;
        }
        
        // Check localStorage for pending metadata (from market creation form)
        let pendingMetadata: any = null;
        if (typeof window !== 'undefined') {
          try {
            // Check all pending metadata keys
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key && key.startsWith('pending_market_metadata_')) {
                const stored = localStorage.getItem(key);
                if (stored) {
                  const parsed = JSON.parse(stored);
                  // Check if this pending metadata matches our market (by creator and recent timestamp)
                  if (parsed.creatorAddress === market.creator && 
                      Date.now() - parsed.timestamp < 300000) { // Within 5 minutes
                    pendingMetadata = parsed;
                    break;
                  }
                }
              }
            }
          } catch (err) {
            // Ignore localStorage errors
          }
        }
        
        // Use pending metadata if available, otherwise use defaults
        const title = pendingMetadata?.title || `Market ${market.marketId.slice(0, 8)}...`;
        const description = pendingMetadata?.description || 'Prediction market discovered on-chain';
        
        // Use upsert but only update if metadata is missing or is defaults
        const { error } = await client.from(TABLE).upsert({
          market_id: market.marketId,
          title,
          description,
          category: pendingMetadata?.category || 'General',
          creator_address: market.creator ?? null,
          metadata_hash: pendingMetadata?.metadataHash ?? market.metadataHash ?? null,
        }, {
          onConflict: 'market_id',
        });

        if (!error) {
          savedCount++;
          
          // Clear pending metadata from localStorage if we used it
          if (pendingMetadata && typeof window !== 'undefined') {
            try {
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('pending_market_metadata_')) {
                  const stored = localStorage.getItem(key);
                  if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed.creatorAddress === market.creator && 
                        Date.now() - parsed.timestamp < 300000) {
                      localStorage.removeItem(key);
                      break;
                    }
                  }
                }
              }
            } catch (err) {
              // Ignore localStorage errors
            }
          }
        }
      } catch {
        // Skip failed market
      }
    }

    return savedCount;
  } catch {
    return 0;
  }
}
