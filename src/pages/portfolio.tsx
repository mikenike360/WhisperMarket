import React, { useState, useEffect } from 'react';
import type { NextPageWithLayout } from '@/types';
import { NextSeo } from 'next-seo';
import Layout from '@/layouts/_layout';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import {
  getMarketState,
  getAllUserPositions,
} from '@/lib/aleo/rpc';
import { UserPosition, MarketState, MarketMetadata, PREDICTION_MARKET_PROGRAM_ID } from '@/types';
import { PortfolioPositionCard } from '@/components/portfolio/PortfolioPositionCard';
import { PortfolioSummary } from '@/components/portfolio/PortfolioSummary';
import { getMarketsMetadata } from '@/services/marketMetadata';

interface PositionWithData {
  position: UserPosition;
  record: any;
  marketState: MarketState | null;
  metadata: MarketMetadata | null;
}

const PortfolioPage: NextPageWithLayout = () => {
  const walletHook = useWallet();
  const { publicKey, wallet, address, requestRecords } = walletHook as any;
  const [positions, setPositions] = useState<PositionWithData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const userAddress = publicKey || address;

  const loadPortfolio = async () => {
    if (!userAddress || !wallet) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Get all Position records from wallet
      const allPositions = await getAllUserPositions(wallet, PREDICTION_MARKET_PROGRAM_ID, requestRecords);

      if (allPositions.length === 0) {
        setPositions([]);
        setLoading(false);
        return;
      }

      // Extract unique market IDs
      const marketIds = allPositions.map(p => p.position.marketId);

      // Fetch market states and metadata in parallel
      const [marketStatesResults, metadataMap] = await Promise.all([
        Promise.all(
          marketIds.map(async (marketId) => {
            try {
              const state = await getMarketState(marketId);
              return { marketId, state };
            } catch (err: any) {
              if (process.env.NODE_ENV === 'development') {
              }
              return { marketId, state: null };
            }
          })
        ),
        getMarketsMetadata(marketIds),
      ]);

      // Create a map of marketId -> MarketState
      const marketStatesMap: Record<string, MarketState | null> = {};
      marketStatesResults.forEach(({ marketId, state }) => {
        marketStatesMap[marketId] = state;
      });

      // Convert metadata map to include marketId
      const fullMetadataMap: Record<string, MarketMetadata> = {};
      Object.entries(metadataMap).forEach(([marketId, metadata]) => {
        fullMetadataMap[marketId] = { ...metadata, marketId };
      });

      // Combine position data with market states and metadata
      const positionsWithData: PositionWithData[] = allPositions.map(({ position, record }) => ({
        position,
        record,
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

  if (!userAddress) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="alert alert-warning">
          <span>Please connect your wallet to view your portfolio</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <NextSeo title="Portfolio" description="View your prediction market positions" />

      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold mb-2">Your Portfolio</h1>
            <p className="text-base-content/70">
              Connected as: <code className="text-xs">{String(userAddress).slice(0, 30)}...</code>
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={loadPortfolio}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="loading loading-spinner"></span>
                Loading...
              </>
            ) : (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
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
          <div className="alert alert-error mb-6">
            <span>{error}</span>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setError(null)}
            >
              ✕
            </button>
          </div>
        )}

        {loading && positions.length === 0 ? (
          <div className="flex justify-center items-center min-h-[400px]">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        ) : positions.length === 0 ? (
          <div className="alert alert-info">
            <span>You have no positions yet. Start trading on the markets page!</span>
            <div className="mt-4">
              <a href="/markets" className="btn btn-primary btn-sm">
                Browse Markets
              </a>
            </div>
          </div>
        ) : (
          <>
            {/* Summary Statistics */}
            <PortfolioSummary
              positions={positions.map(p => ({
                position: p.position,
                marketState: p.marketState,
              }))}
            />

            {/* Positions Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {positions.map(({ position, record, marketState, metadata }) => (
                <PortfolioPositionCard
                  key={position.marketId}
                  marketId={position.marketId}
                  position={position}
                  marketState={marketState}
                  metadata={metadata || undefined}
                  positionRecord={record}
                  onRedeem={loadPortfolio}
                />
              ))}
            </div>

            {positions.length > 0 && (
              <div className="mt-8 text-center text-sm text-base-content/60">
                Showing {positions.length} position{positions.length !== 1 ? 's' : ''} | Auto-refreshes every 30 seconds
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
};

PortfolioPage.getLayout = (page) => <Layout>{page}</Layout>;
export default PortfolioPage;
