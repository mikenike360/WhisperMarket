import React, { useState } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { openPositionPrivate, depositGlobalPrivate, withdrawGlobalPrivate } from '@/lib/aleo/rpc';
import { filterUnspentRecords, pickRecordForAmount, extractRecordValue } from '@/lib/aleo/wallet/records';
import { toMicrocredits, toCredits } from '@/utils/credits';
import { getFeeForFunction } from '@/utils/feeCalculator';
import { UserPosition } from '@/types';

interface DepositSectionProps {
  marketId: string;
  userPosition: UserPosition | null;
  userPositionRecord: any;
  isOpen?: boolean;
  globalBalance?: number;
  onBalanceRefreshed?: () => void;
  onTransactionSubmitted?: (txId: string, label?: string) => void;
}

export const DepositSection: React.FC<DepositSectionProps> = ({
  marketId,
  userPosition,
  userPositionRecord,
  isOpen = true,
  globalBalance: globalBalanceProp,
  onBalanceRefreshed,
  onTransactionSubmitted,
}) => {
  const { publicKey, wallet, address, requestRecords } = useWallet();
  const userAddress = publicKey || address;
  const [amount, setAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [openPositionLoading, setOpenPositionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [globalBalance, setGlobalBalance] = useState<number | null>(globalBalanceProp ?? null);

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

      if (requestRecords) {
        const creditRecords = await requestRecords('credits.aleo', true);
        console.log('[Deposit] Raw credit records from wallet (requestRecords("credits.aleo", true)):', creditRecords);
        const unspentCredits = filterUnspentRecords(creditRecords ?? []);
        if (unspentCredits.length === 0) {
          throw new Error('No unspent credit records found');
        }
        const feeMicrocredits = getFeeForFunction('deposit_global_private');
        const requiredMicrocredits = depositMicrocredits + feeMicrocredits;
        const chosen = pickRecordForAmount(unspentCredits, requiredMicrocredits);
        if (!chosen) {
          const values = unspentCredits.map((r) => r.value);
          console.warn('[Deposit] No record with sufficient balance.', {
            needed: depositMicrocredits,
            fee: feeMicrocredits,
            requiredTotal: requiredMicrocredits,
            unspentCount: unspentCredits.length,
            parsedValues: values,
          });
          unspentCredits.forEach((r, i) => {
            console.log(`[Deposit] Unspent record #${i + 1} (parsed value: ${r.value}):`, r.record);
          });
          throw new Error(
            `No credit record with sufficient balance. You need at least ${(requiredMicrocredits / 1e6).toFixed(2)} credits (deposit + fee) in one record.`
          );
        }
        const parsedValue = extractRecordValue(chosen.record);
        console.log('[Deposit] Using credit record (parsed value:', parsedValue, ', needed:', depositMicrocredits, '):', chosen.record);
        creditRecord = chosen.record;
      }

      const txId = await depositGlobalPrivate(
        wallet,
        userAddress,
        depositMicrocredits,
        creditRecord as string | undefined,
        requestRecords ?? undefined
      );

      onTransactionSubmitted?.(txId, 'Deposit');
      setAmount('');
      onBalanceRefreshed?.();
    } catch (err: any) {
      setError(err.message || 'Failed to deposit');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenPosition = async () => {
    if (!userAddress || !wallet) {
      setError('Please connect your wallet');
      return;
    }
    setOpenPositionLoading(true);
    setError(null);
    try {
      const txId = await openPositionPrivate(wallet, userAddress, marketId, isOpen ? 0 : 2, requestRecords ?? undefined);
      onTransactionSubmitted?.(txId, 'Open position');
      onBalanceRefreshed?.();
    } catch (err: any) {
      setError(err.message || 'Failed to open position');
    } finally {
      setOpenPositionLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!userAddress || !wallet) {
      setError('Please connect your wallet');
      return;
    }
    const credits = parseFloat(withdrawAmount);
    if (isNaN(credits) || credits <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    const microcredits = Math.floor(toMicrocredits(credits));
    const balance = globalBalance ?? globalBalanceProp ?? 0;
    if (microcredits > balance) {
      setError(`Insufficient balance. You have ${toCredits(balance).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} credits.`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const txId = await withdrawGlobalPrivate(wallet, userAddress, microcredits, requestRecords ?? undefined);
      onTransactionSubmitted?.(txId, 'Withdraw');
      setWithdrawAmount('');
      onBalanceRefreshed?.();
    } catch (err: any) {
      setError(err.message || 'Failed to withdraw');
    } finally {
      setLoading(false);
    }
  };

  const displayBalance = globalBalance ?? globalBalanceProp ?? (userAddress ? undefined : null);

  return (
    <div className="card bg-base-100 shadow-xl rounded-xl">
      <div className="card-body">
        <h3 className="card-title text-base mb-2">Collateral (global)</h3>
        <p className="text-sm text-base-content mb-2">
          Deposit credits into your global balance to trade in any market. Withdraw anytime.
        </p>
        {displayBalance !== undefined && (
          <p className="text-sm font-medium text-primary mb-2">
            Your balance: {toCredits(displayBalance).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} credits
          </p>
        )}

        {!hasPosition && (
          <div className="alert alert-info mb-4 text-sm">
            <span>You need a position in this market to trade. Open one first (one-time per market).</span>
            <button
              type="button"
              className="btn btn-sm btn-ghost mt-2"
              onClick={handleOpenPosition}
              disabled={openPositionLoading || !userAddress || !wallet}
            >
              {openPositionLoading ? <span className="loading loading-spinner loading-sm" /> : 'Open position'}
            </button>
          </div>
        )}

        {error && (
          <div className="alert alert-error mb-4 text-sm">
            <span>{error}</span>
          </div>
        )}

        <div className="form-control mb-4">
          <label className="label py-1">
            <span className="label-text">Deposit amount (credits)</span>
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

        <button
          className="btn btn-primary w-full btn-sm mb-4"
          onClick={handleDeposit}
          disabled={loading || !userAddress || !wallet}
        >
          {loading ? <span className="loading loading-spinner loading-sm" /> : 'Deposit'}
        </button>

        <div className="divider text-sm">Withdraw</div>
        <div className="form-control mb-2">
          <label className="label py-1">
            <span className="label-text">Amount (credits)</span>
          </label>
          <input
            type="number"
            placeholder="e.g. 5"
            className="input input-bordered w-full input-sm"
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            min="0"
            step="0.01"
            disabled={loading}
          />
        </div>
        <button
          className="btn btn-outline w-full btn-sm"
          onClick={handleWithdraw}
          disabled={loading || !userAddress || !wallet || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
        >
          {loading ? <span className="loading loading-spinner loading-sm" /> : 'Withdraw to wallet'}
        </button>

        {!userAddress && (
          <div className="alert alert-warning mt-4 text-sm">
            <span>Connect your wallet to deposit or withdraw</span>
          </div>
        )}
      </div>
    </div>
  );
};
