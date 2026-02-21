import React, { useState, useEffect, useMemo } from 'react';
import type { NextPageWithLayout } from '@/types';
import { NextSeo } from 'next-seo';
import Layout from '@/layouts/_layout';
import { useRouter } from 'next/router';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { getMarketState, discoverMarketsFromChain, getAllMarkets, clearMarketRegistryCache, clearMarketStateCache, MarketRegistryEntry } from '@/lib/aleo/rpc';
import { MarketState, MarketMetadata } from '@/types';
import { calculatePriceFromReserves } from '@/utils/positionHelpers';
import { toCredits } from '@/utils/credits';
import { formatPriceCents } from '@/utils/priceDisplay';
import { CreateMarketForm } from '@/components/market/CreateMarketForm';
import { getMarketsMetadata, saveMissingMarketMetadata } from '@/services/marketMetadata';
import { getCachedMarketStates, setCachedMarketStates, backfillMarketStateCache } from '@/services/marketStateCache';
import { useTransaction } from '@/contexts/TransactionContext';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { AnimatedPrice } from '@/components/ui/AnimatedPrice';
import { useIntersectionObserver } from '@/hooks/use-intersection-observer';

function defaultMetadata(marketId: string) {
  return {
    title: `Market ${marketId.slice(0, 8)}...`,
    description: 'Prediction market',
    category: 'General',
  };
}

interface MarketCardData extends MarketMetadata {
  state: MarketState | null;
  loading: boolean;
  error: string | null;
}

