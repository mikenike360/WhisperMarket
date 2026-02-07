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
import { useTransaction } from '@/contexts/TransactionContext';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { AnimatedPrice } from '@/components/ui/AnimatedPrice';
import { LiquidityBar } from '@/components/market/LiquidityBar';
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
              creator: null, // Not available from transaction discovery
              metadataHash: null, // Not available from transaction discovery
            }));
            
            saveMissingMarketMetadata(marketsToSave).catch(() => {});
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
          creator: m.creator ?? null,
          metadataHash: m.metadataHash ?? null,
        }));
        
        // Save missing markets in background (non-blocking)
        saveMissingMarketMetadata(marketsToSave).catch(() => {});
      }

      // Create market list with registry data
      const marketList: MarketCardData[] = Array.from(allMarketIds).map((marketId) => {
        const meta = metadataMap[marketId] ?? defaultMetadata(marketId);
        // Find registry entry for this market to get status
        const registryEntry = registryMarkets.find(m => m.marketId === marketId);
        return {
          marketId,
          ...meta,
          state: null,
          loading: true,
          error: null,
        };
      });

      // Fetch full state for all markets (includes reserves, prices, etc.)
      const marketPromises = marketList.map(async (market) => {
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

      const results = await Promise.all(marketPromises);
      
      // Filter to show only active markets (status === 0) in the UI
      const activeMarkets = results.filter(m => {
        // If state exists, check status; otherwise include if no error
        if (m.state) {
          return m.state.status === 0; // STATUS_OPEN
        }
        const registryEntry = registryMarkets.find(r => r.marketId === m.marketId);
        if (registryEntry && registryEntry.status === 0) {
          return true;
        }
        // Include markets with errors if they might be active (don't filter out completely)
        return m.error === null;
      });
      
      setMarkets(activeMarkets);
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
                  className="card bg-base-100 shadow-xl hover:shadow-2xl transition-all duration-200 cursor-pointer border border-transparent hover:border-base-300 rounded-xl hover:-translate-y-1"
                  onClick={() => handleMarketClick(market.marketId)}
                >
                  <div className="card-body">
                    <div className="flex justify-between items-start gap-2 mb-2">
                      <div className="flex-1">
                        <h2 className="card-title text-lg leading-tight line-clamp-2">{market.title}</h2>
                        {market.category && (
                          <span className="badge badge-sm badge-outline mt-1">{market.category}</span>
                        )}
                      </div>
                      {market.state && getStatusBadge(market.state.status)}
                    </div>

                    <p className="text-sm text-base-content mb-4 line-clamp-2">
                      {market.description}
                    </p>

                    {market.error ? (
                      <div className="alert alert-error py-2">
                        <span className="text-xs">{market.error}</span>
                      </div>
                    ) : market.state ? (
                      <>
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-success font-bold">
                            <AnimatedPrice priceBps={priceYes} decimals={1} showChange />{' '}
                            <span className="text-base-content font-normal text-xs">YES</span>
                          </span>
                          <span className="text-error font-bold">
                            <AnimatedPrice priceBps={priceNo} decimals={1} showChange />{' '}
                            <span className="text-base-content font-normal text-xs">NO</span>
                          </span>
                        </div>
                        <div className="flex w-full rounded-full overflow-hidden bg-base-200 h-3 mb-2">
                          <div
                            className="bg-success h-full transition-all"
                            style={{ width: `${(priceYes / 10000) * 100}%` }}
                          />
                          <div
                            className="bg-error h-full transition-all"
                            style={{ width: `${(priceNo / 10000) * 100}%` }}
                          />
                        </div>
                        <LiquidityBar
                          collateralPool={market.state.collateralPool}
                          className="mb-2"
                        />
                        <div className="flex justify-between text-xs text-base-content">
                          <span>Fee: {(market.state.feeBps / 100).toFixed(2)}%</span>
                        </div>

                        {market.state.outcome !== null && (
                          <div className="alert alert-info py-2 mt-2">
                            <span className="text-xs">
                              Outcome: <strong>{market.state.outcome ? 'YES' : 'NO'}</strong>
                            </span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="alert alert-warning py-2">
                        <span className="text-xs">Market not found or not initialized</span>
                      </div>
                    )}

                    <div className="card-actions justify-end mt-4">
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
