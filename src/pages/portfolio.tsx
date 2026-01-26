import React, { useState, useEffect } from 'react';
import type { NextPageWithLayout } from '@/types';
import { NextSeo } from 'next-seo';
import Layout from '@/layouts/_layout';
import { useRouter } from 'next/router';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { WalletNotConnectedError } from '@provablehq/aleo-wallet-adaptor-core';
import { PositionCard } from '@/components/market/PositionCard';
import { RedeemButton } from '@/components/market/RedeemButton';
import { getMarketState, getUserPositionRecords } from '@/components/aleo/rpc';
import { PREDICTION_MARKET_PROGRAM_ID } from '@/types';

const PortfolioPage: NextPageWithLayout = () => {
  const router = useRouter();
  const { publicKey, wallet } = useWallet();
  const [marketState, setMarketState] = useState<any>(null);
  const [userPosition, setUserPosition] = useState<any>(null);
  const [positionRecord, setPositionRecord] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get market ID from query parameter
  // Usage: /portfolio?marketId=0field or /portfolio?marketId=1field
  const marketId = (router.query.marketId as string) || null;

  useEffect(() => {
    if (!marketId) {
      setLoading(false);
      setError('MARKET_ID_REQUIRED');
      return;
    }

    if (publicKey && wallet) {
      loadData();
      // Poll for updates every 5 seconds
      const interval = setInterval(loadData, 5000);
      return () => clearInterval(interval);
    } else {
      setLoading(false);
    }
  }, [publicKey, wallet, marketId]);

  const loadData = async () => {
    if (!publicKey || !wallet || !marketId) return;

    try {
      setLoading(true);
      const [market, position] = await Promise.all([
        getMarketState(marketId),
        getUserPositionRecords(wallet, PREDICTION_MARKET_PROGRAM_ID, marketId),
      ]);
      setMarketState(market);
      setUserPosition(position);
      
      // Also fetch the actual Position record object for redemption
      if (position) {
        const allRecords = await wallet.requestRecords(PREDICTION_MARKET_PROGRAM_ID);
        const recordObj = allRecords.find((r: any) => {
          if (r.spent) return false;
          const recordData = r.data || r;
          if (recordData.market_id) {
            const recordMarketId = String(recordData.market_id).replace(/\.private$/, '');
            return recordMarketId === marketId;
          }
          return false;
        });
        setPositionRecord(recordObj || null);
      } else {
        setPositionRecord(null);
      }
      
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load portfolio data');
    } finally {
      setLoading(false);
    }
  };

  const calculatePotentialPayout = () => {
    if (!marketState || !userPosition) return 0;

    if (marketState.status !== 1 || marketState.outcome === null) return 0;

    const { outcome } = marketState;
    const { yesShares, noShares } = userPosition;

    // 1:1 redemption model: each winning token = 1 collateral unit
    if (outcome === true && yesShares > 0) {
      return yesShares; // YES wins, payout = yesShares
    } else if (outcome === false && noShares > 0) {
      return noShares; // NO wins, payout = noShares
    }

    return 0;
  };

  if (!marketId) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="card bg-base-200 shadow-xl max-w-2xl mx-auto">
          <div className="card-body">
            <h2 className="card-title text-warning">Market ID Required</h2>
            <p className="text-base-content/80">
              Please specify a market ID in the URL query parameter.
            </p>
            <div className="divider">Usage</div>
            <p className="text-sm">
              Add <code className="badge badge-ghost">?marketId=YOUR_MARKET_ID</code> to the URL.
              <br />
              Example: <code className="badge badge-ghost">/portfolio?marketId=0field</code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!publicKey) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="alert alert-warning">
          <span>Please connect your wallet to view your portfolio</span>
        </div>
      </div>
    );
  }

  if (loading && !userPosition) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center items-center min-h-[400px]">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      </div>
    );
  }

  if (error && !userPosition) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      </div>
    );
  }

  const potentialPayout = calculatePotentialPayout();

  return (
    <>
      <NextSeo title="Portfolio" description="View your prediction market positions" />

      <div className="container mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold mb-8">Your Portfolio</h1>

        {userPosition && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <PositionCard
                yesShares={userPosition.yesShares}
                noShares={userPosition.noShares}
                collateralAvailable={userPosition.collateralAvailable}
                collateralCommitted={userPosition.collateralCommitted}
                payoutClaimed={userPosition.payoutClaimed}
              />

              {marketState && marketState.status === 1 && (
                <div className="card bg-base-100 shadow-xl">
                  <div className="card-body">
                    <h3 className="card-title mb-4">Potential Payout</h3>
                    <div className="stat">
                      <div className="stat-title">Estimated Payout</div>
                      <div className="stat-value text-success">
                        {potentialPayout.toLocaleString()}
                      </div>
                      <div className="stat-desc">credits (1:1 redemption)</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {marketState && positionRecord && (
              <RedeemButton
                marketId={marketId}
                positionRecord={positionRecord}
                isResolved={marketState.status === 1}
                outcome={marketState.outcome}
                userYesShares={userPosition.yesShares}
                userNoShares={userPosition.noShares}
                alreadyRedeemed={userPosition.payoutClaimed}
                estimatedPayout={potentialPayout}
                onRedeemed={loadData}
              />
            )}
          </>
        )}

        {!userPosition && (
          <div className="alert alert-info">
            <span>You have no positions yet. Start trading on the market page!</span>
          </div>
        )}
      </div>
    </>
  );
};

PortfolioPage.getLayout = (page) => <Layout>{page}</Layout>;
export default PortfolioPage;
