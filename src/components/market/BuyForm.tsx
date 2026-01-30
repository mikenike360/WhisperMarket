import React, { useState, useEffect } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { WalletNotConnectedError } from '@provablehq/aleo-wallet-adaptor-core';
import {
  openPositionPrivate,
  depositPrivate,
  swapCollateralForYesPrivate,
  swapCollateralForNoPrivate,
  getUserPositionRecords,
  getMarketState,
  findPositionRecordForMarket,
} from '@/components/aleo/rpc';
import { filterUnspentRecords, pickRecordForAmount } from '@/components/aleo/wallet/records';
import { calculateSwapOutput } from '@/utils/positionHelpers';
import { toMicrocredits, toCredits } from '@/utils/credits';
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
  const { publicKey, wallet, address, requestRecords } = useWallet();
  const userAddress = publicKey || address;
  const [amount, setAmount] = useState<string>('');
  const [side, setSide] = useState<'yes' | 'no'>('yes');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPosition, setHasPosition] = useState(false);
  const [positionRecord, setPositionRecord] = useState<any>(null);
  const [estimatedOutputMicrocredits, setEstimatedOutputMicrocredits] = useState<number | null>(null);

  // Check for existing position and fetch the record object
  useEffect(() => {
    const checkPosition = async () => {
      if (!wallet || !userAddress || !marketId) {
        setHasPosition(false);
        setPositionRecord(null);
        return;
      }

      try {
        const position = await getUserPositionRecords(
          wallet,
          PREDICTION_MARKET_PROGRAM_ID,
          marketId,
          requestRecords ?? undefined
        );
        setHasPosition(position !== null);
        
        if (position && requestRecords) {
          const allRecords = await requestRecords(PREDICTION_MARKET_PROGRAM_ID);
          setPositionRecord(findPositionRecordForMarket(allRecords ?? [], marketId));
        } else {
          setPositionRecord(null);
        }
      } catch (err) {
        setHasPosition(false);
        setPositionRecord(null);
      }
    };

    checkPosition();
  }, [wallet, userAddress, marketId, requestRecords]);

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

  const handleDeposit = async () => {
    if (!userAddress || !wallet) {
      setError('Please connect your wallet');
      return;
    }

    const depositAmountCredits = parseFloat(amount);
    if (isNaN(depositAmountCredits) || depositAmountCredits <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    const depositMicrocredits = Math.floor(toMicrocredits(depositAmountCredits));
    if (depositMicrocredits < 1) {
      setError('Deposit amount is too small (minimum 1 microcredit)');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      if (!requestRecords) {
        throw new Error('Wallet does not support record access. Please use a wallet that supports viewing records.');
      }
      const creditRecords = await requestRecords('credits.aleo');
      const unspentCredits = filterUnspentRecords(creditRecords ?? []);
      if (unspentCredits.length === 0) {
        throw new Error('No unspent credit records found');
      }
      const chosen = pickRecordForAmount(unspentCredits, depositMicrocredits);
      if (!chosen) {
        throw new Error('No credit record with sufficient balance');
      }
      const creditRecord = chosen.record;

      let txId: string;
      if (hasPosition && positionRecord) {
        txId = await depositPrivate(
          wallet,
          userAddress,
          marketId,
          creditRecord,
          depositMicrocredits,
          positionRecord,
          0
        );
      } else {
        txId = await openPositionPrivate(
          wallet,
          userAddress,
          marketId,
          creditRecord,
          depositMicrocredits,
          0
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

      const position = await getUserPositionRecords(
        wallet,
        PREDICTION_MARKET_PROGRAM_ID,
        marketId,
        requestRecords
      );

      if (!position) {
        throw new Error('No position found. Please deposit first.');
      }

      const allRecords = await requestRecords(PREDICTION_MARKET_PROGRAM_ID);
      const positionRecordObj = findPositionRecordForMarket(allRecords ?? [], marketId);
      if (!positionRecordObj) {
        throw new Error('Position record not found in wallet');
      }

      if (position.collateralAvailable < buyMicrocredits) {
        throw new Error(
          `Insufficient available collateral. Available: ${toCredits(position.collateralAvailable).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} credits`
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
          positionRecordObj,
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
          positionRecordObj,
          buyMicrocredits,
          minOutput,
          marketState.yesReserve,
          marketState.noReserve,
          marketState.feeBps,
          0
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
            <span className="label-text">Collateral Amount (credits)</span>
          </label>
          <input
            type="number"
            placeholder="Enter amount in credits"
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

        {estimatedOutputMicrocredits !== null && (
          <div className="alert alert-info mb-4">
            <span>
              Estimated {side.toUpperCase()} shares: {toCredits(estimatedOutputMicrocredits).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} credits
            </span>
          </div>
        )}

        {!userAddress && (
          <div className="alert alert-warning mb-4">
            <span>Connect your wallet to buy shares or deposit</span>
          </div>
        )}
        <div className="flex gap-2">
          <button
            className="btn btn-primary flex-1"
            onClick={handleBuy}
            disabled={loading || !userAddress || !wallet || !isOpen || isPaused}
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
            disabled={loading || !userAddress || !wallet}
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
