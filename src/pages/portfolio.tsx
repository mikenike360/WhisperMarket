import React, { useState, useEffect } from 'react';
import type { NextPageWithLayout } from '@/types';
import { NextSeo } from 'next-seo';
import Layout from '@/layouts/_layout';
import Link from 'next/link';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import {
  getMarketState,
  getAllUserPositions,
  fetchUserCollateral,
} from '@/lib/aleo/rpc';
import { UserPosition, MarketState, MarketMetadata, PREDICTION_MARKET_PROGRAM_ID } from '@/types';
import { PortfolioPositionCard } from '@/components/portfolio/PortfolioPositionCard';
import { PortfolioSummary } from '@/components/portfolio/PortfolioSummary';
import { ManageCashSection } from '@/components/portfolio/ManageCashSection';
import { getMarketsMetadata } from '@/services/marketMetadata';
import { getCachedMarketStates } from '@/services/marketStateCache';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import routes from '@/config/routes';

interface PositionWithData {
  position: UserPosition;
  record: any;
  records: any[];
  marketState: MarketState | null;
  metadata: MarketMetadata | null;
}

type StatusFilter = 'all' | 'open' | 'resolved' | 'paused';

const PortfolioPage: NextPageWithLayout = () => {
  const walletHook = useWallet();
  const { publicKey, wallet, address, requestRecords } = walletHook as any;
  const [positions, setPositions] = useState<PositionWithData[]>([]);
  const [globalBalance, setGlobalBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const userAddress = publicKey || address;

  const filteredPositions = positions.filter((p) => {
    if (statusFilter === 'all') return true;
    const status = p.marketState?.status;
    if (statusFilter === 'open') return status === 0;
    if (statusFilter === 'resolved') return status === 1;
    if (statusFilter === 'paused') return status === 2;
    return true;
  });

  const loadPortfolio = async () => {
    if (!userAddress || !wallet) {
      setLoading(false);
      return;
    }

    if (!requestRecords) {
      setPositions([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [allPositions, balance] = await Promise.all([
        getAllUserPositions(wallet, PREDICTION_MARKET_PROGRAM_ID, requestRecords),
        userAddress ? fetchUserCollateral(userAddress) : Promise.resolve(0),
      ]);
      setGlobalBalance(balance);

      if (allPositions.length === 0) {
        setPositions([]);
        setLoading(false);
        return;
      }

      // Extract unique market IDs
      const marketIds = [...new Set(allPositions.map(p => p.position.marketId))];

      // Fetch from Supabase cache first, then chain only for cache misses
      const [cachedStates, metadataMap] = await Promise.all([
        getCachedMarketStates(marketIds, { allowStale: true }),
        getMarketsMetadata(marketIds),
      ]);
      const missIds = marketIds.filter(id => !cachedStates[id]);
      const stateResults = await Promise.all(
        missIds.map(marketId =>
          getMarketState(marketId).then(state => ({ marketId, state })).catch(() => ({ marketId, state: null }))
        )
      );
      const marketStatesMap: Record<string, MarketState | null> = { ...cachedStates };
      stateResults.forEach(({ marketId, state }) => {
        marketStatesMap[marketId] = state;
      });

      // Convert metadata map to include marketId
      const fullMetadataMap: Record<string, MarketMetadata> = {};
      Object.entries(metadataMap).forEach(([marketId, metadata]) => {
        fullMetadataMap[marketId] = { ...metadata, marketId };
      });

      // Combine position data with market states and metadata
      const positionsWithData: PositionWithData[] = allPositions.map(({ position, record, records }) => ({
        position,
        record,
        records: records ?? [record],
        marketState: marketStatesMap[position.marketId] || null,
        metadata: fullMetadataMap[position.marketId] || null,
      }));

      setPositions(positionsWithData);
    } catch (err: any) {
      setError(err.message || 'Failed to load portfolio');
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    if (userAddress && wallet) {
      loadPortfolio();
    } else {
      setLoading(false);
    }
  }, [userAddress, wallet]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!userAddress || !wallet) return;

    const interval = setInterval(() => {
      loadPortfolio();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [userAddress, wallet]);

  const shortAddress = userAddress
    ? `${String(userAddress).slice(0, 12)}…${String(userAddress).slice(-8)}`
    : '';

  const copyAddress = () => {
    if (userAddress) navigator.clipboard.writeText(userAddress);
  };

  if (!userAddress) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="card bg-base-200 shadow-xl max-w-xl mx-auto rounded-xl">
          <div className="card-body items-center text-center py-12">
            <h1 className="text-2xl font-bold mb-2">Your Portfolio</h1>
            <p className="text-base-content mb-4">
              Connect your Aleo wallet to see your positions and trading history.
            </p>
            <p className="text-sm text-base-content mb-6">
              Use the Connect Wallet button in the header to get started.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <NextSeo title="Portfolio | WhisperMarket" description="View your prediction market positions" />

      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="lg:grid lg:grid-cols-[minmax(0,300px)_1fr] gap-8">
          {/* Sidebar: summary + manage cash (sticky on desktop) */}
          <aside className="lg:sticky lg:top-24 self-start space-y-6 order-2 lg:order-1">
            <PortfolioSummary
              positions={positions.map(p => ({
                position: p.position,
                marketState: p.marketState,
              }))}
              globalBalance={globalBalance ?? undefined}
            />
            <ManageCashSection
              cashBalance={globalBalance}
              onBalanceRefreshed={loadPortfolio}
            />
          </aside>

          {/* Main: header, error, content */}
          <div className="min-w-0 order-1 lg:order-2">
            <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-6">
              <div>
                <h1 className="text-3xl sm:text-4xl font-bold mb-2">Your Portfolio</h1>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base-content text-sm">Connected:</span>
                  <code className="text-xs bg-base-200 px-2 py-1 rounded font-mono">{shortAddress}</code>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={copyAddress}
                    title="Copy address"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h2m8 0h2a2 2 0 012 2v2m0 0V6a2 2 0 00-2-2h-2m-4 0H6" />
                    </svg>
                  </button>
                </div>
              </div>
              <button
                className="btn btn-primary btn-sm sm:btn-md gap-2"
                onClick={loadPortfolio}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-sm" />
                    Loading...
                  </>
                ) : (
                  <>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4 sm:h-5 sm:w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                    Refresh
                  </>
                )}
              </button>
            </div>

            {error && (
              <div className="alert alert-error mb-6 flex items-center justify-between gap-4">
                <span>{error}</span>
                <button className="btn btn-sm btn-ghost" onClick={() => setError(null)} aria-label="Dismiss">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}

            {loading && positions.length === 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : positions.length === 0 ? (
              <div className="card bg-base-200 shadow-xl rounded-xl">
                <div className="card-body items-center text-center py-16">
                  <div className="text-4xl text-base-content mb-4" aria-hidden>
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586A1 1 0 0114.414 9H19a2 2 0 012 2v10a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h2 className="card-title text-lg mb-2">You have no positions yet</h2>
                  <p className="text-base-content mb-6 max-w-sm">
                    Start trading on the markets page to build your portfolio.
                  </p>
                  <Link href={routes.markets} className="btn btn-primary">
                    Browse Markets
                  </Link>
                </div>
              </div>
            ) : (
              <>
                {/* Status filter tabs */}
                <div className="tabs tabs-boxed bg-base-200/60 p-1 rounded-lg mb-6 inline-flex flex-wrap gap-1">
                  {(['all', 'open', 'resolved', 'paused'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      className={`tab tab-sm ${statusFilter === tab ? 'tab-active' : ''}`}
                      onClick={() => setStatusFilter(tab)}
                    >
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </div>

                {/* Positions grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                  {filteredPositions.map(({ position, record, records, marketState, metadata }) => (
                    <PortfolioPositionCard
                      key={position.marketId}
                      marketId={position.marketId}
                      position={position}
                      marketState={marketState}
                      metadata={metadata || undefined}
                      positionRecord={record}
                      positionRecords={records}
                      onRedeem={loadPortfolio}
                    />
                  ))}
                </div>

                <div className="mt-8 text-center text-sm text-base-content">
                  {statusFilter === 'all'
                    ? `Showing ${positions.length} position${positions.length !== 1 ? 's' : ''}`
                    : `Showing ${filteredPositions.length} of ${positions.length} position${positions.length !== 1 ? 's' : ''}`}
                  {' | '}Auto-refreshes every 30 seconds
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

PortfolioPage.getLayout = (page) => <Layout>{page}</Layout>;
export default PortfolioPage;
