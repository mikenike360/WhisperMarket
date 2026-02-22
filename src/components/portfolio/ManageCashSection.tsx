'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
  const [aleoWalletBalance, setAleoWalletBalance] = useState<number | null>(null);

  const displayCash = cashBalance ?? 0;

  const fetchAleoWalletBalance = useCallback(async () => {
    if (!requestRecords) {
      setAleoWalletBalance(null);
      return;
    }
    try {
      const creditRecords = await requestRecords('credits.aleo', true);
      const unspent = filterUnspentRecords(creditRecords ?? []);
      const total = unspent.reduce((sum, r) => sum + r.value, 0);
      setAleoWalletBalance(total);
    } catch {
      setAleoWalletBalance(null);
    }
  }, [requestRecords]);

  useEffect(() => {
    if (!userAddress) {
      setAleoWalletBalance(null);
      return;
    }
    fetchAleoWalletBalance();
  }, [userAddress, fetchAleoWalletBalance]);

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
        fetchAleoWalletBalance();
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
        fetchAleoWalletBalance();
      } catch (err: any) {
        setError(err.message || 'Withdraw failed');
      } finally {
        setLoading(false);
      }
    }
  };

  if (!userAddress) return null;

  const balanceStr = toCredits(displayCash).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 });
  const aleoBalanceStr =
    aleoWalletBalance !== null
      ? toCredits(aleoWalletBalance).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })
      : null;

  return (
    <div className="card bg-base-100 shadow-xl rounded-xl border border-base-200 overflow-hidden mb-6">
      <div className="card-body p-5">
        <h2 className="card-title text-lg gap-2 mb-1">
          <span className="text-xl leading-none" aria-hidden>💵</span>
          Manage Cash
        </h2>
        <p className="text-sm text-base-content/80 mb-4">
          Move credits between your Aleo wallet and your Cash balance to trade on any market.
        </p>

        {error && (
          <div className="alert alert-error text-sm mb-4 rounded-lg flex items-center justify-between gap-2">
            <span>{error}</span>
            <button type="button" className="btn btn-ghost btn-xs btn-circle shrink-0" onClick={() => setError(null)} aria-label="Dismiss">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        <div className="flex flex-col gap-0 max-w-md">
          {/* From */}
          <div className="rounded-t-xl bg-base-200/70 border border-base-300 border-b-0 p-4">
            <span className="text-xs font-medium uppercase tracking-wider text-base-content/70">From</span>
            <div className="flex items-center gap-2 mt-2">
              {direction === 'deposit' ? (
                <span className="font-semibold text-base">Aleo wallet</span>
              ) : (
                <span className="font-semibold text-primary">Cash</span>
              )}
            </div>
            {direction === 'deposit' && aleoBalanceStr !== null && (
              <p className="text-sm text-base-content mt-2">
                <span className="font-medium">Balance:</span>{' '}
                <span className="font-semibold text-lg tabular-nums">{aleoBalanceStr}</span>{' '}
                <span className="text-base-content/80">credits</span>
              </p>
            )}
            {direction === 'withdraw' && (
              <p className="text-sm text-base-content mt-2">
                <span className="font-medium">Balance:</span>{' '}
                <span className="font-semibold text-lg tabular-nums text-primary">{balanceStr}</span>{' '}
                <span className="text-base-content/80">credits</span>
              </p>
            )}
          </div>

          {/* Double arrow: flip direction */}
          <div className="flex justify-center -my-[1px] relative z-10">
            <button
              type="button"
              onClick={flipDirection}
              disabled={loading}
              className="btn btn-circle btn-sm bg-base-100 border-2 border-base-300 shadow-sm hover:border-primary hover:bg-primary/10 hover:shadow transition-all"
              title={direction === 'deposit' ? 'Switch to Withdraw' : 'Switch to Deposit'}
              aria-label={direction === 'deposit' ? 'Switch to Withdraw' : 'Switch to Deposit'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5m0 0l-4 4m4-4l4 4" />
                <path d="M12 5v14m0 0l-4-4m4 4l4-4" />
              </svg>
            </button>
          </div>

          {/* To */}
          <div className="rounded-b-xl bg-base-200/70 border border-base-300 border-t-0 p-4 pt-5">
            <span className="text-xs font-medium uppercase tracking-wider text-base-content/70">To</span>
            <div className="flex items-center gap-2 mt-2">
              {direction === 'deposit' ? (
                <span className="font-semibold text-primary">Cash</span>
              ) : (
                <span className="font-semibold text-base">Aleo wallet</span>
              )}
            </div>
            {direction === 'deposit' && (
              <p className="text-sm text-base-content mt-2">
                <span className="font-medium">Balance:</span>{' '}
                <span className="font-semibold text-lg tabular-nums text-primary">{balanceStr}</span>{' '}
                <span className="text-base-content/80">credits</span>
              </p>
            )}
            {direction === 'withdraw' && aleoBalanceStr !== null && (
              <p className="text-sm text-base-content mt-2">
                <span className="font-medium">Balance:</span>{' '}
                <span className="font-semibold text-lg tabular-nums">{aleoBalanceStr}</span>{' '}
                <span className="text-base-content/80">credits</span>
              </p>
            )}
          </div>

          <div className="mt-5">
            <label className="label py-0 px-0 mb-1.5">
              <span className="label-text font-medium text-sm">Amount (credits)</span>
            </label>
            <input
              type="number"
              placeholder="e.g. 10"
              className="input input-bordered w-full input-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="0"
              step="0.01"
              disabled={loading}
            />
            <button
              className="btn btn-primary w-full btn-sm mt-3 rounded-lg font-medium"
              onClick={handleSubmit}
              disabled={loading || !amount || parseFloat(amount) <= 0}
            >
              {loading ? (
                <span className="loading loading-spinner loading-sm" />
              ) : direction === 'deposit' ? (
                <>Deposit to Cash</>
              ) : (
                <>Withdraw to wallet</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
