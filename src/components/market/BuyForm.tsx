import React, { useState, useEffect } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { WalletNotConnectedError } from '@provablehq/aleo-wallet-adaptor-core';
import {
  openPositionPrivate,
  depositPrivate,
  swapCollateralForYesPrivate,
  swapCollateralForNoPrivate,
  getUserPositionRecords,
} from '@/components/aleo/rpc';
import { getMarketState } from '@/components/aleo/rpc';
import { calculateSwapOutput } from '@/utils/positionHelpers';
import { PREDICTION_MARKET_PROGRAM_ID, MarketState } from '@/types';

interface BuyFormProps {
  marketId: string; // Field-based market ID
  marketState: MarketState | null;
  isOpen: boolean;
  isPaused: boolean;
  onTransactionSubmitted?: (txId: string) => void;
}

const SLIPPAGE_TOLERANCE = 0.01; // 1% slippage tolerance

export const BuyForm: React.FC<BuyFormProps> = ({
  marketId,
  marketState,
  isOpen,
  isPaused,
  onTransactionSubmitted,
}) => {
  const { publicKey, wallet } = useWallet();
  const [amount, setAmount] = useState<string>('');
  const [side, setSide] = useState<'yes' | 'no'>('yes');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPosition, setHasPosition] = useState(false);
  const [positionRecord, setPositionRecord] = useState<any>(null);
  const [estimatedOutput, setEstimatedOutput] = useState<number | null>(null);

  // Check for existing position and fetch the record object
  useEffect(() => {
    const checkPosition = async () => {
      if (!wallet || !publicKey || !marketId) {
        setHasPosition(false);
        setPositionRecord(null);
        return;
      }

      try {
        const position = await getUserPositionRecords(
          wallet,
          PREDICTION_MARKET_PROGRAM_ID,
          marketId
        );
        setHasPosition(position !== null);
        
        // Fetch the actual record object for transactions
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
      } catch (err) {
        setHasPosition(false);
        setPositionRecord(null);
      }
    };

    checkPosition();
  }, [wallet, publicKey, marketId]);

  // Calculate estimated output when amount or side changes
  useEffect(() => {
    if (!marketState || !amount) {
      setEstimatedOutput(null);
      return;
    }

    const collateralIn = parseFloat(amount);
    if (isNaN(collateralIn) || collateralIn <= 0) {
      setEstimatedOutput(null);
      return;
    }

    try {
      const output = calculateSwapOutput(
        collateralIn,
        marketState.yesReserve,
        marketState.noReserve,
        marketState.feeBps,
        side
      );
      setEstimatedOutput(output);
    } catch (err) {
      setEstimatedOutput(null);
    }
  }, [amount, side, marketState]);

  const handleDeposit = async () => {
    if (!publicKey || !wallet) {
      setError('Please connect your wallet');
      return;
    }

    const depositAmount = parseFloat(amount);
    if (isNaN(depositAmount) || depositAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Fetch credit records from wallet
      const creditRecords = await wallet.requestRecords('credits.aleo');
      const unspentCredits = creditRecords.filter(
        (r: any) => !r.spent && r.data?.microcredits
      );

      if (unspentCredits.length === 0) {
        throw new Error('No unspent credit records found');
      }

      // Find a credit record with sufficient balance
      const neededAmount = depositAmount * 1_000_000; // Convert to microcredits
      const creditRecord = unspentCredits.find((r: any) => {
        const value = parseInt(r.data.microcredits.replace(/u64\.private$/, ''), 10);
        return value >= neededAmount;
      });

      if (!creditRecord) {
        throw new Error('No credit record with sufficient balance');
      }

      let txId: string;
      if (hasPosition && positionRecord) {
        // Use deposit_private for existing position
        txId = await depositPrivate(
          marketId,
          creditRecord,
          depositAmount,
          positionRecord,
          0 // status_hint: 0 = open
        );
      } else {
        // Use open_position_private for new position
        txId = await openPositionPrivate(
          marketId,
          creditRecord,
          depositAmount,
          0 // status_hint: 0 = open
        );
      }

      onTransactionSubmitted?.(txId);
      setAmount('');
    } catch (err: any) {
      setError(err.message || 'Failed to deposit');
    } finally {
      setLoading(false);
    }
  };

  const handleBuy = async () => {
    if (!publicKey || !wallet) {
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

    const buyAmount = parseFloat(amount);
    if (isNaN(buyAmount) || buyAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Get user's Position record
      const position = await getUserPositionRecords(
        wallet,
        PREDICTION_MARKET_PROGRAM_ID,
        marketId
      );

      if (!position) {
        throw new Error('No position found. Please deposit first.');
      }

      // Fetch the actual Position record object (we need the full record, not just parsed data)
      const allRecords = await wallet.requestRecords(PREDICTION_MARKET_PROGRAM_ID);
      const positionRecordObj = allRecords.find((r: any) => {
        if (r.spent) return false;
        const recordData = r.data || r;
        if (recordData.market_id) {
          const recordMarketId = String(recordData.market_id).replace(/\.private$/, '');
          return recordMarketId === marketId;
        }
        return false;
      });

      if (!positionRecordObj) {
        throw new Error('Position record not found in wallet');
      }

      // Check if user has sufficient available collateral
      if (position.collateralAvailable < buyAmount) {
        throw new Error(`Insufficient available collateral. Available: ${position.collateralAvailable}`);
      }

      // Calculate expected output with slippage protection
      const expectedOutput = calculateSwapOutput(
        buyAmount,
        marketState.yesReserve,
        marketState.noReserve,
        marketState.feeBps,
        side
      );

      const minOutput = Math.floor(expectedOutput * (1 - SLIPPAGE_TOLERANCE));

      let txId: string;
      if (side === 'yes') {
        txId = await swapCollateralForYesPrivate(
          marketId,
          positionRecordObj,
          buyAmount,
          minOutput,
          marketState.yesReserve,
          marketState.noReserve,
          marketState.feeBps,
          0 // status_hint: 0 = open
        );
      } else {
        txId = await swapCollateralForNoPrivate(
          marketId,
          positionRecordObj,
          buyAmount,
          minOutput,
          marketState.yesReserve,
          marketState.noReserve,
          marketState.feeBps,
          0 // status_hint: 0 = open
        );
      }

      onTransactionSubmitted?.(txId);
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
        <h3 className="card-title mb-4">Buy Shares</h3>

        {error && (
          <div className="alert alert-error mb-4">
            <span>{error}</span>
          </div>
        )}

        <div className="form-control mb-4">
          <label className="label">
            <span className="label-text">Collateral Amount</span>
          </label>
          <input
            type="number"
            placeholder="Enter amount"
            className="input input-bordered w-full"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0"
            step="0.01"
            disabled={loading}
          />
        </div>

        <div className="form-control mb-4">
          <label className="label">
            <span className="label-text">Choose Side</span>
          </label>
          <div className="btn-group w-full">
            <button
              className={`btn flex-1 ${side === 'yes' ? 'btn-success' : 'btn-outline btn-success'}`}
              onClick={() => setSide('yes')}
              disabled={loading}
            >
              YES
            </button>
            <button
              className={`btn flex-1 ${side === 'no' ? 'btn-error' : 'btn-outline btn-error'}`}
              onClick={() => setSide('no')}
              disabled={loading}
            >
              NO
            </button>
          </div>
        </div>

        {estimatedOutput !== null && (
          <div className="alert alert-info mb-4">
            <span>
              Estimated {side.toUpperCase()} shares: {estimatedOutput.toLocaleString()}
            </span>
          </div>
        )}

        <div className="flex gap-2">
          <button
            className="btn btn-primary flex-1"
            onClick={handleBuy}
            disabled={loading || !isOpen || isPaused}
          >
            {loading ? (
              <span className="loading loading-spinner"></span>
            ) : (
              `Buy ${side.toUpperCase()}`
            )}
          </button>
          <button
            className="btn btn-secondary flex-1"
            onClick={handleDeposit}
            disabled={loading}
          >
            {loading ? (
              <span className="loading loading-spinner"></span>
            ) : (
              'Deposit'
            )}
          </button>
        </div>

        {isPaused && (
          <div className="alert alert-warning mt-4">
            <span>Market is currently paused</span>
          </div>
        )}

        {!isOpen && (
          <div className="alert alert-info mt-4">
            <span>Market is closed</span>
          </div>
        )}
      </div>
    </div>
  );
};
