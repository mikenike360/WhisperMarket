import React, { useState, useEffect } from 'react';
import type { NextPageWithLayout } from '@/types';
import { NextSeo } from 'next-seo';
import Layout from '@/layouts/_layout';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import {
  getMarketState,
  resolveMarket,
  pause,
  unpause,
  getAllMarkets,
  type MarketRegistryEntry,
} from '@/lib/aleo/rpc';
import { MarketState, MarketMetadata } from '@/types';
import { AdminMarketCard } from '@/components/admin/AdminMarketCard';
import {
  isAdminAddress,
  getAdminSignInMessage,
  hasValidAdminSignIn,
  setAdminSignedIn,
  clearAdminSignedIn,
} from '@/config/admin';
import { getMarketsMetadata } from '@/services/marketMetadata';
import { useTransaction } from '@/contexts/TransactionContext';

const AdminPage: NextPageWithLayout = () => {
  const walletHook = useWallet();
  const { publicKey, wallet, address, signMessage } = walletHook as any;
  const { addTransaction } = useTransaction();
  const [markets, setMarkets] = useState<MarketRegistryEntry[]>([]);
  const [marketStates, setMarketStates] = useState<Record<string, MarketState>>({});
  const [marketMetadata, setMarketMetadata] = useState<Record<string, MarketMetadata>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [adminSignedIn, setAdminSignedInState] = useState(false);
  const [signInLoading, setSignInLoading] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  const userAddress = publicKey || address;
  const isAdminAddressMatch = isAdminAddress(userAddress);

  // Restore admin sign-in from session on mount
  useEffect(() => {
    if (userAddress && hasValidAdminSignIn(userAddress)) {
      setAdminSignedInState(true);
    } else {
      setAdminSignedInState(false);
    }
  }, [userAddress]);

  const isAdmin = isAdminAddressMatch && adminSignedIn;

  // Load markets and their states
  const loadMarkets = async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Fetch all markets from registry
      const allMarkets = await getAllMarkets();
      setMarkets(allMarkets);

      // Fetch metadata for all markets
      const marketIds = allMarkets.map(m => m.marketId);
      const metadataMap = await getMarketsMetadata(marketIds);
      // Convert Omit<MarketMetadata, "marketId"> to MarketMetadata by adding marketId
      const fullMetadataMap: Record<string, MarketMetadata> = {};
      Object.entries(metadataMap).forEach(([marketId, metadata]) => {
        fullMetadataMap[marketId] = { ...metadata, marketId };
      });
      setMarketMetadata(fullMetadataMap);

      // Fetch state for each market in parallel
      const statePromises = allMarkets.map(async (market) => {
        try {
          const state = await getMarketState(market.marketId);
          return { marketId: market.marketId, state };
        } catch (err: any) {
          if (process.env.NODE_ENV === 'development') {
          }
          return { marketId: market.marketId, state: null };
        }
      });

      const stateResults = await Promise.all(statePromises);
      const statesMap: Record<string, MarketState> = {};
      stateResults.forEach(({ marketId, state }) => {
        if (state) {
          statesMap[marketId] = state;
        }
      });
      setMarketStates(statesMap);
    } catch (err: any) {
      setError(err.message || 'Failed to load markets');
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    if (isAdmin) {
      loadMarkets();
    } else {
      setLoading(false);
    }
  }, [isAdmin]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!isAdmin) return;

    const interval = setInterval(() => {
      loadMarkets();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [isAdmin]);

  const refreshMarket = async (marketId: string) => {
    try {
      const state = await getMarketState(marketId);
      setMarketStates((prev) => ({
        ...prev,
        [marketId]: state,
      }));
    } catch (err: any) {
      if (process.env.NODE_ENV === 'development') {
      }
    }
  };

  const handleResolve = async (marketId: string, outcome: boolean) => {
    // Check if wallet is connected - some wallets use 'address' instead of 'publicKey'
    const userPublicKey = publicKey || address;
    if (!userPublicKey || !wallet) {
      setError('Please connect your wallet');
      return;
    }

    if (!confirm(`Are you sure you want to resolve market ${marketId.slice(0, 8)}... as ${outcome ? 'YES' : 'NO'}?`)) {
      return;
    }

    setActionLoading((prev) => ({ ...prev, [marketId]: true }));
    setError(null);
    setSuccessMessage(null);

    try {
      const txId = await resolveMarket(wallet, userPublicKey, marketId, outcome);
      addTransaction({ id: txId, label: 'Resolve market' });
      setSuccessMessage(`Market resolved! Transaction ID: ${txId}`);
      
      // Wait a bit then refresh market state
      setTimeout(() => {
        refreshMarket(marketId);
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to resolve market');
      throw err; // Re-throw so AdminMarketCard can handle it
    } finally {
      setActionLoading((prev) => ({ ...prev, [marketId]: false }));
    }
  };

  const handlePause = async (marketId: string) => {
    // Check if wallet is connected - some wallets use 'address' instead of 'publicKey'
    const userPublicKey = publicKey || address;
    if (!userPublicKey || !wallet) {
      setError('Please connect your wallet');
      return;
    }

    if (!confirm(`Are you sure you want to pause market ${marketId.slice(0, 8)}...?`)) {
      return;
    }

    setActionLoading((prev) => ({ ...prev, [marketId]: true }));
    setError(null);
    setSuccessMessage(null);

    try {
      const txId = await pause(wallet, userPublicKey, marketId);
      addTransaction({ id: txId, label: 'Pause market' });
      setSuccessMessage(`Market paused! Transaction ID: ${txId}`);
      
      // Wait a bit then refresh market state
      setTimeout(() => {
        refreshMarket(marketId);
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to pause market');
      throw err; // Re-throw so AdminMarketCard can handle it
    } finally {
      setActionLoading((prev) => ({ ...prev, [marketId]: false }));
    }
  };

  const handleUnpause = async (marketId: string) => {
    // Check if wallet is connected - some wallets use 'address' instead of 'publicKey'
    const userPublicKey = publicKey || address;
    if (!userPublicKey || !wallet) {
      setError('Please connect your wallet');
      return;
    }

    if (!confirm(`Are you sure you want to unpause market ${marketId.slice(0, 8)}...?`)) {
      return;
    }

    setActionLoading((prev) => ({ ...prev, [marketId]: true }));
    setError(null);
    setSuccessMessage(null);

    try {
      const txId = await unpause(wallet, userPublicKey, marketId);
      addTransaction({ id: txId, label: 'Unpause market' });
      setSuccessMessage(`Market unpaused! Transaction ID: ${txId}`);
      
      // Wait a bit then refresh market state
      setTimeout(() => {
        refreshMarket(marketId);
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to unpause market');
      throw err; // Re-throw so AdminMarketCard can handle it
    } finally {
      setActionLoading((prev) => ({ ...prev, [marketId]: false }));
    }
  };

  const handleAdminSignIn = async () => {
    if (!userAddress || !signMessage || typeof signMessage !== 'function') {
      setSignInError('Wallet does not support signing messages');
      return;
    }
    setSignInLoading(true);
    setSignInError(null);
    try {
      const message = getAdminSignInMessage();
      await signMessage(message);
      setAdminSignedIn(userAddress);
      setAdminSignedInState(true);
    } catch (err: any) {
      setSignInError(err?.message || 'Failed to sign message');
    } finally {
      setSignInLoading(false);
    }
  };

  const handleAdminSignOut = () => {
    clearAdminSignedIn(userAddress ?? undefined);
    setAdminSignedInState(false);
  };

  if (!userAddress) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="alert alert-warning">
          <span>Please connect your wallet to access the admin panel</span>
        </div>
      </div>
    );
  }

  if (!isAdminAddressMatch) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="alert alert-error">
          <span>Access denied. This page is only accessible to the admin wallet.</span>
          <div className="text-sm mt-2">
            Connected: {String(userAddress).slice(0, 20)}...
          </div>
        </div>
      </div>
    );
  }

  if (!adminSignedIn) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <NextSeo title="Admin Sign In | WhisperMarket" description="Sign in to the admin panel" />
        <div className="max-w-md mx-auto">
          <div className="card bg-base-100 shadow-xl rounded-xl">
            <div className="card-body">
              <h1 className="card-title text-2xl">Admin Sign In</h1>
              <p className="text-base-content">
                Sign a message with your wallet to prove you control the admin address and access the admin panel.
              </p>
              <p className="text-sm text-base-content">
                Connected: <code className="text-xs">{String(userAddress).slice(0, 24)}...</code>
              </p>
              {signInError && (
                <div className="alert alert-error">
                  <span>{signInError}</span>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSignInError(null)}>✕</button>
                </div>
              )}
              <div className="card-actions justify-end mt-4">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleAdminSignIn}
                  disabled={signInLoading}
                >
                  {signInLoading ? (
                    <>
                      <span className="loading loading-spinner loading-sm" />
                      Signing...
                    </>
                  ) : (
                    'Sign in to Admin'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <NextSeo title="Admin | WhisperMarket" description="Manage prediction markets" />

      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex flex-col sm:flex-row items-start justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold mb-1">Admin</h1>
            <p className="text-base-content text-sm sm:text-base">
              Manage prediction markets. Connected as <code className="text-xs bg-base-200 px-1.5 py-0.5 rounded">{String(userAddress).slice(0, 16)}…</code>
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handleAdminSignOut}
              title="Sign out from admin (you will need to sign again to access)"
            >
              Sign out
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm sm:btn-md gap-2"
              onClick={loadMarkets}
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

        {successMessage && (
          <div className="alert alert-success mb-6 flex items-center justify-between gap-4">
            <span>{successMessage}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => setSuccessMessage(null)} aria-label="Dismiss">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {loading && markets.length === 0 ? (
          <div className="flex justify-center items-center min-h-[400px]">
            <span className="loading loading-spinner loading-lg" />
          </div>
        ) : markets.length === 0 ? (
          <div className="card bg-base-200 shadow-xl rounded-xl">
            <div className="card-body">
              <h2 className="card-title text-info">No markets found</h2>
              <p className="text-base-content">Create a market from the Markets page to get started.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {markets.map((market) => (
              <AdminMarketCard
                key={market.marketId}
                marketId={market.marketId}
                marketState={marketStates[market.marketId] || null}
                metadata={marketMetadata[market.marketId]}
                onResolve={handleResolve}
                onPause={handlePause}
                onUnpause={handleUnpause}
                actionLoading={actionLoading[market.marketId] || false}
              />
            ))}
          </div>
        )}

        {markets.length > 0 && (
          <div className="mt-8 text-center text-sm text-base-content">
            Total markets: {markets.length} | Auto-refreshes every 30 seconds
          </div>
        )}
      </div>
    </>
  );
};

AdminPage.getLayout = (page) => <Layout>{page}</Layout>;
export default AdminPage;
