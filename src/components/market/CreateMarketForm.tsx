import React, { useState } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { initMarket } from '@/components/aleo/rpc';
import { getFeeForFunction } from '@/utils/feeCalculator';

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
  onSuccess?: () => void;
  onCancel?: () => void;
}

/**
 * Simple metadata hash generation - creates a field value from title and description
 * For MVP, we'll use a simple hash. In production, this could be more sophisticated.
 */
function generateMetadataHash(title: string, description: string): string {
  // Simple approach: combine title and description, hash to a field value
  // For now, we'll use a placeholder that can be improved later
  // Using 0field as placeholder - in production, you'd want to hash the actual metadata
  if (!title && !description) {
    return '0field';
  }
  
  // Simple hash: convert string to a number and use as field
  // This is a basic implementation - in production, use proper cryptographic hashing
  const combined = `${title}:${description}`;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  // Use absolute value and convert to field format
  // Note: This is a simplified approach. In production, use proper field hashing
  return `${Math.abs(hash)}field`;
}

export const CreateMarketForm: React.FC<CreateMarketFormProps> = ({
  onSuccess,
  onCancel,
}) => {
  const walletHook = useWallet();
  const { publicKey, wallet, address, connected } = walletHook;
  const [initialLiquidity, setInitialLiquidity] = useState<string>('');
  // Bond amount is hardcoded to 1 credit
  const BOND_AMOUNT_CREDITS = 1;
  const [feeBps, setFeeBps] = useState<string>('30'); // Default 0.3%
  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [txId, setTxId] = useState<string | null>(null);

  const validateInputs = (): string | null => {
    const liquidity = parseFloat(initialLiquidity);
    const bond = BOND_AMOUNT_CREDITS; // Hardcoded to 1 credit
    const fee = parseFloat(feeBps);

    if (isNaN(liquidity) || liquidity < MIN_LIQUIDITY_CREDITS) {
      return `Initial liquidity must be at least ${MIN_LIQUIDITY_CREDITS} credits (${MIN_LIQUIDITY_MICROCREDITS} microcredits)`;
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
      const bond = BOND_AMOUNT_CREDITS; // Hardcoded to 1 credit
      const fee = parseFloat(feeBps);

      // Generate metadata hash
      const metadataHash = generateMetadataHash(title, description);
      
      // Calculate total needed for balance check (bond + liquidity + estimated fee)
      const estimatedFee = getFeeForFunction('init') / CREDITS_TO_MICROCREDITS; // Convert to credits
      const totalNeeded = bond + liquidity + estimatedFee;
      
      // Fetch credit records to validate balance and pass to executeTransition
      // executeTransition RPC will handle wallet interaction and record decryption automatically
      let creditRecord: any = null;
      
      // Determine which wallet object has requestRecords and call it directly to preserve context
      let walletWithRecords: any = null;
      
      if (wallet) {
        // Try direct access first (works for Leo wallet)
        if (typeof wallet.requestRecords === 'function') {
          walletWithRecords = wallet;
        }
        // Try nested access (some wallet adapters wrap the actual adapter)
        else if (wallet.wallet && typeof wallet.wallet.requestRecords === 'function') {
          walletWithRecords = wallet.wallet;
        }
        else if (wallet.adapter && typeof wallet.adapter.requestRecords === 'function') {
          walletWithRecords = wallet.adapter;
        }
      }
      
      if (walletWithRecords) {
        try {
          // Call requestRecords directly on the wallet object to preserve 'this' context
          // This should automatically prompt for decryption with DecryptPermission.UponRequest
          const allRecords = await walletWithRecords.requestRecords('credits.aleo');
          console.log('All records fetched:', JSON.stringify(allRecords, null, 2));
          console.log('First record structure:', allRecords?.[0]);
          
          if (allRecords && allRecords.length > 0) {
            // Extract value from microcredits string - handles different formats
            const extractValue = (record: any): number => {
              // Try different record structures
              // Records might be: { data: { microcredits: "..." }, spent: false }
              // Or: { microcredits: "...", spent: false }
              // Or: string (encrypted record)
              // Or: { data: "..." } where data is a string
              
              let microcreditsStr = '';
              
              // If record is a string, it might be an encrypted record
              if (typeof record === 'string') {
                console.warn('Record is a string (possibly encrypted):', record.substring(0, 100));
                return 0; // Can't extract value from encrypted string
              }
              
              // Try nested data structure
              if (record.data) {
                if (typeof record.data === 'object' && record.data.microcredits) {
                  microcreditsStr = record.data.microcredits;
                } else if (typeof record.data === 'string') {
                  // Data might be a string representation
                  const match = record.data.match(/microcredits["\s:]+([0-9]+)/);
                  if (match) {
                    microcreditsStr = match[1] + 'u64';
                  }
                }
              }
              
              // Try direct microcredits property
              if (!microcreditsStr && record.microcredits) {
                microcreditsStr = record.microcredits;
              }
              
              if (!microcreditsStr) {
                console.warn('Record missing microcredits:', record);
                return 0;
              }
              
              // Extract numeric value (handles formats like "5000000u64.private", "5000000u64", etc.)
              const match = String(microcreditsStr).match(/^(\d+)/);
              return match ? parseInt(match[1], 10) : 0;
            };

            // Filter unspent records - handle different record structures
            const unspentRecords = allRecords.filter((record: any) => {
              // Skip if record is a string (encrypted, needs decryption)
              if (typeof record === 'string') {
                console.warn('Skipping encrypted string record');
                return false;
              }
              
              // Check if record is spent
              if (record.spent === true) {
                return false;
              }
              
              // Check if record has microcredits (try different structures)
              const hasMicrocredits = 
                (record.data && typeof record.data === 'object' && record.data.microcredits) || 
                (record.data && typeof record.data === 'string' && record.data.includes('microcredits')) ||
                record.microcredits;
              
              if (!hasMicrocredits) {
                console.warn('Record missing microcredits field. Record:', record);
                return false;
              }
              
              // Extract value to ensure it's valid
              const value = extractValue(record);
              if (value <= 0) {
                console.warn('Record has invalid or zero value:', record);
              }
              return value > 0;
            });

            console.log(`Found ${unspentRecords.length} unspent records out of ${allRecords.length} total records`);
            if (unspentRecords.length > 0) {
              console.log('Sample unspent record:', unspentRecords[0]);
            }

            if (unspentRecords.length > 0) {
              const totalNeededMicrocredits = totalNeeded * CREDITS_TO_MICROCREDITS;
              
              // Find a record that can cover the total amount needed (for balance validation)
              creditRecord = unspentRecords.find((record: any) => {
                const recordValue = extractValue(record);
                return recordValue >= totalNeededMicrocredits;
              });

              if (!creditRecord) {
                const maxAvailable = Math.max(
                  ...unspentRecords.map((r: any) => extractValue(r))
                );
                throw new Error(
                  `Insufficient balance. Need ${totalNeeded.toFixed(6)} credits (${totalNeededMicrocredits} microcredits), ` +
                  `but largest available record is ${(maxAvailable / CREDITS_TO_MICROCREDITS).toFixed(6)} credits`
                );
              }
            } else {
              // Log all records for debugging
              console.error('No unspent records found. All records:', allRecords);
              throw new Error('No unspent credit records available in wallet');
            }
          } else {
            throw new Error('No credit records found in wallet');
          }
        } catch (err: any) {
          // If requestRecords fails or returns no records, provide helpful error message
          if (err.message.includes('Insufficient balance') || err.message.includes('No')) {
            throw err; // Re-throw balance/availability errors
          }
          // For other errors, log and throw
          console.error('Error fetching credit records:', err);
          throw new Error(`Failed to fetch credit records: ${err.message}`);
        }
      } else {
        // Wallet adapter doesn't expose requestRecords - executeTransition might handle it
        // but we still need to pass a record, so throw an error
        throw new Error(
          'Wallet adapter does not expose requestRecords method. ' +
          'Please use a wallet that supports record access, or ensure your wallet is properly connected.'
        );
      }

      // Create and submit transaction using RPC executeTransition
      // Convert credits to microcredits for the Leo program
      const liquidityMicrocredits = liquidity * CREDITS_TO_MICROCREDITS;
      const bondMicrocredits = bond * CREDITS_TO_MICROCREDITS;
      
      // Credit record is required for executeTransition
      // If we couldn't fetch it (wallet doesn't expose requestRecords), 
      // we need to let the user know or handle it differently
      if (!creditRecord) {
        throw new Error(
          'Unable to access credit records. Please ensure your wallet is connected and has credit records available. ' +
          'The executeTransition RPC will prompt your wallet for signing when creating the market.'
        );
      }

      // Use initMarket which uses executeTransition RPC
      // executeTransition will automatically work with the wallet adapter for signing
      const transactionId = await initMarket(
        liquidityMicrocredits,
        bondMicrocredits,
        fee,
        metadataHash,
        creditRecord // Credit record object - executeTransition will handle wallet interaction
      );

      setTxId(transactionId);
      setSuccess(true);
      
      // Call onSuccess callback after a short delay
      if (onSuccess) {
        setTimeout(() => {
          onSuccess();
        }, 2000);
      }
    } catch (err: any) {
      console.error('Failed to create market:', err);
      setError(err.message || 'Failed to create market. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="card bg-base-100 shadow-xl">
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
            <div>
              <h3 className="font-bold">Market Creation Submitted!</h3>
              <div className="text-xs">
                Transaction ID: {txId}
                <br />
                The market will appear in the list once the transaction is finalized.
              </div>
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
    <div className="card bg-base-100 shadow-xl">
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
            <span className="label-text-alt">Fixed: {BOND_AMOUNT_CREDITS} credit</span>
          </label>
          <input
            type="number"
            className="input input-bordered w-full input-disabled bg-base-200"
            value={BOND_AMOUNT_CREDITS}
            disabled={true}
            readOnly
          />
          <label className="label">
            <span className="label-text-alt">
              Non-redeemable bond paid when creating the market (fixed at {BOND_AMOUNT_CREDITS} credit)
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
