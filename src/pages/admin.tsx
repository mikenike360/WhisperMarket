import React, { useState, useEffect } from 'react';
import type { NextPageWithLayout } from '@/types';
import { NextSeo } from 'next-seo';
import Layout from '@/layouts/_layout';
import { useRouter } from 'next/router';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { WalletNotConnectedError } from '@provablehq/aleo-wallet-adaptor-core';
import {
  getMarketState,
  resolveMarket,
  pause,
  unpause,
} from '@/components/aleo/rpc';
import { PREDICTION_MARKET_PROGRAM_ID } from '@/types';

// Admin address from the program: aleo17hqgrmy5nk5s7adxhckhsk0k23r7e343ddcnnx49r59lx64thq9q302526
const ADMIN_ADDRESS = 'aleo17hqgrmy5nk5s7adxhckhsk0k23r7e343ddcnnx49r59lx64thq9q302526';

const AdminPage: NextPageWithLayout = () => {
  const router = useRouter();
  const { publicKey } = useWallet();
  const [marketState, setMarketState] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Get market ID from query parameter
  // Usage: /admin?marketId=0field or /admin?marketId=1field
  const marketId = (router.query.marketId as string) || null;

  const isAdmin = publicKey?.toString() === ADMIN_ADDRESS;

  useEffect(() => {
    if (!marketId) {
      setLoading(false);
      setError('MARKET_ID_REQUIRED');
      return;
    }

    if (publicKey && isAdmin) {
      loadMarketState();
      // Poll for updates every 5 seconds
      const interval = setInterval(loadMarketState, 5000);
      return () => clearInterval(interval);
    } else {
      setLoading(false);
    }
  }, [publicKey, isAdmin, marketId]);

  const loadMarketState = async () => {
    if (!marketId) return;
    
    try {
      setLoading(true);
      const state = await getMarketState(marketId);
      setMarketState(state);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load market state');
    } finally {
      setLoading(false);
    }
  };

  const handleResolve = async () => {
    if (!publicKey) {
      setError('Please connect your wallet');
      return;
    }

    if (!confirm(`Are you sure you want to resolve the market as ${outcome ? 'YES' : 'NO'}?`)) {
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      const txId = await resolveMarket(marketId, outcome);
      alert(`Resolution transaction submitted: ${txId}`);
      setTimeout(loadMarketState, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to resolve market');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePause = async () => {
    if (!publicKey) {
      setError('Please connect your wallet');
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      const txId = await pause(marketId);
      alert(`Pause transaction submitted: ${txId}`);
      setTimeout(loadMarketState, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to pause market');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnpause = async () => {
    if (!publicKey) {
      setError('Please connect your wallet');
      return;
    }

    setActionLoading(true);
    setError(null);

    try {
      const txId = await unpause(marketId);
      alert(`Unpause transaction submitted: ${txId}`);
      setTimeout(loadMarketState, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to unpause market');
    } finally {
      setActionLoading(false);
    }
  };

  if (!publicKey) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="alert alert-warning">
          <span>Please connect your wallet</span>
        </div>
      </div>
    );
  }

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
              Example: <code className="badge badge-ghost">/admin?marketId=0field</code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="alert alert-error">
          <span>Access denied. This page is only accessible to the admin.</span>
        </div>
      </div>
    );
  }

  if (loading && !marketState) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center items-center min-h-[400px]">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      </div>
    );
  }

  const currentPricePercent = marketState ? (marketState.priceYes / 100).toFixed(2) : '0';

  return (
    <>
      <NextSeo title="Admin Panel" description="Manage prediction market settings" />

      <div className="container mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold mb-8">Admin Panel</h1>

        {error && (
          <div className="alert alert-error mb-6">
            <span>{error}</span>
          </div>
        )}

        {marketState && (
          <div className="card bg-base-100 shadow-xl mb-6">
            <div className="card-body">
              <h2 className="card-title mb-4">Current Market State</h2>
              <div className="stats stats-vertical lg:stats-horizontal shadow w-full">
                <div className="stat">
                  <div className="stat-title">Status</div>
                  <div className="stat-value">
                    {marketState.status === 0
                      ? 'Open'
                      : marketState.status === 1
                      ? 'Resolved'
                      : 'Paused'}
                  </div>
                </div>
                <div className="stat">
                  <div className="stat-title">YES Price</div>
                  <div className="stat-value">{currentPricePercent}%</div>
                </div>
                <div className="stat">
                  <div className="stat-title">Outcome</div>
                  <div className="stat-value">
                    {marketState.outcome === null
                      ? 'Pending'
                      : marketState.outcome
                      ? 'YES'
                      : 'NO'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Resolve Market */}
          <div className="card bg-base-100 shadow-xl">
            <div className="card-body">
              <h3 className="card-title mb-4">Resolve Market</h3>
              <div className="form-control mb-4">
                <label className="label">
                  <span className="label-text">Outcome</span>
                </label>
                <select
                  className="select select-bordered w-full"
                  value={outcome ? 'true' : 'false'}
                  onChange={(e) => setOutcome(e.target.value === 'true')}
                  disabled={actionLoading || marketState?.status !== 0}
                >
                  <option value="true">YES</option>
                  <option value="false">NO</option>
                </select>
              </div>
              <button
                className="btn btn-warning w-full"
                onClick={handleResolve}
                disabled={actionLoading || marketState?.status !== 0}
              >
                {actionLoading ? (
                  <span className="loading loading-spinner"></span>
                ) : (
                  'Resolve Market'
                )}
              </button>
            </div>
          </div>

          {/* Pause/Unpause */}
          <div className="card bg-base-100 shadow-xl lg:col-span-2">
            <div className="card-body">
              <h3 className="card-title mb-4">Market Control</h3>
              <div className="flex gap-4">
                <button
                  className="btn btn-warning flex-1"
                  onClick={handlePause}
                  disabled={actionLoading || marketState?.status !== 0}
                >
                  {actionLoading ? (
                    <span className="loading loading-spinner"></span>
                  ) : (
                    'Pause Market'
                  )}
                </button>
                <button
                  className="btn btn-success flex-1"
                  onClick={handleUnpause}
                  disabled={actionLoading || marketState?.status !== 2}
                >
                  {actionLoading ? (
                    <span className="loading loading-spinner"></span>
                  ) : (
                    'Unpause Market'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

AdminPage.getLayout = (page) => <Layout>{page}</Layout>;
export default AdminPage;
