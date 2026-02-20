'use client';

import React, { useState } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { depositGlobalPrivate, withdrawGlobalPrivate } from '@/lib/aleo/rpc';
import { filterUnspentRecords, pickRecordForAmount } from '@/lib/aleo/wallet/records';
import { toMicrocredits, toCredits } from '@/utils/credits';
import { getFeeForFunction } from '@/utils/feeCalculator';

type SwapDirection = 'deposit' | 'withdraw';

interface ManageCashSectionProps {
  /** Current Cash balance (microcredits) from user_collateral mapping */
  cashBalance: number | null;
  onBalanceRefreshed?: () => void;
}

export const ManageCashSection: React.FC<ManageCashSectionProps> = ({
  cashBalance,
  onBalanceRefreshed,
}) => {
  const { publicKey, wallet, address, requestRecords } = useWallet();
  const userAddress = publicKey || address;
  const [direction, setDirection] = useState<SwapDirection>('deposit');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayCash = cashBalance ?? 0;

  const flipDirection = () => {
    setDirection((d) => (d === 'deposit' ? 'withdraw' : 'deposit'));
    setAmount('');
    setError(null);
  };

  const handleSubmit = async () => {
    if (!userAddress || !wallet) {
      setError('Please connect your wallet');
      return;
    }
    const credits = parseFloat(amount);
    if (isNaN(credits) || credits <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    const microcredits = Math.floor(toMicrocredits(credits));
    if (microcredits < 1) {
      setError('Amount too small (min 1 microcredit)');
      return;
    }

    if (direction === 'deposit') {
      setLoading(true);
      setError(null);
      try {
        let creditRecord: unknown = undefined;
        if (requestRecords) {
          const creditRecords = await requestRecords('credits.aleo', true);
          const unspentCredits = filterUnspentRecords(creditRecords ?? []);
          if (unspentCredits.length === 0) throw new Error('No unspent credit records found');
          const feeMicrocredits = getFeeForFunction('deposit_global_private');
          const requiredMicrocredits = microcredits + feeMicrocredits;
          const chosen = pickRecordForAmount(unspentCredits, requiredMicrocredits);
          if (!chosen) {
            throw new Error(
              `No record with sufficient balance. Need at least ${(requiredMicrocredits / 1e6).toFixed(2)} credits (amount + fee) in one record.`
            );
          }
          creditRecord = chosen.record;
        }
        await depositGlobalPrivate(
          wallet,
          userAddress,
          microcredits,
          creditRecord as string | undefined,
          requestRecords ?? undefined
        );
        setAmount('');
        onBalanceRefreshed?.();
      } catch (err: any) {
        setError(err.message || 'Deposit failed');
      } finally {
        setLoading(false);
      }
    } else {
      if (microcredits > displayCash) {
        setError(`Insufficient Cash. You have ${toCredits(displayCash).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} credits.`);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        await withdrawGlobalPrivate(wallet, userAddress, microcredits, requestRecords ?? undefined);
        setAmount('');
        onBalanceRefreshed?.();
      } catch (err: any) {
        setError(err.message || 'Withdraw failed');
      } finally {
        setLoading(false);
      }
    }
  };

  if (!userAddress) return null;

  return (
    <div className="card bg-base-100 shadow-xl rounded-xl border border-base-200 mb-6">
      <div className="card-body">
        <h2 className="card-title text-lg mb-4">Manage Cash</h2>
        <p className="text-sm text-base-content mb-4">
          Move credits between your Aleo wallet and your Cash balance to trade on any market.
        </p>

        {error && (
          <div className="alert alert-error text-sm mb-4">
            <span>{error}</span>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        <div className="flex flex-col gap-0 max-w-md">
          {/* From */}
          <div className="rounded-t-xl bg-base-200/60 border border-base-300 border-b-0 p-4">
            <span className="text-xs uppercase tracking-wide text-base-content">From</span>
            <div className="font-semibold text-base mt-1">
              {direction === 'deposit' ? 'Aleo wallet' : <span className="text-primary">Cash</span>}
            </div>
            {direction === 'withdraw' && (
              <p className="text-xs text-base-content mt-1">Balance: <strong>{toCredits(displayCash).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}</strong> credits</p>
            )}
          </div>

          {/* Arrow: flip direction */}
          <div className="flex justify-center -my-[1px] relative z-10">
            <button
              type="button"
              onClick={flipDirection}
              disabled={loading}
              className="btn btn-circle btn-sm bg-base-100 border-2 border-base-300 hover:border-primary hover:bg-primary/10 transition-colors"
              title={direction === 'deposit' ? 'Switch to Withdraw' : 'Switch to Deposit'}
              aria-label={direction === 'deposit' ? 'Switch to Withdraw' : 'Switch to Deposit'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ transform: direction === 'withdraw' ? 'rotate(180deg)' : undefined }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </button>
          </div>

          {/* To */}
          <div className="rounded-b-xl bg-base-200/60 border border-base-300 border-t-0 p-4 pt-5">
            <span className="text-xs uppercase tracking-wide text-base-content">To</span>
            <div className="font-semibold text-base mt-1">
              {direction === 'deposit' ? <span className="text-primary">Cash</span> : 'Aleo wallet'}
            </div>
            {direction === 'deposit' && (
              <p className="text-xs text-base-content mt-1">Balance: <strong>{toCredits(displayCash).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}</strong> credits</p>
            )}
          </div>

          <div className="mt-4">
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
            <button
              className="btn btn-primary w-full btn-sm mt-3"
              onClick={handleSubmit}
              disabled={loading || !amount || parseFloat(amount) <= 0}
            >
              {loading ? <span className="loading loading-spinner loading-sm" /> : direction === 'deposit' ? 'Deposit to Cash' : 'Withdraw to wallet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
