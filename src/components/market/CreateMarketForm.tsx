import React, { useState } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { initMarket, getTotalMarketsCount, getMarketIdAtIndex, fetchMarketCreator, clearMarketRegistryCache, clearMarketStateCache } from '@/lib/aleo/rpc';
import { isIntentOnlyWallet } from '@/lib/aleo/wallet/adapter';
import { filterUnspentRecords } from '@/lib/aleo/wallet/records';
import { getFeeForFunction } from '@/utils/feeCalculator';
import { createMarketMetadata, getMarketMetadata, savePendingMarketMetadata, finalizePendingMarketMetadata } from '@/services/marketMetadata';

// Constants from the Leo program
// Note: MIN_LIQUIDITY in Leo is 1000 microcredits = 0.001 credits
// But we'll show it to users in credits, so MIN_LIQUIDITY_CREDITS = 0.001
const MIN_LIQUIDITY_MICROCREDITS = 1000; // Minimum liquidity in microcredits (from Leo program)
const MIN_LIQUIDITY_CREDITS = MIN_LIQUIDITY_MICROCREDITS / 1_000_000; // 0.001 credits
const MAX_FEE_BPS = 1000; // Maximum fee in basis points (10%)
const MAX_COLLATERAL = 1000000000000; // Maximum collateral in microcredits (1 trillion microcredits = 1M credits)
const MAX_COLLATERAL_CREDITS = MAX_COLLATERAL / 1_000_000; // 1,000,000 credits
const CREDITS_TO_MICROCREDITS = 1_000_000; // 1 credit = 1,000,000 microcredits

interface CreateMarketFormProps {
  onSuccess?: (txId?: string) => void;
  onCancel?: () => void;
}

/**
 * Simple metadata hash generation - creates a field value from title and description
 * Includes timestamp to ensure uniqueness and prevent market ID collisions
 */
function generateMetadataHash(title: string, description: string): string {
  // Include timestamp to ensure uniqueness even if title/description are the same
  // This helps prevent market ID collisions from failed transactions
  const timestamp = Date.now();
  
  // Combine title, description, and timestamp
  const combined = `${title}:${description}:${timestamp}`;
  
  // Simple hash: convert string to a number and use as field
  // This is a basic implementation - in production, use proper cryptographic hashing
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  // Use absolute value and return as string (rpc.ts will add the 'field' suffix)
  // Note: This is a simplified approach. In production, use proper field hashing
  return `${Math.abs(hash)}`;
}

/**
 * Generate a random salt for market_id = hash(creator || metadata_hash || salt).
 * Uses crypto.getRandomValues; rpc.ts formats as field.
 */
function generateSalt(): string {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  let n = BigInt(0);
  for (let i = 0; i < 8; i++) n = (n << BigInt(8)) | BigInt(arr[i]);
  return n.toString();
}

