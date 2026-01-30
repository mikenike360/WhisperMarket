import React, { useState, useEffect } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import {
  swapCollateralForYesPrivate,
  swapCollateralForNoPrivate,
} from '@/lib/aleo/rpc';
import { calculateSwapOutput } from '@/utils/positionHelpers';
import { toMicrocredits, toCredits } from '@/utils/credits';
import { MarketState, UserPosition } from '@/types';

interface BuyFormProps {
  marketId: string;
  marketState: MarketState | null;
  userPosition: UserPosition | null;
  userPositionRecord: any;
  isOpen: boolean;
  isPaused: boolean;
  onTransactionSubmitted?: (txId: string, label?: string) => void;
}

const SLIPPAGE_TOLERANCE = 0.01; // 1% slippage tolerance

export const BuyForm: React.FC<BuyFormProps> = ({
  marketId,
  marketState,
  userPosition,
  userPositionRecord,
  isOpen,
  isPaused,
  onTransactionSubmitted,
}) => {
  const { publicKey, wallet, address, requestRecords } = useWallet();
  const userAddress = publicKey || address;
  const [amount, setAmount] = useState<string>('');
  const [side, setSide] = useState<'yes' | 'no'>('yes');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimatedOutputMicrocredits, setEstimatedOutputMicrocredits] = useState<number | null>(null);
  const hasPosition = userPosition !== null;

  // Calculate estimated output when amount or side changes (all amounts in microcredits)
  useEffect(() => {
    if (!marketState || !amount) {
      setEstimatedOutputMicrocredits(null);
      return;
    }

    const collateralInCredits = parseFloat(amount);
    if (isNaN(collateralInCredits) || collateralInCredits <= 0) {
      setEstimatedOutputMicrocredits(null);
      return;
    }

    try {
      const collateralInMicrocredits = toMicrocredits(collateralInCredits);
      const output = calculateSwapOutput(
        collateralInMicrocredits,
        marketState.yesReserve,
        marketState.noReserve,
        marketState.feeBps,
        side
      );
      setEstimatedOutputMicrocredits(output);
    } catch (err) {
      setEstimatedOutputMicrocredits(null);
    }
  }, [amount, side, marketState]);

  const handleBuy = async () => {
    if (!userAddress || !wallet) {
      setError('Please connect your wallet');
      return;
    }

    if (!isOpen || isPaused) {
      setError('Market is not open for trading');
      return;
    }

    if (!marketState) {
      setError('Market state not available');
      return;
    }

    const buyAmountCredits = parseFloat(amount);
    if (isNaN(buyAmountCredits) || buyAmountCredits <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    const buyMicrocredits = toMicrocredits(buyAmountCredits);
    setLoading(true);
    setError(null);

    try {
      if (!requestRecords) {
        throw new Error('Wallet does not support record access. Please use a wallet that supports viewing records.');
      }

      if (!userPosition) {
        throw new Error('No position found. Add collateral first using the section above.');
      }

      if (!userPositionRecord) {
        throw new Error('Position record not found in wallet.');
      }

      if (userPosition.collateralAvailable < buyMicrocredits) {
        throw new Error(
          `Insufficient available collateral. Available: ${toCredits(userPosition.collateralAvailable).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} credits`
        );
      }

      const expectedOutput = calculateSwapOutput(
        buyMicrocredits,
        marketState.yesReserve,
        marketState.noReserve,
        marketState.feeBps,
        side
      );

      const minOutput = Math.floor(expectedOutput * (1 - SLIPPAGE_TOLERANCE));

      let txId: string;
      if (side === 'yes') {
        txId = await swapCollateralForYesPrivate(
          wallet,
          userAddress,
          marketId,
          userPositionRecord,
          buyMicrocredits,
          minOutput,
          marketState.yesReserve,
          marketState.noReserve,
          marketState.feeBps,
          0
        );
      } else {
        txId = await swapCollateralForNoPrivate(
          wallet,
          userAddress,
          marketId,
          userPositionRecord,
          buyMicrocredits,
          minOutput,
          marketState.yesReserve,
          marketState.noReserve,
          marketState.feeBps,
          0
        );
      }

      onTransactionSubmitted?.(txId, side === 'yes' ? 'Buy YES' : 'Buy NO');
      setAmount('');
    } catch (err: any) {
      setError(err.message || 'Failed to buy shares');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h3 className="card-title text-base mb-2">Buy shares</h3>
        <p className="text-sm text-base-content/70 mb-4">
          Use your available collateral to buy YES or NO. Add collateral above if you have none.
        </p>

        {error && (
          <div className="alert alert-error mb-4 text-sm">
            <span>{error}</span>
          </div>
        )}

        {!hasPosition && (
          <div className="alert alert-info mb-4 text-sm">
            <span>Add collateral in the section above first, then come back to buy shares.</span>
          </div>
        )}

        <div className="form-control mb-3">
          <label className="label py-1">
            <span className="label-text">Amount to spend (credits)</span>
          </label>
          <input
            type="number"
            placeholder="e.g. 5"
            className="input input-bordered w-full input-sm"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0"
            step="0.01"
            disabled={loading || !hasPosition}
          />
        </div>

        <div className="form-control mb-3">
          <label className="label py-1">
            <span className="label-text">Side</span>
          </label>
          <div className="btn-group w-full">
            <button
              className={`btn btn-sm flex-1 ${side === 'yes' ? 'btn-success' : 'btn-outline btn-success'}`}
              onClick={() => setSide('yes')}
              disabled={loading}
            >
              YES
            </button>
            <button
              className={`btn btn-sm flex-1 ${side === 'no' ? 'btn-error' : 'btn-outline btn-error'}`}
              onClick={() => setSide('no')}
              disabled={loading}
            >
              NO
            </button>
          </div>
        </div>

        {estimatedOutputMicrocredits !== null && amount && (
          <p className="text-sm text-base-content/70 mb-3">
            Estimated {side.toUpperCase()} shares: <strong>{toCredits(estimatedOutputMicrocredits).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}</strong> credits
          </p>
        )}

        {!userAddress && (
          <div className="alert alert-warning mb-4 text-sm">
            <span>Connect your wallet to buy shares</span>
          </div>
        )}

        <button
          className="btn btn-primary w-full btn-sm"
          onClick={handleBuy}
          disabled={loading || !userAddress || !wallet || !isOpen || isPaused || !hasPosition}
        >
          {loading ? (
            <span className="loading loading-spinner loading-sm"></span>
          ) : (
            `Buy ${side.toUpperCase()}`
          )}
        </button>

        {isPaused && (
          <p className="text-warning text-sm mt-3">Market is currently paused</p>
        )}
        {!isOpen && (
          <p className="text-info text-sm mt-3">Market is closed</p>
        )}
      </div>
    </div>
  );
};
