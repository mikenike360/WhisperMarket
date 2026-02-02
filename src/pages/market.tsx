import React, { useState, useEffect } from 'react';
import type { NextPageWithLayout } from '@/types';
import { NextSeo } from 'next-seo';
import Layout from '@/layouts/_layout';
import { useRouter } from 'next/router';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import Link from 'next/link';
import routes from '@/config/routes';
import { MarketHeader } from '@/components/market/MarketHeader';
import { PriceDisplay } from '@/components/market/PriceDisplay';
import { MarketPositionCard } from '@/components/market/MarketPositionCard';
import { MarketStats } from '@/components/market/MarketStats';
import { DepositSection } from '@/components/market/DepositSection';
import { BuyForm } from '@/components/market/BuyForm';
import { StatusBanner } from '@/components/market/StatusBanner';
import { getMarketState, getAllUserPositions } from '@/lib/aleo/rpc';
import { PREDICTION_MARKET_PROGRAM_ID, UserPosition } from '@/types';
import { getMarketMetadata } from '@/services/marketMetadata';
import { useTransaction } from '@/contexts/TransactionContext';

const MarketPage: NextPageWithLayout = () => {
  const router = useRouter();
  const { publicKey, wallet, address, requestRecords } = useWallet();
  const { addTransaction } = useTransaction();
  const userAddress = publicKey || address;
  const [marketState, setMarketState] = useState<any>(null);
  const [metadata, setMetadata] = useState<{ title: string; description: string } | null>(null);
  const [userPosition, setUserPosition] = useState<UserPosition | null>(null);
  const [userPositionRecord, setUserPositionRecord] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshingRecords, setRefreshingRecords] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [dismissedTxId, setDismissedTxId] = useState<string | null>(null);

  const marketId = (router.query.marketId as string) || null;

  useEffect(() => {
    if (!marketId) {
      setLoading(false);
      setError('MARKET_ID_REQUIRED');
      return;
    }

    loadMarketState();
    loadUserPosition();
  }, [error, marketId]);

  useEffect(() => {
    if (userAddress && wallet && marketId) {
      loadUserPosition();
    } else {
      setUserPosition(null);
      setUserPositionRecord(null);
    }
  }, [userAddress, wallet, marketId]);

  const loadMarketState = async () => {
    if (!marketId) return;

    try {
      setLoading(true);
      const [state, meta] = await Promise.all([
        getMarketState(marketId),
        getMarketMetadata(marketId),
      ]);
      setMarketState(state);
      setMetadata(meta ? { title: meta.title, description: meta.description } : null);
      setError(null);
    } catch (err: any) {
      // Check if it's a "program not deployed" error
      const errorMsg = err.message || 'Failed to load market state';
      if (errorMsg.includes('undefined') || errorMsg.includes('not found') || errorMsg.includes('ok')) {
        setError('PROGRAM_NOT_DEPLOYED');
      } else {
        setError(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadUserPosition = async () => {
    if (!wallet || !userAddress || !marketId) {
      setUserPosition(null);
      setUserPositionRecord(null);
      return;
    }
    try {
      const allPositions = await getAllUserPositions(wallet, PREDICTION_MARKET_PROGRAM_ID, requestRecords ?? undefined);
      const forMarket = allPositions.find((p) => p.position.marketId === marketId);
      if (forMarket) {
        setUserPosition(forMarket.position);
        setUserPositionRecord(forMarket.record);
      } else {
        setUserPosition(null);
        setUserPositionRecord(null);
      }
    } catch {
      setUserPosition(null);
      setUserPositionRecord(null);
    }
  };

  const handleTransactionSubmitted = (txId: string, label?: string) => {
    addTransaction({ id: txId, label: label ?? 'Transaction' });
    setTransactionId(txId);
    setDismissedTxId(null);
    setTimeout(() => {
      loadMarketState();
      loadUserPosition();
    }, 3000);
    setTimeout(() => setTransactionId((prev) => (prev === txId ? null : prev)), 8000);
  };

  const handleRefreshRecords = async () => {
    setRefreshingRecords(true);
    try {
      await loadUserPosition();
      await loadMarketState();
    } finally {
      setRefreshingRecords(false);
    }
  };

  if (loading && !marketState) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center items-center min-h-[400px]">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      </div>
    );
  }

  if (error && !marketState) {
    // Special case: market ID required
    if (error === 'MARKET_ID_REQUIRED') {
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
                Example: <code className="badge badge-ghost">/market?marketId=0field</code>
              </p>
            </div>
          </div>
        </div>
      );
    }

    // Special case: program not deployed yet
    if (error === 'PROGRAM_NOT_DEPLOYED') {
      return (
        <div className="container mx-auto px-4 py-8">
          <div className="card bg-base-200 shadow-xl max-w-2xl mx-auto">
            <div className="card-body">
              <h2 className="card-title text-warning">Program Not Deployed</h2>
              <p className="text-base-content/80">
                The prediction market program (<code className="badge badge-ghost">{PREDICTION_MARKET_PROGRAM_ID}</code>) 
                has not been deployed to the network yet, or the market ID <code className="badge badge-ghost">{marketId}</code> does not exist.
              </p>
              <div className="divider">Next Steps</div>
              <ol className="list-decimal list-inside space-y-2 text-sm">
                <li>Deploy the program using <code className="badge badge-ghost">leo deploy</code> or Aleo Studio</li>
                <li>Call the <code className="badge badge-ghost">init</code> transition to initialize the market</li>
                <li>Use the returned market_id in the URL: <code className="badge badge-ghost">/market?marketId=YOUR_MARKET_ID</code></li>
              </ol>
              <div className="card-actions justify-end mt-4">
                <button className="btn btn-primary btn-sm" onClick={loadMarketState}>
                  Retry
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="container mx-auto px-4 py-8">
        <div className="alert alert-error">
          <span>{error}</span>
          <button className="btn btn-sm btn-ghost" onClick={loadMarketState}>Retry</button>
        </div>
      </div>
    );
  }

  if (!marketState) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="alert alert-info">
          <span>Market not initialized yet</span>
        </div>
      </div>
    );
  }

  const priceNo = 10000 - marketState.priceYes;
  const displayTitle = metadata?.title ?? 'Prediction Market';
  const displayDescription = metadata?.description ?? 'Place your bets on whether this event will occur. Buy YES if you think it will happen, or NO if you think it won\'t.';

  return (
    <>
      <NextSeo
        title={displayTitle}
        description={displayDescription}
      />

      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="mb-4">
          <Link
            href={routes.markets}
            className="inline-flex items-center gap-2 text-base-content/70 hover:text-base-content text-sm font-medium"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Markets
          </Link>
        </div>

        {transactionId && dismissedTxId !== transactionId && (
          <div className="alert alert-success mb-4 flex items-center justify-between gap-4 flex-wrap">
            <span className="flex items-center gap-2 flex-wrap">
              <span>Transaction submitted:</span>
              <a
                href={`https://testnet.explorer.provable.com/transaction/${transactionId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="link link-hover font-mono text-sm break-all"
              >
                {transactionId.slice(0, 12)}…
              </a>
            </span>
            <div className="flex items-center gap-2">
              <a
                href={`https://testnet.explorer.provable.com/transaction/${transactionId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost btn-sm"
              >
                View in Explorer
              </a>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle"
                onClick={() => setDismissedTxId(transactionId ?? null)}
                aria-label="Dismiss"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        <MarketHeader
          title={displayTitle}
          description={displayDescription}
          status={marketState.status}
        />

        <StatusBanner status={marketState.status} outcome={marketState.outcome} />

        {userAddress && (
          <div className="flex justify-end mb-4">
            <button
              type="button"
              className="btn btn-sm btn-ghost gap-2"
              onClick={handleRefreshRecords}
              disabled={refreshingRecords}
            >
              {refreshingRecords ? (
                <span className="loading loading-spinner loading-sm" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              Refresh records
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <PriceDisplay
              yesReserve={marketState.yesReserve}
              noReserve={marketState.noReserve}
            />
            <MarketPositionCard position={userPosition} isOpen={marketState.status === 0} />
            <MarketStats
              collateralPool={marketState.collateralPool}
              yesReserve={marketState.yesReserve}
              noReserve={marketState.noReserve}
              feeBps={marketState.feeBps}
            />
          </div>

          <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <DepositSection
              marketId={marketId}
              userPosition={userPosition}
              userPositionRecord={userPositionRecord}
              isOpen={marketState.status === 0}
              onTransactionSubmitted={handleTransactionSubmitted}
            />
            <BuyForm
              marketId={marketId}
              marketState={marketState}
              userPosition={userPosition}
              userPositionRecord={userPositionRecord}
              isOpen={marketState.status === 0}
              isPaused={marketState.isPaused}
              onTransactionSubmitted={handleTransactionSubmitted}
              requestRecords={requestRecords}
            />
          </div>
        </div>
      </div>
    </>
  );
};

MarketPage.getLayout = (page) => <Layout>{page}</Layout>;
export default MarketPage;
