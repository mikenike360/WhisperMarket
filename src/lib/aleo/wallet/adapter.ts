/**
 * Wallet adapter discovery and minimal type for Aleo wallet adapters.
 * Handles nested wallet structures (useWallet hook, Shield, Leo, etc.).
 */

export interface AleoWalletAdapter {
  executeTransaction(
    options: { program: string; function: string; inputs: unknown[]; fee?: number; privateFee?: boolean; recordIndices?: number[] }
  ): Promise<{ transactionId: string } & Record<string, unknown>>;
  requestRecords?(programId: string, decrypt?: boolean): Promise<unknown[]>;
}

/**
 * Find the wallet adapter that supports executeTransaction (and optionally requestRecords).
 * Handles nested wallet structures for different wallet adapter types.
 */
export function findWalletAdapter(wallet: unknown): AleoWalletAdapter | null {
  if (!wallet || typeof wallet !== 'object') {
    return null;
  }

  const w = wallet as Record<string, unknown>;

  if (w.adapter) {
    const adapter = w.adapter as Record<string, unknown>;
    if (typeof adapter.executeTransaction === 'function') {
      return adapter as unknown as AleoWalletAdapter;
    }
    if (typeof adapter.requestRecords === 'function') {
      return adapter as unknown as AleoWalletAdapter;
    }
    const inner = adapter.wallet as Record<string, unknown> | undefined;
    if (inner && (typeof inner.executeTransaction === 'function' || typeof inner.requestRecords === 'function')) {
      return inner as unknown as AleoWalletAdapter;
    }
  }

  if (w.wallet) {
    const inner = w.wallet as Record<string, unknown>;
    if (typeof inner.executeTransaction === 'function' || typeof inner.requestRecords === 'function') {
      return inner as unknown as AleoWalletAdapter;
    }
    const innerAdapter = inner.adapter as Record<string, unknown> | undefined;
    if (innerAdapter && (typeof innerAdapter.executeTransaction === 'function' || typeof innerAdapter.requestRecords === 'function')) {
      return innerAdapter as unknown as AleoWalletAdapter;
    }
  }

  if (typeof (w as { executeTransaction?: unknown; requestRecords?: unknown }).executeTransaction === 'function' ||
      typeof (w as { executeTransaction?: unknown; requestRecords?: unknown }).requestRecords === 'function') {
    return w as unknown as AleoWalletAdapter;
  }

  return null;
}
