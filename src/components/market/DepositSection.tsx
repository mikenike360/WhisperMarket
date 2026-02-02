import React, { useState } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { openPositionPrivate, depositPrivate } from '@/lib/aleo/rpc';
import { isIntentOnlyWallet } from '@/lib/aleo/wallet/adapter';
import { filterUnspentRecords, pickRecordForAmount } from '@/lib/aleo/wallet/records';
import { toMicrocredits } from '@/utils/credits';
import { PREDICTION_MARKET_PROGRAM_ID, UserPosition } from '@/types';

interface DepositSectionProps {
  marketId: string;
  userPosition: UserPosition | null;
  userPositionRecord: any;
  isOpen?: boolean;
  onTransactionSubmitted?: (txId: string, label?: string) => void;
}

export const DepositSection: React.FC<DepositSectionProps> = ({
  marketId,
  userPosition,
  userPositionRecord,
  isOpen = true,
  onTransactionSubmitted,
}) => {
  const { publicKey, wallet, address, requestRecords } = useWallet();
  const userAddress = publicKey || address;
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasPosition = userPosition !== null;

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
      let creditRecord: unknown = undefined;
      let positionRecord: unknown = undefined;

      if (requestRecords && !isIntentOnlyWallet(wallet)) {
        const creditRecords = await requestRecords('credits.aleo');
        const unspentCredits = filterUnspentRecords(creditRecords ?? []);
        if (unspentCredits.length === 0) {
          throw new Error('No unspent credit records found');
        }
        const chosen = pickRecordForAmount(unspentCredits, depositMicrocredits);
        if (!chosen) {
          throw new Error('No credit record with sufficient balance');
        }
        creditRecord = chosen.record;
        if (hasPosition && userPositionRecord) positionRecord = userPositionRecord;
      }

      let txId: string;
      if (hasPosition && positionRecord) {
        txId = await depositPrivate(
          wallet,
          userAddress,
          marketId,
          creditRecord as string | undefined,
          depositMicrocredits,
          positionRecord as string | undefined,
          0,
          requestRecords ?? undefined
        );
      } else {
        txId = await openPositionPrivate(
          wallet,
          userAddress,
          marketId,
          creditRecord as string | undefined,
          depositMicrocredits,
          0,
          requestRecords ?? undefined
        );
      }

      onTransactionSubmitted?.(txId, 'Deposit');
      setAmount('');
    } catch (err: any) {
      setError(err.message || 'Failed to deposit');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card bg-base-100 shadow-xl rounded-xl">
      <div className="card-body">
        <h3 className="card-title text-base mb-2">Add collateral</h3>
        <p className="text-sm text-base-content/70 mb-2">
          Deposit credits into this market to buy YES or NO shares. Your collateral stays in your position until you redeem.
        </p>
        {isOpen && (
          <p className="text-sm text-warning mb-4">
            Use all collateral to buy shares before the market resolves; unspent collateral cannot be withdrawn after resolution.
          </p>
        )}

        {error && (
          <div className="alert alert-error mb-4 text-sm">
            <span>{error}</span>
          </div>
        )}

        <div className="form-control mb-4">
          <label className="label py-1">
            <span className="label-text">Amount (credits)</span>
          </label>
          <input
            type="number"
            placeholder="e.g. 10"
            className="input input-bordered w-full input-sm"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0"
            step="0.01"
            disabled={loading}
          />
        </div>

        {!userAddress && (
          <div className="alert alert-warning mb-4 text-sm">
            <span>Connect your wallet to deposit</span>
          </div>
        )}

        <button
          className="btn btn-primary w-full btn-sm"
          onClick={handleDeposit}
          disabled={loading || !userAddress || !wallet}
        >
          {loading ? (
            <span className="loading loading-spinner loading-sm"></span>
          ) : (
            hasPosition ? 'Deposit more' : 'Deposit'
          )}
        </button>
      </div>
    </div>
  );
};
