/**
 * Admin configuration and utilities
 * Admin address matches the Leo program ADMIN constant
 */
export const ADMIN_ADDRESS = 'aleo1xh0ncflwkfzga983lwujsha729c8nwu7phfn8aw7h3gahhj0ms8qytrxec';

/** Message the admin must sign to access the admin panel */
export const ADMIN_SIGN_IN_MESSAGE_PREFIX = 'Sign in to WhisperMarket Admin.\n\n';

/** Session storage key prefix for admin sign-in; value is timestamp for expiry */
const ADMIN_SIGNED_KEY_PREFIX = 'admin_signed_';

/** How long an admin sign-in is valid (ms) */
const ADMIN_SIGN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if an address is the admin address
 * @param address - The address to check (can be undefined/null)
 * @returns true if the address matches the admin address
 */
export function isAdminAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  return String(address).toLowerCase() === ADMIN_ADDRESS.toLowerCase();
}

/**
 * Build the message the admin must sign (includes timestamp for replay protection)
 */
export function getAdminSignInMessage(): string {
  return `${ADMIN_SIGN_IN_MESSAGE_PREFIX}Timestamp: ${Date.now()}`;
}

/**
 * Check if the current session has a valid admin sign-in for this address
 */
export function hasValidAdminSignIn(address: string | undefined | null): boolean {
  if (!address || typeof window === 'undefined') return false;
  try {
    const key = `${ADMIN_SIGNED_KEY_PREFIX}${address.toLowerCase()}`;
    const stored = sessionStorage.getItem(key);
    if (!stored) return false;
    const timestamp = parseInt(stored, 10);
    if (isNaN(timestamp)) return false;
    return Date.now() - timestamp < ADMIN_SIGN_EXPIRY_MS;
  } catch {
    return false;
  }
}

/**
 * Store that the admin has signed in for this address
 */
export function setAdminSignedIn(address: string | undefined | null): void {
  if (!address || typeof window === 'undefined') return;
  try {
    const key = `${ADMIN_SIGNED_KEY_PREFIX}${address.toLowerCase()}`;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // ignore
  }
}

/**
 * Clear admin sign-in for this address
 */
export function clearAdminSignedIn(address: string | undefined | null): void {
  if (!address || typeof window === 'undefined') return;
  try {
    const key = `${ADMIN_SIGNED_KEY_PREFIX}${address.toLowerCase()}`;
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}
