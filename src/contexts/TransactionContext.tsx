'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'whisper_tx_tracker';
const MAX_TRANSACTIONS = 30;

export interface TransactionEntry {
  id: string;
  label: string;
  type?: string;
  createdAt: number;
}

interface TransactionContextValue {
  transactions: TransactionEntry[];
  isMinimized: boolean;
  addTransaction: (entry: { id: string; label: string; type?: string }) => void;
  removeTransaction: (id: string) => void;
  clearTransactions: () => void;
  setMinimized: (value: boolean) => void;
}

const TransactionContext = createContext<TransactionContextValue | null>(null);

function loadFromStorage(): { transactions: TransactionEntry[]; isMinimized: boolean } {
  if (typeof window === 'undefined') return { transactions: [], isMinimized: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { transactions: [], isMinimized: false };
    const parsed = JSON.parse(raw) as { transactions?: TransactionEntry[]; isMinimized?: boolean };
    return {
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions.slice(0, MAX_TRANSACTIONS) : [],
      isMinimized: Boolean(parsed.isMinimized),
    };
  } catch {
    return { transactions: [], isMinimized: false };
  }
}

function saveToStorage(transactions: TransactionEntry[], isMinimized: boolean) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ transactions, isMinimized }));
  } catch {
    // ignore
  }
}

export function TransactionProvider({ children }: { children: React.ReactNode }) {
  const [transactions, setTransactions] = useState<TransactionEntry[]>([]);
  const [isMinimized, setIsMinimizedState] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const { transactions: stored, isMinimized: storedMin } = loadFromStorage();
    setTransactions(stored);
    setIsMinimizedState(storedMin);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveToStorage(transactions, isMinimized);
  }, [hydrated, transactions, isMinimized]);

  const addTransaction = useCallback((entry: { id: string; label: string; type?: string }) => {
    const newEntry: TransactionEntry = {
      id: entry.id,
      label: entry.label,
      type: entry.type,
      createdAt: Date.now(),
    };
    setTransactions((prev) => {
      const deduped = prev.filter((t) => t.id !== entry.id);
      return [newEntry, ...deduped].slice(0, MAX_TRANSACTIONS);
    });
  }, []);

  const removeTransaction = useCallback((id: string) => {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearTransactions = useCallback(() => {
    setTransactions([]);
  }, []);

  const setMinimized = useCallback((value: boolean) => {
    setIsMinimizedState(value);
  }, []);

  const value = useMemo<TransactionContextValue>(
    () => ({
      transactions,
      isMinimized,
      addTransaction,
      removeTransaction,
      clearTransactions,
      setMinimized,
    }),
    [transactions, isMinimized, addTransaction, removeTransaction, clearTransactions, setMinimized]
  );

  return <TransactionContext.Provider value={value}>{children}</TransactionContext.Provider>;
}

export function useTransaction(): TransactionContextValue {
  const ctx = useContext(TransactionContext);
  if (!ctx) throw new Error('useTransaction must be used within TransactionProvider');
  return ctx;
}
