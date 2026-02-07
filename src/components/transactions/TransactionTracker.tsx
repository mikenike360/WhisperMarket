'use client';

import React, { useState, useEffect } from 'react';
import { useTransaction } from '@/contexts/TransactionContext';
import { client } from '@/lib/aleo/rpc/client';

/** Provable Explorer — used for transaction links; Provable API used for mapping reads. */
const PROVABLE_EXPLORER_TRANSACTION = 'https://testnet.explorer.provable.com/transaction';

function truncateId(id: string, head = 8, tail = 4): string {
  if (!id || id.length <= head + tail) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

interface TransactionStatus {
  id: string;
  isFinalized: boolean;
  isChecking: boolean;
}

export function TransactionTracker() {
  const { transactions, isMinimized, setMinimized, removeTransaction, clearTransactions } = useTransaction();
  const [copyId, setCopyId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Map<string, TransactionStatus>>(new Map());

  const handleCopy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopyId(id);
      setTimeout(() => setCopyId(null), 1500);
    } catch {
      // ignore
    }
  };

  // Check transaction finalization status
  useEffect(() => {
    const checkTransactions = async () => {
      for (const tx of transactions) {
        setStatuses((prev) => {
          const currentStatus = prev.get(tx.id);
          // Skip if already finalized or currently checking
          if (currentStatus?.isFinalized || currentStatus?.isChecking) {
            return prev;
          }
          // Mark as checking
          const newMap = new Map(prev);
          newMap.set(tx.id, { id: tx.id, isFinalized: false, isChecking: true });
          return newMap;
        });

        // Check if finalized (non-blocking check)
        try {
          const status = await client.request('getTransactionStatus', { id: tx.id });
          const isFinalized = status === 'finalized';
          setStatuses((prev) => {
            const newMap = new Map(prev);
            newMap.set(tx.id, { id: tx.id, isFinalized, isChecking: false });
            return newMap;
          });
        } catch {
          // Transaction not yet on chain or not finalized, mark as not checking (will retry)
          setStatuses((prev) => {
            const newMap = new Map(prev);
            const existing = prev.get(tx.id);
            if (existing) {
              newMap.set(tx.id, { ...existing, isChecking: false });
            }
            return newMap;
          });
        }
      }
    };

    if (transactions.length > 0) {
      checkTransactions();
      // Check every 5 seconds for pending transactions
      const interval = setInterval(checkTransactions, 5000);
      return () => clearInterval(interval);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions]);

  if (transactions.length === 0) return null;

  if (isMinimized) {
    return (
      <div
        className="fixed bottom-6 right-6 z-50 flex items-center justify-center rounded-full bg-base-200 shadow-lg cursor-pointer hover:bg-base-300 transition-colors"
        style={{ minWidth: 48, minHeight: 48 }}
        onClick={() => setMinimized(false)}
        title="Open transaction list"
        role="button"
        aria-label="Open transaction list"
      >
        <span className="badge badge-primary badge-lg">{transactions.length}</span>
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-80 max-w-[calc(100vw-3rem)] rounded-lg bg-base-200 shadow-xl border border-base-300 flex flex-col max-h-[70vh]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-base-300 rounded-t-lg bg-base-300">
        <span className="font-semibold text-sm">Transactions</span>
        <div className="flex items-center gap-1">
          {transactions.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={clearTransactions}
              title="Clear all"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-square"
            onClick={() => setMinimized(true)}
            title="Minimize"
            aria-label="Minimize"
          >
            −
          </button>
        </div>
      </div>
      <ul className="overflow-y-auto flex-1 p-2 space-y-2">
        {transactions.map((tx) => {
          const status = statuses.get(tx.id);
          const isFinalized = status?.isFinalized ?? false;
          const isChecking = status?.isChecking ?? false;

          return (
            <li
              key={tx.id}
              className="flex flex-col gap-1 p-2 rounded-md bg-base-100 border border-base-300 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium text-base-content">{tx.label}</div>
                {isChecking && (
                  <span className="loading loading-spinner loading-xs text-primary" title="Waiting for finalization..." />
                )}
                {isFinalized && !isChecking && (
                  <span className="badge badge-success badge-xs" title="Transaction finalized">
                    ✓
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-xs text-base-content truncate max-w-[140px]" title={tx.id}>
                  {truncateId(tx.id)}
                </code>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => handleCopy(tx.id)}
                  title="Copy ID"
                >
                  {copyId === tx.id ? 'Copied' : 'Copy'}
                </button>
                <a
                  href={`${PROVABLE_EXPLORER_TRANSACTION}/${tx.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link link-primary link-hover text-xs"
                >
                  Explorer
                </a>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs text-error"
                  onClick={() => removeTransaction(tx.id)}
                  title="Dismiss"
                >
                  Dismiss
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