const MarketsPage: NextPageWithLayout = () => {
  const router = useRouter();
  const walletHook = useWallet();
  const { publicKey, wallet, address, connected } = walletHook;
  const { addTransaction } = useTransaction();
  const [markets, setMarkets] = useState<MarketCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [marketsGridRef, marketsGridVisible] = useIntersectionObserver({ threshold: 0.1 });

  const isWalletConnected = Boolean(publicKey || address || (connected && wallet));

  const categories = useMemo(() => {
    const cats = new Set<string>();
    markets.forEach((m) => {
      if (m.category && m.category.trim()) cats.add(m.category.trim());
    });
    return ['All', ...Array.from(cats).sort()];
  }, [markets]);

  const filteredMarkets = useMemo(() => {
    let list = markets;
    if (categoryFilter !== 'All') {
      list = list.filter((m) => (m.category ?? '').trim() === categoryFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          (m.description ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [markets, categoryFilter, searchQuery]);

  const loadMarkets = async () => {
    setLoading(true);
    setDiscovering(true);

    try {
      // Primary: Use on-chain enumeration via market registry
      let allMarketIds = new Set<string>();
      let registryMarkets: MarketRegistryEntry[] = [];
      
      try {
        const registryData = await getAllMarkets();
        registryMarkets = registryData;
        registryData.forEach(m => allMarketIds.add(m.marketId));
      } catch (enumError) {
      }
      
      // Fallback: Discover markets from chain (for markets created before enumeration was added)
      // Only use if enumeration returned no results
      if (allMarketIds.size === 0) {
        try {
          const discoveredMarketIds = await discoverMarketsFromChain();
          discoveredMarketIds.forEach(id => allMarketIds.add(id));
          // Save discovered markets to Supabase (with minimal data since we don't have registry info)
          if (discoveredMarketIds.length > 0) {
            const marketsToSave = discoveredMarketIds.map(marketId => ({
              marketId,
              metadataHash: null, // Not available from transaction discovery
            }));
            
            saveMissingMarketMetadata(marketsToSave)
              .then(() => backfillMarketStateCache(discoveredMarketIds))
              .catch(() => {});
          }
        } catch {
          // Transaction discovery failed; enumeration results used
        }
      }

      // Fetch metadata from Supabase (falls back to empty if not configured)
      const metadataMap = await getMarketsMetadata(Array.from(allMarketIds));

      // Save any markets that don't have metadata in Supabase yet
      // This ensures all discovered markets are persisted for easy retrieval
      if (registryMarkets.length > 0) {
        const marketsToSave = registryMarkets.map(m => ({
          marketId: m.marketId,
          metadataHash: m.metadataHash ?? null,
        }));
        
        // Save missing markets in background (non-blocking), then backfill cache table
        saveMissingMarketMetadata(marketsToSave)
          .then(() => backfillMarketStateCache(marketsToSave.map((m) => m.marketId)))
          .catch(() => {});
      }

      // Create market list with registry data
      const marketList: MarketCardData[] = Array.from(allMarketIds).map((marketId) => {
        const meta = metadataMap[marketId] ?? defaultMetadata(marketId);
        return {
          marketId,
          ...meta,
          state: null,
          loading: true,
          error: null,
        };
      });

      // Filter to active (open) markets using registry status, or include if status unknown so we load state
      const openFromRegistry = new Set(
        registryMarkets.filter(r => r.status === 0).map(r => r.marketId)
      );
      const unknownStatus = new Set(
        registryMarkets.filter(r => r.status === null || r.status === undefined).map(r => r.marketId)
      );
      const initialList = marketList.filter(m =>
        openFromRegistry.has(m.marketId) || unknownStatus.has(m.marketId)
      );

      // Read cache first for fast first paint
      const cachedStates = await getCachedMarketStates(initialList.map((m) => m.marketId));
      const firstPaintList = initialList.map((market) => {
        const state = cachedStates[market.marketId];
        return state
          ? { ...market, state, loading: false, error: null }
          : { ...market, state: null, loading: true, error: null };
      });
      setMarkets(firstPaintList);
      setLoading(false);
      setDiscovering(false);

      // Fetch full state only for cache misses
      const toFetch = initialList.filter((m) => !cachedStates[m.marketId]);
      const marketPromises = toFetch.map(async (market) => {
        try {
          const state = await getMarketState(market.marketId);
          return {
            ...market,
            state,
            loading: false,
            error: null,
          };
        } catch (err: any) {
          return {
            ...market,
            state: null,
            loading: false,
            error: err.message || 'Failed to load',
          };
        }
      });

      const fetchedResults = await Promise.all(marketPromises);
      const fetchedByMarketId = new Map(fetchedResults.map((r) => [r.marketId, r]));
      const mergedResults = initialList.map((market) => {
        const cached = cachedStates[market.marketId];
        if (cached) {
          return { ...market, state: cached, loading: false, error: null };
        }
        const fetched = fetchedByMarketId.get(market.marketId);
        return fetched ?? { ...market, state: null, loading: false, error: 'Failed to load' };
      });
      setMarkets(mergedResults);

      // Write back fetched state to cache (fire-and-forget)
      const toCache = fetchedResults
        .filter((r) => r.state !== null)
        .map((r) => ({ marketId: r.marketId, state: r.state! }));
      if (toCache.length > 0) setCachedMarketStates(toCache).catch(() => {});
    } catch {
      setMarkets([]);
    } finally {
      setLoading(false);
      setDiscovering(false);
    }
  };

  useEffect(() => {
    loadMarkets();
  }, []);

  const handleMarketCreated = (txId?: string) => {
    if (txId) addTransaction({ id: txId, label: 'Create market' });
    setShowCreateModal(false);
    clearMarketRegistryCache();
    clearMarketStateCache();
  };

  const handleMarketClick = (marketId: string) => {
    router.push(`/market?marketId=${encodeURIComponent(marketId)}`);
  };

  const getStatusBadge = (status: number) => {
    switch (status) {
      case 0:
        return <span className="badge badge-success">Open</span>;
      case 1:
        return <span className="badge badge-warning">Resolved</span>;
      case 2:
        return <span className="badge badge-error">Paused</span>;
      default:
        return <span className="badge badge-ghost">Unknown</span>;
    }
  };

  return (
    <>
      <NextSeo
        title="Markets | WhisperMarket"
        description="Browse and participate in prediction markets"
      />

      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="mb-6 flex flex-col sm:flex-row justify-between items-start gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold mb-1">Markets</h1>
            <p className="text-base-content text-sm sm:text-base">
              Browse available markets and place your predictions
              {!loading && markets.length > 0 && (
                <span className="ml-2 text-base-content">· {markets.length} market{markets.length !== 1 ? 's' : ''}</span>
              )}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              className="btn btn-ghost btn-sm sm:btn-md gap-2"
              onClick={() => {
                clearMarketRegistryCache();
                clearMarketStateCache();
                loadMarkets();
              }}
              disabled={loading || discovering}
              title="Refresh markets list"
            >
              {loading || discovering ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:h-5 sm:w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span className="hidden sm:inline">Refresh</span>
                </>
              )}
            </button>
            <button
              className="btn btn-primary btn-sm sm:btn-md"
              onClick={() => setShowCreateModal(true)}
              disabled={!isWalletConnected}
            >
              {isWalletConnected ? 'Create Market' : 'Connect to Create'}
            </button>
          </div>
        </div>

        {discovering && (
          <div className="alert alert-info mb-6">
            <span className="loading loading-spinner loading-sm mr-2" />
            Discovering markets from chain...
          </div>
        )}

        {!loading && markets.length > 0 && (
          <div className="mb-6 flex flex-col sm:flex-row gap-4">
            <input
              type="text"
              placeholder="Search markets..."
              className="input input-bordered input-sm sm:input-md w-full sm:max-w-xs"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`btn btn-sm ${categoryFilter === cat ? 'btn-primary' : 'btn-ghost'}`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : filteredMarkets.length === 0 ? (
          <div className="card bg-base-200 shadow-xl">
            <div className="card-body">
              <h2 className="card-title text-warning">No Markets Match</h2>
              <p className="text-base-content">
                {markets.length === 0
                  ? 'No markets have been discovered on-chain yet. Markets will appear here once they are initialized.'
                  : 'No markets match your search or category filter. Try changing the filter or search.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredMarkets.map((market, idx) => {
              const priceYes = market.state
                ? calculatePriceFromReserves(market.state.yesReserve, market.state.noReserve)
                : 0;
              const priceNo = 10000 - priceYes;

              return (
                <div
                  key={market.marketId}
                  className="card bg-base-100 shadow-md hover:shadow-lg transition-all duration-200 cursor-pointer border border-base-200 hover:border-base-300 rounded-xl hover:-translate-y-0.5"
                  onClick={() => handleMarketClick(market.marketId)}
                >
                  <div className="card-body py-4">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h2 className="card-title text-base leading-tight line-clamp-2 flex-1">{market.title}</h2>
                      {market.state && getStatusBadge(market.state.status)}
                    </div>
                    {market.category && (
                      <span className="badge badge-ghost badge-sm text-xs mb-2">{market.category}</span>
                    )}
                    <p className="text-sm text-base-content/80 line-clamp-2 mb-3">
                      {market.description}
                    </p>

                    {market.error ? (
                      <p className="text-xs text-error mb-3">{market.error}</p>
                    ) : market.state ? (
                      <div className="space-y-2">
                        <div className="flex w-full rounded-full overflow-hidden bg-base-200 h-2">
                          <div
                            className="bg-success h-full transition-all"
                            style={{ width: `${(priceYes / 10000) * 100}%` }}
                          />
                          <div
                            className="bg-error h-full transition-all"
                            style={{ width: `${(priceNo / 10000) * 100}%` }}
                          />
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-success font-medium"><AnimatedPrice priceBps={priceYes} decimals={1} showChange />¢ YES</span>
                          <span className="text-base-content/70">
                            Pool {toCredits(market.state.collateralPool).toLocaleString(undefined, { maximumFractionDigits: 0 })} · {(market.state.feeBps / 100).toFixed(1)}% fee
                          </span>
                          <span className="text-error font-medium"><AnimatedPrice priceBps={priceNo} decimals={1} showChange />¢ NO</span>
                        </div>
                        {market.state.outcome !== null && (
                          <p className="text-xs text-info">Resolved: {market.state.outcome ? 'YES' : 'NO'}</p>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-warning mb-2">Loading…</p>
                    )}

                    <div className="card-actions justify-end mt-3">
                      <button className="btn btn-primary btn-sm">View Market</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Create Market Modal */}
        {showCreateModal && (
          <div className="modal modal-open">
            <div className="modal-box max-w-2xl">
              <CreateMarketForm
                onSuccess={handleMarketCreated}
                onCancel={() => setShowCreateModal(false)}
              />
            </div>
            <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}></div>
          </div>
        )}
      </div>
    </>
  );
};

MarketsPage.getLayout = (page) => <Layout>{page}</Layout>;
export default MarketsPage;
