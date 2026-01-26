import React, { useState, useEffect } from 'react';
import type { NextPageWithLayout } from '@/types';
import { NextSeo } from 'next-seo';
import Layout from '@/layouts/_layout';
import { useRouter } from 'next/router';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { getMarketState, discoverMarketsFromChain } from '@/components/aleo/rpc';
import { MarketState, MarketMetadata } from '@/types';
import { calculatePriceFromReserves } from '@/utils/positionHelpers';
import { CreateMarketForm } from '@/components/market/CreateMarketForm';

// Market metadata - can be extended with an indexer or database
// For markets discovered from chain, we'll use default metadata
// In production, this could come from:
// - An off-chain indexer that tracks all market init events
// - A database/API that stores market metadata
// - The metadata_hash stored on-chain (needs decoding)
const KNOWN_MARKETS_METADATA: Record<string, Omit<MarketMetadata, 'marketId'>> = {
  // Example: Add metadata for specific market IDs
  // '0field': {
  //   title: 'Example Market',
  //   description: 'Will this event happen?',
  //   category: 'General',
  // },
};

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

  // Debug logging for wallet connection
  React.useEffect(() => {
    console.log('=== Wallet Connection Debug ===');
    console.log('Full walletHook object:', walletHook);
    console.log('publicKey:', publicKey);
    console.log('address:', address);
    console.log('connected:', connected);
    console.log('wallet object:', wallet);
    console.log('publicKey type:', typeof publicKey);
    console.log('address type:', typeof address);
    console.log('publicKey value:', publicKey ? String(publicKey) : 'null/undefined');
    console.log('address value:', address ? String(address) : 'null/undefined');
    console.log('Boolean(publicKey):', Boolean(publicKey));
    console.log('Boolean(address):', Boolean(address));
    console.log('Boolean(connected):', Boolean(connected));
    console.log('Boolean(wallet):', Boolean(wallet));
    console.log('===============================');
  }, [publicKey, wallet, walletHook, address, connected]);

  // Check if wallet is connected
  // Some wallets use 'address' instead of 'publicKey'
  // Also check the 'connected' property from walletHook
  const isWalletConnected = Boolean(publicKey || address || (connected && wallet));
  
  // Additional debug log for the computed value
  React.useEffect(() => {
    console.log('isWalletConnected computed value:', isWalletConnected);
    console.log('Breakdown:', {
      hasPublicKey: Boolean(publicKey),
      hasAddress: Boolean(address),
      hasConnectedAndWallet: Boolean(connected && wallet),
      final: isWalletConnected
    });
  }, [isWalletConnected, publicKey, address, connected, wallet]);

  const loadMarkets = async () => {
    setLoading(true);
    setDiscovering(true);

    try {
      // First, try to discover markets from chain
      const discoveredMarketIds = await discoverMarketsFromChain();
      
      // Combine discovered markets with known markets metadata
      const allMarketIds = new Set(discoveredMarketIds);
      
      // Create market objects with metadata
      const marketList: MarketCardData[] = Array.from(allMarketIds).map((marketId) => {
        const metadata = KNOWN_MARKETS_METADATA[marketId] || {
          title: `Market ${marketId.slice(0, 8)}...`,
          description: 'Prediction market',
          category: 'General',
        };

        return {
          marketId,
          ...metadata,
          state: null,
          loading: true,
          error: null,
        };
      });

      // Fetch state for all markets
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
      // Filter out markets that don't exist (failed to load)
      const validMarkets = results.filter(m => m.state !== null || m.error?.includes('not found') === false);
      setMarkets(validMarkets);
    } catch (err) {
      console.error('Failed to discover markets:', err);
      setMarkets([]);
    } finally {
      setLoading(false);
      setDiscovering(false);
    }
  };

  useEffect(() => {
    loadMarkets();
    
    // Refresh every 30 seconds
    const interval = setInterval(loadMarkets, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleMarketCreated = () => {
    setShowCreateModal(false);
    // Refresh markets list after a short delay to allow transaction to be processed
    setTimeout(() => {
      loadMarkets();
    }, 3000);
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
      <div className="container mx-auto px-4 py-8 mt-20">
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

      <div className="container mx-auto px-4 py-8 mt-20">
        <div className="mb-8 flex flex-col sm:flex-row justify-between items-start gap-4">
          <div>
            <h1 className="text-4xl font-bold mb-2">Prediction Markets</h1>
            <p className="text-base-content/70">
              Browse available markets and place your predictions
            </p>
          </div>
          <button
            className="btn btn-primary shrink-0"
            onClick={() => {
              console.log('Create Market button clicked');
              console.log('isWalletConnected at click:', isWalletConnected);
              console.log('publicKey at click:', publicKey);
              setShowCreateModal(true);
            }}
            disabled={!isWalletConnected}
          >
            {isWalletConnected ? 'Create Market' : 'Connect Wallet to Create'}
          </button>
        </div>

        {discovering && (
          <div className="alert alert-info mb-6">
            <span className="loading loading-spinner loading-sm mr-2"></span>
            Discovering markets from chain...
          </div>
        )}

        {markets.length === 0 && !loading ? (
          <div className="card bg-base-200 shadow-xl">
            <div className="card-body">
              <h2 className="card-title text-warning">No Markets Available</h2>
              <p className="text-base-content/80">
                No markets have been discovered on-chain yet. Markets will appear here once they are initialized.
              </p>
              <div className="divider">How Markets Are Discovered</div>
              <ol className="list-decimal list-inside space-y-2 text-sm">
                <li>Markets are automatically discovered by querying <code className="badge badge-ghost">init</code> transactions</li>
                <li>Market IDs are extracted from on-chain mapping updates</li>
                <li>Add metadata for markets in <code className="badge badge-ghost">KNOWN_MARKETS_METADATA</code> in <code className="badge badge-ghost">src/pages/markets.tsx</code> for better display</li>
                <li>In production, use an indexer for more reliable market discovery</li>
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
                              {(priceYes / 100).toFixed(1)}%
                            </div>
                          </div>
                          <div className="stat py-2 px-3">
                            <div className="stat-title text-xs">NO</div>
                            <div className="stat-value text-sm text-error">
                              {(priceNo / 100).toFixed(1)}%
                            </div>
                          </div>
                        </div>

                        <div className="flex justify-between text-xs text-base-content/60 mb-2">
                          <span>Pool: {market.state.collateralPool.toLocaleString()}</span>
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
