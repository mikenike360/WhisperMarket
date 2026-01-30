import React, { useState } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { WalletNotConnectedError } from '@provablehq/aleo-wallet-adaptor-core';
import { redeemPrivate } from '@/components/aleo/rpc';
import { toCredits } from '@/utils/credits';

interface RedeemButtonProps {
  marketId: string;
  positionRecord: any;
  isResolved: boolean;
  outcome: boolean | null;
  userYesShares: number;
  userNoShares: number;
  alreadyRedeemed: boolean;
  estimatedPayout?: number;
  onRedeemed?: () => void;
}

export const RedeemButton: React.FC<RedeemButtonProps> = ({
  marketId,
  positionRecord,
  isResolved,
  outcome,
  userYesShares,
  userNoShares,
  alreadyRedeemed,
  estimatedPayout,
  onRedeemed,
}) => {
  const { publicKey, wallet } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasWinningShares =
    (outcome === true && userYesShares > 0) ||
    (outcome === false && userNoShares > 0);

  const handleRedeem = async () => {
    if (!publicKey || !wallet) {
      setError('Please connect your wallet');
      return;
    }

    if (!isResolved) {
      setError('Market is not resolved yet');
      return;
    }

    if (alreadyRedeemed) {
      setError('You have already redeemed');
      return;
    }

    if (!hasWinningShares) {
      setError('You have no winning shares to redeem');
      return;
    }

    if (!positionRecord) {
      setError('Position record not found');
      return;
    }

    if (outcome === null) {
      setError('Market outcome not available');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const txId = await redeemPrivate(wallet, publicKey, marketId, positionRecord, outcome);
      onRedeemed?.();
      alert(`Redeem transaction submitted: ${txId}`);
    } catch (err: any) {
      setError(err.message || 'Failed to redeem shares');
    } finally {
      setLoading(false);
    }
  };

  if (!isResolved) {
    return (
      <div className="alert alert-info">
        <span>Market is not resolved yet. Wait for resolution to redeem.</span>
      </div>
    );
  }

  if (alreadyRedeemed) {
    return (
      <div className="alert alert-success">
        <span>You have already redeemed your winning shares.</span>
      </div>
    );
  }

  if (!hasWinningShares) {
    return (
      <div className="alert alert-warning">
        <span>
          You have no winning shares. Outcome: {outcome ? 'YES' : 'NO'} wins, but you
          don't hold any {outcome ? 'YES' : 'NO'} shares.
        </span>
      </div>
    );
  }

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h3 className="card-title mb-4">Redeem Winning Shares</h3>

        {error && (
          <div className="alert alert-error mb-4">
            <span>{error}</span>
          </div>
        )}

        {estimatedPayout !== undefined && (
          <div className="alert alert-info mb-4">
            <span>Estimated payout: {toCredits(estimatedPayout).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} credits</span>
          </div>
        )}

        <button
          className="btn btn-success btn-lg w-full"
          onClick={handleRedeem}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="loading loading-spinner"></span>
              Processing...
            </>
          ) : (
            `Redeem ${outcome ? 'YES' : 'NO'} Shares`
          )}
        </button>
      </div>
    </div>
  );
};
