import React, { useState, useEffect } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { swapYesForCollateralPrivate, swapNoForCollateralPrivate } from '@/lib/aleo/rpc';
import { calculateSellYesOutput, calculateSellNoOutput, calculateSellYesNoOut, calculateSellNoYesOut } from '@/utils/positionHelpers';
import { toMicrocredits, toCredits } from '@/utils/credits';
import { MarketState, UserPosition } from '@/types';

interface SellFormProps {
  marketId: string;
  marketState: MarketState | null;
  userPosition: UserPosition | null;
  userPositionRecord: any;
  isOpen: boolean;
  isPaused: boolean;
  onTransactionSubmitted?: (txId: string, label?: string) => void;
  requestRecords?: (programId: string, decrypt?: boolean) => Promise<any[]>;
}

const SLIPPAGE_TOLERANCE = 0.01; // 1%

export const SellForm: React.FC<SellFormProps> = ({
  marketId,
  marketState,
  userPosition,
  userPositionRecord,
  isOpen,
  isPaused,
  onTransactionSubmitted,
  requestRecords: requestRecordsProp,
}) => {
  const { publicKey, wallet, address, requestRecords: requestRecordsHook } = useWallet();
  const requestRecords = requestRecordsProp ?? requestRecordsHook;
  const userAddress = publicKey || address;
  const [amount, setAmount] = useState<string>('');
  const [side, setSide] = useState<'yes' | 'no'>('yes');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimatedCollateralMicrocredits, setEstimatedCollateralMicrocredits] = useState<number | null>(null);

  const maxYes = userPosition?.yesShares ?? 0;
  const maxNo = userPosition?.noShares ?? 0;
  const hasShares = (side === 'yes' && maxYes > 0) || (side === 'no' && maxNo > 0);

  useEffect(() => {
    if (!marketState || !amount) {
      setEstimatedCollateralMicrocredits(null);
      return;
    }
    const amountCredits = parseFloat(amount);
    if (isNaN(amountCredits) || amountCredits <= 0) {
      setEstimatedCollateralMicrocredits(null);
      return;
    }
    try {
      const amountMicrocredits = toMicrocredits(amountCredits);
      const out =
        side === 'yes'
          ? calculateSellYesOutput(amountMicrocredits, marketState.yesReserve, marketState.noReserve, marketState.feeBps)
          : calculateSellNoOutput(amountMicrocredits, marketState.yesReserve, marketState.noReserve, marketState.feeBps);
      setEstimatedCollateralMicrocredits(out);
    } catch {
      setEstimatedCollateralMicrocredits(null);
    }
  }, [amount, side, marketState]);

  const handleSell = async () => {
    if (!userAddress || !wallet) {
      setError('Please connect your wallet');
      return;
    }
    if (!isOpen || isPaused) {
      setError('Market is not open for trading');
      return;
    }
    if (!marketState || !userPosition) {
      setError('Market state or position not available');
      return;
    }
    const amountCredits = parseFloat(amount);
    if (isNaN(amountCredits) || amountCredits <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    const amountMicrocredits = toMicrocredits(amountCredits);
    if (side === 'yes' && amountMicrocredits > maxYes) {
      setError(`Insufficient YES shares. You have ${toCredits(maxYes).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} credits`);
      return;
    }
    if (side === 'no' && amountMicrocredits > maxNo) {
      setError(`Insufficient NO shares. You have ${toCredits(maxNo).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} credits`);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const positionRecord = userPositionRecord ?? undefined;

      let txId: string;
      if (side === 'yes') {
        const expectedNoOut = calculateSellYesNoOut(amountMicrocredits, marketState.yesReserve, marketState.noReserve, marketState.feeBps);
        const minNoOut = Math.floor(expectedNoOut * (1 - SLIPPAGE_TOLERANCE));
        txId = await swapYesForCollateralPrivate(
          wallet,
          userAddress,
          marketId,
          positionRecord,
          amountMicrocredits,
          minNoOut,
          marketState.yesReserve,
          marketState.noReserve,
          marketState.feeBps,
          requestRecords ?? undefined
        );
      } else {
        const expectedYesOut = calculateSellNoYesOut(amountMicrocredits, marketState.yesReserve, marketState.noReserve, marketState.feeBps);
        const minYesOut = Math.floor(expectedYesOut * (1 - SLIPPAGE_TOLERANCE));
        txId = await swapNoForCollateralPrivate(
          wallet,
          userAddress,
          marketId,
          positionRecord,
          amountMicrocredits,
          minYesOut,
          marketState.yesReserve,
          marketState.noReserve,
          marketState.feeBps,
          requestRecords ?? undefined
        );
      }

      onTransactionSubmitted?.(txId, side === 'yes' ? 'Sell YES' : 'Sell NO');
      setAmount('');
    } catch (err: any) {
      setError(err.message || 'Failed to sell shares');
    } finally {
      setLoading(false);
    }
  };

  if (!hasShares && (maxYes === 0 && maxNo === 0)) {
    return (
      <div className="card bg-base-100 shadow-xl rounded-xl">
        <div className="card-body">
          <h3 className="card-title text-base mb-2">Sell shares</h3>
          <p className="text-sm text-base-content">You have no YES or NO shares to sell in this market.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card bg-base-100 shadow-xl rounded-xl">
      <div className="card-body">
        <h3 className="card-title text-base mb-2">Sell shares</h3>
        <p className="text-sm text-base-content mb-4">
          Sell YES for NO tokens or NO for YES tokens. Use Merge to convert YES+NO back to collateral.
        </p>

        {error && (
          <div className="alert alert-error mb-4 text-sm">
            <span>{error}</span>
          </div>
        )}

        <div className="form-control mb-3">
          <label className="label py-1">
            <span className="label-text">Amount to sell (credits of shares)</span>
          </label>
          <input
            type="number"
            placeholder={side === 'yes' ? `Max ${toCredits(maxYes).toFixed(2)}` : `Max ${toCredits(maxNo).toFixed(2)}`}
            className="input input-bordered w-full input-sm"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0"
            step="0.01"
            disabled={loading}
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
              disabled={loading || maxYes === 0}
            >
              YES ({toCredits(maxYes).toFixed(2)})
            </button>
            <button
              className={`btn btn-sm flex-1 ${side === 'no' ? 'btn-error' : 'btn-outline btn-error'}`}
              onClick={() => setSide('no')}
              disabled={loading || maxNo === 0}
            >
              NO ({toCredits(maxNo).toFixed(2)})
            </button>
          </div>
        </div>

        {estimatedCollateralMicrocredits !== null && amount && (
          <p className="text-sm text-base-content mb-3">
            Estimated {side === 'yes' ? 'NO' : 'YES'} tokens out: <strong>{toCredits(estimatedCollateralMicrocredits).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}</strong> credits
          </p>
        )}

        {!userAddress && (
          <div className="alert alert-warning mb-4 text-sm">
            <span>Connect your wallet to sell shares</span>
          </div>
        )}

        <button
          className="btn btn-secondary w-full btn-sm"
          onClick={handleSell}
          disabled={
            loading ||
            !userAddress ||
            !wallet ||
            !isOpen ||
            isPaused ||
            !amount ||
            parseFloat(amount) <= 0 ||
            (side === 'yes' && toMicrocredits(parseFloat(amount)) > maxYes) ||
            (side === 'no' && toMicrocredits(parseFloat(amount)) > maxNo)
          }
        >
          {loading ? (
            <span className="loading loading-spinner loading-sm"></span>
          ) : (
            `Sell ${side.toUpperCase()}`
          )}
        </button>

        {isPaused && <p className="text-warning text-sm mt-3">Market is currently paused</p>}
        {!isOpen && <p className="text-info text-sm mt-3">Market is closed</p>}
      </div>
    </div>
  );
};
