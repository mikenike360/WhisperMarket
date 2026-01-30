import React, { useState, useEffect } from 'react';
import type { NextPageWithLayout } from '@/types';
import { NextSeo } from 'next-seo';
import Layout from '@/layouts/_layout';
import { useRouter } from 'next/router';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { MarketHeader } from '@/components/market/MarketHeader';
import { PriceDisplay } from '@/components/market/PriceDisplay';
import { BuyForm } from '@/components/market/BuyForm';
import { MarketStats } from '@/components/market/MarketStats';
import { StatusBanner } from '@/components/market/StatusBanner';
import { getMarketState } from '@/components/aleo/rpc';
import { PREDICTION_MARKET_PROGRAM_ID } from '@/types';
import { getMarketMetadata } from '@/services/marketMetadata';

const MarketPage: NextPageWithLayout = () => {
  const router = useRouter();
  const { publicKey } = useWallet();
  const [marketState, setMarketState] = useState<any>(null);
  const [metadata, setMetadata] = useState<{ title: string; description: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState<string | null>(null);

  // Get market ID from query parameter
  // Usage: /market?marketId=0field or /market?marketId=1field
  const marketId = (router.query.marketId as string) || null;

  useEffect(() => {
    if (!marketId) {
      setLoading(false);
      setError('MARKET_ID_REQUIRED');
      return;
    }
    
    loadMarketState();
    // Poll for updates every 10 seconds, only if no error
    const interval = setInterval(() => {
      if (!error && marketId) {
        loadMarketState();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [error, marketId]);

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

  const handleTransactionSubmitted = (txId: string) => {
    setTransactionId(txId);
    // Reload market state after a short delay
    setTimeout(loadMarketState, 2000);
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

      <div className="container mx-auto px-4 py-8">
        {transactionId && (
          <div className="alert alert-success mb-4">
            <span>Transaction submitted: {transactionId}</span>
          </div>
        )}

        <MarketHeader
          title={displayTitle}
          description={displayDescription}
          status={marketState.status}
        />

        <StatusBanner status={marketState.status} outcome={marketState.outcome} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <PriceDisplay
              yesReserve={marketState.yesReserve}
              noReserve={marketState.noReserve}
            />
            <MarketStats
              collateralPool={marketState.collateralPool}
              yesReserve={marketState.yesReserve}
              noReserve={marketState.noReserve}
              feeBps={marketState.feeBps}
            />
          </div>

          <div>
            <BuyForm
              marketId={marketId}
              marketState={marketState}
              isOpen={marketState.status === 0}
              isPaused={marketState.isPaused}
              onTransactionSubmitted={handleTransactionSubmitted}
            />
          </div>
        </div>
      </div>
    </>
  );
};

MarketPage.getLayout = (page) => <Layout>{page}</Layout>;
export default MarketPage;
