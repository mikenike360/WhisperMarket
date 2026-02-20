'use client';

import React, { useState } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { openPositionPrivate } from '@/lib/aleo/rpc';

interface OpenPositionBlockProps {
  marketId: string;
  isMarketOpen: boolean;
  onOpened?: () => void;
  onTransactionSubmitted?: () => void;
}

export const OpenPositionBlock: React.FC<OpenPositionBlockProps> = ({
  marketId,
  isMarketOpen,
  onOpened,
  onTransactionSubmitted,
}) => {
  const { publicKey, wallet, address, requestRecords } = useWallet();
  const userAddress = publicKey || address;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = async () => {
    if (!userAddress || !wallet) {
      setError('Please connect your wallet');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await openPositionPrivate(wallet, userAddress, marketId, isMarketOpen ? 0 : 2, requestRecords ?? undefined);
      onOpened?.();
      onTransactionSubmitted?.();
    } catch (err: any) {
      setError(err.message || 'Failed to open position');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-base-300 bg-base-200/40 p-4">
      <p className="text-sm text-base-content mb-3">
        You need a position in this market to trade. Open one first (one-time per market). Then add Cash from Portfolio to buy or sell.
      </p>
      {error && (
        <div className="alert alert-error text-sm py-2 mb-3">
          <span>{error}</span>
        </div>
      )}
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={handleOpen}
        disabled={loading || !userAddress || !wallet}
      >
        {loading ? <span className="loading loading-spinner loading-sm" /> : 'Open position'}
      </button>
    </div>
  );
};
