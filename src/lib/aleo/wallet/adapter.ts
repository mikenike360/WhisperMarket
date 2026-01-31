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

/**
 * Check if the connected wallet supports requestRecords (e.g. Leo).
 * When false, use intent path: build transaction with recordIndices and let wallet (e.g. Shield) fill record slots.
 */
export function hasRequestRecords(wallet: unknown): boolean {
  const adapter = findWalletAdapter(wallet);
  return adapter !== null && typeof adapter.requestRecords === 'function';
}

/** Wallet names that handle records automatically; app should always use intent path (placeholders + recordIndices). */
const INTENT_ONLY_WALLET_NAMES = ['Shield Wallet'] as const;

/**
 * True when the connected wallet is intent-only (e.g. Shield): it handles record selection internally.
 * For these wallets we always use the intent path and never run record fetch/balance/selection in the app.
 */
export function isIntentOnlyWallet(wallet: unknown): boolean {
  const adapter = findWalletAdapter(wallet);
  if (!adapter) return false;
  const name = (adapter as Record<string, unknown>)?.name as string | undefined;
  return name != null && INTENT_ONLY_WALLET_NAMES.includes(name as (typeof INTENT_ONLY_WALLET_NAMES)[number]);
}