export const CreateMarketForm: React.FC<CreateMarketFormProps> = ({
  onSuccess,
  onCancel,
}) => {
  const walletHook = useWallet();
  const { publicKey, wallet, address, connected, requestRecords } = walletHook;
  const [initialLiquidity, setInitialLiquidity] = useState<string>('');
  const [bondAmount, setBondAmount] = useState<string>('1'); // Default 1 credit, selectable 1-10
  const [feeBps, setFeeBps] = useState<string>('30'); // Default 0.3%
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [txId, setTxId] = useState<string | null>(null);

  const validateInputs = (): string | null => {
    const liquidity = parseFloat(initialLiquidity);
    const bond = parseFloat(bondAmount);
    const fee = parseFloat(feeBps);

    if (isNaN(liquidity) || liquidity < MIN_LIQUIDITY_CREDITS) {
      return `Initial liquidity must be at least ${MIN_LIQUIDITY_CREDITS} credits (${MIN_LIQUIDITY_MICROCREDITS} microcredits)`;
    }

    if (isNaN(bond) || bond < 1 || bond > 10) {
      return `Bond amount must be between 1 and 10 credits`;
    }

    if (isNaN(fee) || fee < 0 || fee > MAX_FEE_BPS) {
      return `Fee must be between 0 and ${MAX_FEE_BPS} basis points (0-10%)`;
    }

    if (liquidity > MAX_COLLATERAL_CREDITS) {
      return `Initial liquidity cannot exceed ${MAX_COLLATERAL_CREDITS.toLocaleString()} credits`;
    }

    // Check overflow: ensure bond + liquidity doesn't exceed MAX_COLLATERAL
    if (bond > MAX_COLLATERAL_CREDITS - liquidity) {
      return `Total (bond + liquidity) cannot exceed ${MAX_COLLATERAL_CREDITS.toLocaleString()} credits`;
    }

    return null;
  };

  const handleSubmit = async () => {
    // Check if wallet is connected - some wallets use 'address' instead of 'publicKey'
    const isConnected = Boolean(publicKey || address || (connected && wallet));
    
    if (!isConnected || !wallet) {
      setError('Please connect your wallet');
      return;
    }
    
    // Use address if publicKey is not available
    const userPublicKey = publicKey || address;
    if (!userPublicKey) {
      setError('Unable to get wallet address');
      return;
    }

    // Validate inputs
    const validationError = validateInputs();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const liquidity = parseFloat(initialLiquidity);
      const bond = parseFloat(bondAmount);
      const fee = parseFloat(feeBps);

      // Generate metadata hash and salt for market_id = hash(creator || metadata_hash || salt)
      const metadataHash = generateMetadataHash(title, description);
      const salt = generateSalt();
      
      const liquidityMicrocredits = liquidity * CREDITS_TO_MICROCREDITS;
      const bondMicrocredits = bond * CREDITS_TO_MICROCREDITS;

      // When requestRecords is available and not intent-only (Leo), fetch records and check balance; intent-only (Shield) lets wallet select record
      if (requestRecords && connected && !isIntentOnlyWallet(wallet)) {
        const estimatedFee = getFeeForFunction('init') / CREDITS_TO_MICROCREDITS;
        const totalNeeded = bond + liquidity + estimatedFee;
        const allRecords = await requestRecords('credits.aleo', false);
        if (!allRecords || allRecords.length === 0) {
          throw new Error('No credit records found in wallet');
        }
        const unspentRecords = filterUnspentRecords(allRecords);
        if (unspentRecords.length === 0) {
          throw new Error('No unspent credit records available in wallet');
        }
        const totalNeededMicrocredits = totalNeeded * CREDITS_TO_MICROCREDITS;
        const totalBalance = unspentRecords.reduce((sum, r) => sum + r.value, 0);
        if (totalBalance > 0 && totalBalance < totalNeededMicrocredits) {
          throw new Error(
            `Insufficient balance. Need ${totalNeeded.toFixed(6)} credits (${totalNeededMicrocredits} microcredits), ` +
            `but only have ${(totalBalance / CREDITS_TO_MICROCREDITS).toFixed(6)} credits total.`
          );
        }
      }

      const transactionId = await initMarket(
        wallet,
        userPublicKey,
        liquidityMicrocredits,
        bondMicrocredits,
        fee,
        metadataHash,
        salt,
        undefined,
        requestRecords
      );

      setTxId(transactionId);
      setSuccess(true);
      onSuccess?.(transactionId);

      // Save metadata to Supabase immediately using transaction_id
      // This ensures metadata is saved right away, even before market_id is known
      if (transactionId) {
        await savePendingMarketMetadata({
          transaction_id: transactionId,
          title: title || `Market ${transactionId.slice(0, 8)}...`,
          description: description || 'Prediction market',
          category: 'General',
          creator_address: String(userPublicKey),
          metadata_hash: metadataHash,
        });
      }

      // Poll total_markets mapping; when count increases, new market is at (count - 1), save metadata
      if (transactionId) {
        const pollAndSaveMetadata = async () => {
          const POLL_INTERVAL_MS = 4000;
          const MAX_POLLS = 60; // ~4 minutes max
          
          try {
            const initialCount = await getTotalMarketsCount();
            
            for (let poll = 0; poll < MAX_POLLS; poll++) {
              await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
              const newCount = await getTotalMarketsCount();
              
              if (newCount > initialCount) {
                const newIndex = newCount - 1;
                const marketId = await getMarketIdAtIndex(newIndex);
                
                if (marketId) {
                  clearMarketRegistryCache();
                  clearMarketStateCache();
                  
                  let creator: string | null = null;
                  try {
                    creator = await fetchMarketCreator(marketId);
                  } catch {
                    // Ignore; we'll use userPublicKey
                  }
                  
                  // Finalize pending metadata now that we have the market_id
                  await finalizePendingMarketMetadata(transactionId, marketId);
                  
                  // Also ensure it's in the main table (in case finalize failed)
                  const existing = await getMarketMetadata(marketId);
                  if (!existing) {
                    await createMarketMetadata({
                      market_id: marketId,
                      title: title || `Market ${marketId.slice(0, 8)}...`,
                      description: description || 'Prediction market',
                      category: 'General',
                      creator_address: creator ?? String(userPublicKey),
                      transaction_id: transactionId,
                      metadata_hash: metadataHash,
                    });
                  }
                  
                  return;
                }
              }
            }
            
          } catch {
            // Polling/save failed; market will appear with defaults on refresh
          }
        };
        
        setTimeout(() => pollAndSaveMetadata(), 3000);
      }

      // Call onSuccess to close modal, but don't auto-refresh markets
      if (onSuccess) {
        onSuccess();
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to create market. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    const explorerUrl = txId ? `https://testnet.explorer.provable.com/transaction/${txId}` : null;
    
    return (
      <div className="card bg-base-100 shadow-xl rounded-xl">
        <div className="card-body">
          <div className="alert alert-success">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="stroke-current shrink-0 h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div className="w-full">
              <h3 className="font-bold text-lg mb-2">✅ Market Creation Submitted!</h3>
              {txId && (
                <div className="space-y-2">
                  <div className="bg-base-200 p-3 rounded-lg">
                    <div className="text-xs font-semibold text-base-content/70 mb-1">Transaction ID:</div>
                    <div className="font-mono text-sm break-all">{txId}</div>
                  </div>
                  {explorerUrl && (
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-sm btn-outline btn-primary w-full"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      View on Explorer
                    </a>
                  )}
                  <div className="text-xs text-base-content/60 mt-2 space-y-1">
                    <div>⏳ The market will appear in the list once the transaction is finalized and indexed.</div>
                    <div className="text-info mt-2 p-2 bg-info/10 rounded">
                      <div className="font-semibold mb-1">💡 Next Steps:</div>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>Wait a few seconds for the transaction to be indexed</li>
                        <li>Click the refresh button (↻) on the markets page to reload</li>
                        <li>The market will auto-refresh every 30 seconds</li>
                        <li>If it doesn't appear after 1-2 minutes, check the explorer link above</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          {onCancel && (
            <button className="btn btn-primary w-full mt-4" onClick={onCancel}>
              Close
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card bg-base-100 shadow-xl rounded-xl">
      <div className="card-body">
        <h2 className="card-title mb-4">Create New Market</h2>

        {error && (
          <div className="alert alert-error mb-4">
            <span>{error}</span>
          </div>
        )}

        <div className="form-control mb-4">
          <label className="label">
            <span className="label-text">Initial Liquidity (credits)</span>
            <span className="label-text-alt">Min: {MIN_LIQUIDITY_CREDITS}</span>
          </label>
          <input
            type="number"
            placeholder={`Minimum ${MIN_LIQUIDITY_CREDITS} credits`}
            className="input input-bordered w-full"
            value={initialLiquidity}
            onChange={(e) => setInitialLiquidity(e.target.value)}
            min={MIN_LIQUIDITY_CREDITS}
            step="0.001"
            disabled={loading}
          />
          <label className="label">
            <span className="label-text-alt">
              Initial liquidity for the AMM pool (50/50 split between YES and NO)
            </span>
          </label>
        </div>

        <div className="form-control mb-4">
          <label className="label">
            <span className="label-text">Bond Amount (credits)</span>
            <span className="label-text-alt">Select: 1-10 credits</span>
          </label>
          <select
            className="select select-bordered w-full"
            value={bondAmount}
            onChange={(e) => setBondAmount(e.target.value)}
            disabled={loading}
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map((value) => (
              <option key={value} value={value.toString()}>
                {value} credit{value !== 1 ? 's' : ''}
              </option>
            ))}
          </select>
          <label className="label">
            <span className="label-text-alt">
              Non-redeemable bond paid when creating the market
            </span>
          </label>
        </div>

        <div className="form-control mb-4">
          <label className="label">
            <span className="label-text">Fee (basis points)</span>
            <span className="label-text-alt">Max: {MAX_FEE_BPS} (10%)</span>
          </label>
          <input
            type="number"
            placeholder="30 = 0.3%"
            className="input input-bordered w-full"
            value={feeBps}
            onChange={(e) => setFeeBps(e.target.value)}
            min="0"
            max={MAX_FEE_BPS}
            step="1"
            disabled={loading}
          />
          <label className="label">
            <span className="label-text-alt">
              Trading fee in basis points (e.g., 30 = 0.3%, 100 = 1%)
            </span>
          </label>
        </div>

        <div className="form-control mb-4">
          <label className="label">
            <span className="label-text">Market Title (optional)</span>
          </label>
          <input
            type="text"
            placeholder="e.g., Will Bitcoin reach $100k?"
            className="input input-bordered w-full"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="form-control mb-4">
          <label className="label">
            <span className="label-text">Market Description (optional)</span>
          </label>
          <textarea
            className="textarea textarea-bordered w-full"
            placeholder="Describe the prediction market..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={loading}
            rows={3}
          />
        </div>

        <div className="card-actions justify-end mt-4">
          {onCancel && (
            <button
              className="btn btn-ghost"
              onClick={onCancel}
              disabled={loading}
            >
              Cancel
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={loading || !(publicKey || address || (connected && wallet)) || !wallet}
          >
            {loading ? (
              <>
                <span className="loading loading-spinner"></span>
                Creating...
              </>
            ) : (
              'Create Market'
            )}
          </button>
        </div>

        {!(publicKey || address || (connected && wallet)) && (
          <div className="alert alert-warning mt-4">
            <span>Please connect your wallet to create a market</span>
          </div>
        )}
      </div>
    </div>
  );
};
