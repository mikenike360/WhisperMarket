import React, { useState, useEffect } from 'react';
import type { NextPageWithLayout } from '@/types';
import { NextSeo } from 'next-seo';
import Layout from '@/layouts/_layout';
import { useRouter } from 'next/router';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { getMarketState, discoverMarketsFromChain, extractMarketIdFromTransaction, getAllMarkets, clearMarketRegistryCache, MarketRegistryEntry, fetchMarketCreator } from '@/components/aleo/rpc';
import { MarketState, MarketMetadata } from '@/types';
import { calculatePriceFromReserves } from '@/utils/positionHelpers';
import { toCredits } from '@/utils/credits';
import { formatPriceCents } from '@/utils/priceDisplay';
import { CreateMarketForm } from '@/components/market/CreateMarketForm';
import { getMarketsMetadata, saveMissingMarketMetadata, createMarketMetadata } from '@/services/marketMetadata';

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
  const [markets, setMarkets] = useState<MarketCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [manualTxId, setManualTxId] = useState('');
  const [addingManual, setAddingManual] = useState(false);

  // Check if wallet is connected
  // Some wallets use 'address' instead of 'publicKey'
  const isWalletConnected = Boolean(publicKey || address || (connected && wallet));

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
    // Removed auto-refresh - users can click refresh button manually
  }, []);

  const handleMarketCreated = () => {
    setShowCreateModal(false);
    // Clear registry cache so fresh data is fetched on next load
    clearMarketRegistryCache();
    // Don't auto-refresh - let user click refresh button when ready
    // The market will appear after transaction is processed on-chain
  };

  const handleAddMarketByTxId = async () => {
    if (!manualTxId.trim()) return;
    
    setAddingManual(true);
    try {
      const marketId = await extractMarketIdFromTransaction(manualTxId.trim());
      if (marketId) {
        // Check if market exists and add it
        try {
          const state = await getMarketState(marketId);
          const metaMap = await getMarketsMetadata([marketId]);
          const meta = metaMap[marketId] ?? defaultMetadata(marketId);
          
          // Save to Supabase if not already there
          if (!metaMap[marketId]) {
            // Try to get creator from chain
            const creator = await fetchMarketCreator(marketId).catch(() => null);
            
            await createMarketMetadata({
              market_id: marketId,
              title: meta.title,
              description: meta.description,
              category: meta.category,
              creator_address: creator ?? null,
              transaction_id: manualTxId.trim(),
            });
          }
          
          const newMarket: MarketCardData = {
            marketId,
            ...meta,
            state,
            loading: false,
            error: null,
          };
          setMarkets(prev => {
            const exists = prev.some(m => m.marketId === marketId);
            if (exists) return prev;
            return [...prev, newMarket];
          });
          setManualTxId('');
          alert(`Market added successfully! Market ID: ${marketId}`);
        } catch (err: any) {
          alert(`Market ID found (${marketId}) but market state query failed: ${err.message}`);
        }
      } else {
        alert('Could not extract market ID from transaction. The transaction might not be indexed yet or might not be a market creation transaction.');
      }
    } catch (err: any) {
      alert(`Failed to extract market ID: ${err.message}`);
    } finally {
      setAddingManual(false);
    }
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

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center items-center min-h-[400px]">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      </div>
    );
  }

  return (
    <>
      <NextSeo
        title="Markets Dashboard"
        description="Browse and participate in prediction markets"
      />

      <div className="container mx-auto px-4 py-8">
        <div className="mb-8 flex flex-col sm:flex-row justify-between items-start gap-4">
          <div>
            <h1 className="text-4xl font-bold mb-2">Prediction Markets</h1>
            <p className="text-base-content/70">
              Browse available markets and place your predictions
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              className="btn btn-ghost"
              onClick={loadMarkets}
              disabled={loading || discovering}
              title="Refresh markets list"
            >
              {loading || discovering ? (
                <span className="loading loading-spinner loading-sm"></span>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => setShowCreateModal(true)}
              disabled={!isWalletConnected}
            >
              {isWalletConnected ? 'Create Market' : 'Connect Wallet to Create'}
            </button>
          </div>
        </div>

        {discovering && (
          <div className="alert alert-info mb-6">
            <span className="loading loading-spinner loading-sm mr-2"></span>
            Discovering markets from chain...
          </div>
        )}

        <div className="card bg-base-200 shadow-xl mb-6">
          <div className="card-body">
            <h3 className="card-title text-sm">Add Market by Transaction ID</h3>
            <p className="text-xs text-base-content/70 mb-2">
              If your market doesn't appear automatically, paste the transaction ID here
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Transaction ID (e.g. at1nw4dknzxjdfnj2ek4hgxt6h6hyhht6zaj7qrlsc8jcshddapkuysw3k6m5)"
                className="input input-bordered input-sm flex-1"
                value={manualTxId}
                onChange={(e) => setManualTxId(e.target.value)}
                disabled={addingManual}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={handleAddMarketByTxId}
                disabled={addingManual || !manualTxId.trim()}
              >
                {addingManual ? (
                  <span className="loading loading-spinner loading-sm"></span>
                ) : (
                  'Add Market'
                )}
              </button>
            </div>
          </div>
        </div>

        {markets.length === 0 && !loading ? (
          <div className="card bg-base-200 shadow-xl">
            <div className="card-body">
              <h2 className="card-title text-warning">No Markets Available</h2>
              <p className="text-base-content/80">
                No markets have been discovered on-chain yet. Markets will appear here once they are initialized.
              </p>
              <div className="divider">How Markets Are Discovered</div>
              <ol className="list-decimal list-inside space-y-2 text-sm">
                <li>Markets are discovered via on-chain enumeration using <code className="badge badge-ghost">market_index</code> and <code className="badge badge-ghost">total_markets</code> mappings</li>
                <li>Only active markets (status = 0) are shown in the list</li>
                <li>Market metadata is stored in Supabase for better display (optional)</li>
                <li>Transaction-based discovery is used as fallback for markets created before enumeration was added</li>
              </ol>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {markets.map((market) => {
              const priceYes = market.state
                ? calculatePriceFromReserves(market.state.yesReserve, market.state.noReserve)
                : 0;
              const priceNo = 10000 - priceYes;

              return (
                <div
                  key={market.marketId}
                  className="card bg-base-100 shadow-xl hover:shadow-2xl transition-shadow cursor-pointer"
                  onClick={() => handleMarketClick(market.marketId)}
                >
                  <div className="card-body">
                    <div className="flex justify-between items-start mb-2">
                      <h2 className="card-title text-lg">{market.title}</h2>
                      {market.state && getStatusBadge(market.state.status)}
                    </div>

                    <p className="text-sm text-base-content/70 mb-4 line-clamp-2">
                      {market.description}
                    </p>

                    {market.error ? (
                      <div className="alert alert-error py-2">
                        <span className="text-xs">{market.error}</span>
                      </div>
                    ) : market.state ? (
                      <>
                        <div className="stats stats-horizontal shadow w-full mb-4">
                          <div className="stat py-2 px-3">
                            <div className="stat-title text-xs">YES</div>
                            <div className="stat-value text-sm text-success">
                              {formatPriceCents(priceYes, { decimals: 1 })}
                            </div>
                          </div>
                          <div className="stat py-2 px-3">
                            <div className="stat-title text-xs">NO</div>
                            <div className="stat-value text-sm text-error">
                              {formatPriceCents(priceNo, { decimals: 1 })}
                            </div>
                          </div>
                        </div>

                        <div className="flex justify-between text-xs text-base-content/60 mb-2">
                          <span>Pool: {toCredits(market.state.collateralPool).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} credits</span>
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
                      <button className="btn btn-primary btn-sm">
                        View Market
                      </button>
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
