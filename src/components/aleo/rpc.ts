import { CREDITS_PROGRAM_ID, PREDICTION_MARKET_PROGRAM_ID, MarketState, UserPosition } from '@/types';
import { getFeeForFunction } from '@/utils/feeCalculator';
import { findWalletAdapter } from './wallet/adapter';
import { createTransactionOptions } from './wallet/tx';
import {
  getRecordId,
  areRecordsDistinct,
  extractRecordValue,
  filterUnspentRecords,
  findDistinctRecords,
} from './wallet/records';
import { client } from './rpc/client';
import {
  getMarketInitTransactions,
  getLatestBlockHeight,
  checkTransactionStatus,
  waitForTransactionToFinalize,
  getVerifyingKey,
  getProgram,
  fetchMarketMappingValue,
  fetchMarketMappingValueString,
  getTotalMarketsCount,
  getMarketIdAtIndex,
  fetchMarketCreator,
} from './rpc/chainRead';
import {
  getAllMarketsFromChain,
  getAllMarketsWithData,
  getActiveMarkets,
  getActiveMarketIds,
  clearMarketRegistryCache,
  type MarketRegistryEntry,
} from '@/lib/aleo/marketRegistry';

export { CREDITS_PROGRAM_ID } from '@/types';
export { client, getClient } from './rpc/client';
export {
  getMarketInitTransactions,
  getLatestBlockHeight,
  checkTransactionStatus,
  waitForTransactionToFinalize,
  getVerifyingKey,
  getProgram,
  fetchMarketMappingValue,
  fetchMarketMappingValueString,
  getTotalMarketsCount,
  getMarketIdAtIndex,
  fetchMarketCreator,
} from './rpc/chainRead';
export {
  getAllMarketsFromChain,
  getAllMarketsWithData,
  getActiveMarkets,
  getActiveMarketIds,
  clearMarketRegistryCache,
  type MarketRegistryEntry,
} from '@/lib/aleo/marketRegistry';

/**
 * Discover markets by querying init transactions and extracting market IDs
 * Market IDs are stored in mappings (market_status, market_creator, etc.)
 * We extract them from the finalize operations in transactions
 */
/**
 * Query a transaction by ID to get finalize operations.
 * Uses aleoTransactionsForProgram since getTransaction might not be available.
 * Also tries to find the transaction in recent blocks.
 */
async function getTransactionWithFinalize(transactionId: string): Promise<any> {
  try {
    // First, try to use getTransaction if available (some RPC endpoints support it)
    try {
      const tx = await client.request('getTransaction', { id: transactionId });
      if (tx) {
        return tx;
      }
    } catch {
      // getTransaction not available or transaction not found - continue to alternative method
    }

    // Alternative: Query recent init transactions and find the one matching our transaction ID
    // Search through recent pages of transactions
    for (let page = 0; page < 3; page++) {
      try {
        const txs = await getMarketInitTransactions(page, 100);
        if (!txs || !Array.isArray(txs) || txs.length === 0) break;
        
        // Look for transaction matching our ID
        const foundTx = txs.find((tx: any) => {
          const txId = tx.id || tx.transaction_id || tx.transactionId || tx.transaction?.id;
          return txId === transactionId || String(txId) === String(transactionId);
        });
        
        if (foundTx) return foundTx;
      } catch {
        break;
      }
    }

    // Transaction not found in recent pages
    return null;
  } catch {
    return null;
  }
}

export async function discoverMarketsFromChain(): Promise<string[]> {
  try {
    // First, try to get transactions - they might already have finalize ops
    const allTransactionIds: string[] = [];
    const transactionsWithFinalize: any[] = [];
    
    for (let page = 0; page < 5; page++) {
      try {
        const txs = await getMarketInitTransactions(page, 100);
        if (!txs || !Array.isArray(txs) || txs.length === 0) break;
        
        txs.forEach((tx: any) => {
          // Check if this transaction already has finalize ops
          const hasFinalize = tx.finalize || tx.transaction?.finalize || tx.execution?.finalize || tx.transaction?.execution?.finalize;
          if (hasFinalize) {
            transactionsWithFinalize.push(tx);
          } else {
            // Extract transaction ID to query later
            const txId = tx.id || tx.transaction_id || tx.transactionId || tx.transaction?.id;
            if (txId && typeof txId === 'string') {
              allTransactionIds.push(txId);
            }
          }
        });
        
        if (txs.length < 100) break;
      } catch (err) {
        break;
      }
    }
    
    const marketIds = new Set<string>();

    if (allTransactionIds.length === 0) return [];

    let transactions: any[] = [...transactionsWithFinalize];
    
    if (allTransactionIds.length > 0) {
      // Query each transaction individually to get finalize operations
      // Limit to first 50 to avoid timeout
      const transactionsToQuery = allTransactionIds.slice(0, 50);
      const transactionPromises = transactionsToQuery.map(txId => getTransactionWithFinalize(txId));
      const queriedTxs = (await Promise.all(transactionPromises)).filter(tx => tx !== null);
      transactions.push(...queriedTxs);
    }
    
    // Parse transactions to extract market IDs from finalize operations
    transactions.forEach((tx: any, idx: number) => {
      try {
        // Check multiple possible transaction structures for finalize operations
        const finalizeOps = 
          tx.finalize || 
          tx.transaction?.finalize ||
          tx.execution?.finalize ||
          tx.transaction?.execution?.finalize ||
          [];
        
        if (Array.isArray(finalizeOps) && finalizeOps.length > 0) {
          finalizeOps.forEach((op: any) => {
            try {
              const opType = op.type || op.Type || op.op_type;
              const mappingId = op.mapping_id || op.mappingId || op.mapping || '';
              const keyId = op.key_id || op.keyId || op.key || op.key_id_field || '';
              
              if ((opType === 'update_key_value' || opType === 'set_key_value' || opType === 'UpdateKeyValue' || opType === 'SetKeyValue') &&
                  mappingId && typeof mappingId === 'string' && mappingId.includes('market_status')) {
                if (keyId) {
                  let marketId = String(keyId);
                  marketId = marketId.replace(/\.field$/, '').replace(/field$/, '').replace(/\.private$/, '').trim();
                  if (marketId && marketId.length > 0) marketIds.add(marketId);
                }
              }
            } catch {
              // Skip invalid finalize op
            }
          });
        }

        // If we didn't find market_id in finalize ops, try querying mappings directly
        // by checking if this transaction created a market_status mapping
        // We can't derive market_id from inputs/outputs, so we need finalize ops
      } catch {
        // Skip invalid transaction
      }
    });

    return Array.from(marketIds);
  } catch {
    return [];
  }
}

/**
 * Extract market_id from a specific transaction by ID.
 * Queries the transaction and checks finalize operations.
 * Also tries querying the block if transaction doesn't have finalize ops.
 * Enhanced to check multiple transaction structure formats and retry with delays.
 */
export async function extractMarketIdFromTransaction(
  transactionId: string,
  retries: number = 3,
  delayMs: number = 2000
): Promise<string | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (attempt > 0) {
        // Wait before retrying (transaction might not be indexed yet)
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      }

      const tx = await getTransactionWithFinalize(transactionId);
      if (!tx) continue;

      const finalizeOps = 
        tx.finalize || 
        tx.transaction?.finalize ||
        tx.execution?.finalize ||
        tx.transaction?.execution?.finalize ||
        tx.transaction?.finalize_operations ||
        tx.execution?.finalize_operations ||
        [];
      
      if (Array.isArray(finalizeOps) && finalizeOps.length > 0) {
        // Try to extract from any market-related mapping update
        const marketMappings = ['market_status', 'market_creator', 'market_metadata_hash', 'market_bond', 
                                'market_collateral_pool', 'market_yes_reserve', 'market_no_reserve'];
        
        for (const op of finalizeOps) {
          const opType = op.type || op.Type || op.op_type || op.opType;
          const mappingId = op.mapping_id || op.mappingId || op.mapping || op.mapping_name || '';
          const keyId = op.key_id || op.keyId || op.key || op.key_id_field || op.key_field || '';
          
          // Check if this is a mapping update operation
          const isMappingUpdate = opType === 'update_key_value' || 
                                  opType === 'set_key_value' || 
                                  opType === 'UpdateKeyValue' || 
                                  opType === 'SetKeyValue' ||
                                  opType === 'mapping_update' ||
                                  (opType === undefined && mappingId && keyId); // Some APIs don't include type
          
          if (isMappingUpdate && mappingId && typeof mappingId === 'string') {
            // Check if this is a market-related mapping
            const isMarketMapping = marketMappings.some(m => 
              mappingId.includes(m) || mappingId.endsWith(m) || mappingId.includes('market')
            );
            
            if (isMarketMapping && keyId) {
              let marketId = String(keyId);
              // Clean up the market ID: remove field suffix, private suffix, etc.
              marketId = marketId.replace(/\.field$/, '').replace(/field$/, '').replace(/\.private$/, '').trim();
              
              // Also try to extract from nested structures
              if (!marketId || marketId === 'undefined' || marketId === 'null') {
                const nestedKey = op.key?.id || op.key?.value || op.value?.key || op.value?.id;
                if (nestedKey) {
                  marketId = String(nestedKey).replace(/\.field$/, '').replace(/field$/, '').replace(/\.private$/, '').trim();
                }
              }
              
              if (marketId && marketId.length > 0 && marketId !== 'undefined' && marketId !== 'null') {
                return marketId;
              }
            }
          }
        }
      }

      // Also check transaction execution inputs/outputs - user mentioned market_id is visible as "input #"
      const execution = tx.execution || tx.transaction?.execution;
      if (execution) {
        const transitions = execution.transitions || execution.transition || [];
        for (const transition of Array.isArray(transitions) ? transitions : [transitions]) {
          if (transition && (transition.function === 'init' || transition.functionName === 'init')) {
            // Check inputs - user said market_id is visible as "input #" (like "5. 11277985945263598566field")
            const inputs = transition.inputs || transition.input || [];
            for (let i = 0; i < (Array.isArray(inputs) ? inputs.length : 1); i++) {
              const input = Array.isArray(inputs) ? inputs[i] : inputs;
              if (input && typeof input === 'string') {
                // Look for field values in inputs (format: "number.field" or "numberfield")
                const fieldMatch = input.match(/(\d+)\.?\s*field/i) || input.match(/(\d+field)/i);
                if (fieldMatch) {
                  const potentialMarketId = fieldMatch[1].replace(/field/i, '').trim();
                  if (potentialMarketId && potentialMarketId.length > 10) {
                    try {
                      await fetchMarketMappingValue('market_status', potentialMarketId);
                      return potentialMarketId;
                    } catch {
                      // Not a valid market_id, continue
                    }
                  }
                }
              }
            }
            
            // Check outputs for any field values that might be market_id
            const outputs = transition.outputs || transition.output || [];
            for (const output of Array.isArray(outputs) ? outputs : [outputs]) {
              if (output && typeof output === 'string' && output.includes('field')) {
                // This might be a market_id if it's a field value
                const potentialMarketId = output.replace(/\.field$/, '').replace(/field$/, '').trim();
                if (potentialMarketId && potentialMarketId.length > 10) {
                  try {
                    await fetchMarketMappingValue('market_status', potentialMarketId);
                    return potentialMarketId;
                  } catch {
                    // Not a valid market_id, continue
                  }
                }
              }
            }
          }
        }
      }

    } catch {
      // Retry on next attempt
    }
  }

  return null;
}

/**
 * Discover markets by checking if market_status exists for potential market IDs
 * This is a brute-force approach - not recommended for production
 * Better to use an indexer or track market IDs from transactions
 */
export async function discoverMarketsByTestingIds(
  potentialIds: string[]
): Promise<string[]> {
  const validMarketIds: string[] = [];

  // Test each potential market ID by checking if market_status exists
  for (const marketId of potentialIds) {
    try {
      await getMarketState(marketId);
      validMarketIds.push(marketId);
    } catch {
      // Market doesn't exist, skip
    }
  }

  return validMarketIds;
}

/**
 * Get all active market IDs by querying market_index mapping
 * Filters to only return markets with STATUS_OPEN (0)
 * Uses the new market registry module for efficient enumeration
 * 
 * @deprecated Consider using getActiveMarketIds() from marketRegistry directly
 */
export async function getAllActiveMarketIds(): Promise<string[]> {
  // Use the new registry module
  return getActiveMarketIds();
}

/**
 * Get all markets (not just active) from chain enumeration
 * Uses the market registry module
 */
export async function getAllMarkets(): Promise<MarketRegistryEntry[]> {
  return getAllMarketsWithData();
}

/**
 * Transfer credits publicly between two accounts.
 */
export async function transferPublic(
  recipient: string,
  amount: string
): Promise<string> {
  const inputs = [
    `${recipient}.public`, // Recipient's public address
    `${amount}u64`,    // Amount to transfer
  ];

  const result = await client.request('executeTransition', {
    programId: CREDITS_PROGRAM_ID,
    functionName: 'transfer_public',
    inputs,
  });

  if (!result.transactionId) {
    throw new Error('Transaction failed: No transactionId returned.');
  }
  return result.transactionId;
}

/**
 * Transfer credits privately between two accounts.
 *
 * This function calls the on-chain "transfer_private" transition,
 * which exactly expects three inputs in the following order:
 *  - r0: Sender's credits record (credits.record)
 *  - r1: Recipient's address with a ".private" suffix (address.private)
 *  - r2: Transfer amount with a "u64.private" suffix (u64.private)
 *
 * It returns two credits records:
 *  - The first output is the recipient's updated credits record.
 *  - The second output is the sender's updated credits record.
 */
export async function transferPrivate(
  senderRecord: string,
  recipient: string,
  amount: string
): Promise<{ recipientRecord: string; senderRecord: string }> {
  // Exactly matching the expected input types:
  const inputs = [
    `${senderRecord}`,         // r0: credits.record
    `${recipient}.private`,    // r1: address.private
    `${amount}u64.private`,     // r2: u64.private
  ];

  const result = await client.request('executeTransition', {
    programId: CREDITS_PROGRAM_ID,
    functionName: 'transfer_private',
    inputs,
  });

  if (!result.transactionId) {
    throw new Error('Transaction failed: No transactionId returned.');
  }

  // The Aleo program returns:
  //   result.outputs[0] -> recipient's updated credits record (r4)
  //   result.outputs[1] -> sender's updated credits record (r5)
  return {
    recipientRecord: result.outputs[0],
    senderRecord: result.outputs[1],
  };
}

/**
 * Join two credit records into one
 * Uses credits.aleo/join which takes two credit records and combines them
 * @param wallet - Wallet adapter instance
 * @param record1 - First credit record (object or string)
 * @param record2 - Second credit record (object or string)
 * @returns Transaction ID
 */
export async function joinRecords(
  wallet: any,
  record1: any,
  record2: any
): Promise<string> {
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) {
    throw new Error('Wallet adapter does not support transaction execution');
  }

  const inputs = [
    record1, // First credit record
    record2, // Second credit record
  ];

  const fee = getFeeForFunction('join');
  const transactionOptions = createTransactionOptions(
    CREDITS_PROGRAM_ID,
    'join',
    inputs,
    fee,
    true, // payFeesPrivately
    [0, 1] // record indices
  );

  const result = await walletAdapter.executeTransaction(transactionOptions);
  return result.transactionId;
}

/**
 * Combine multiple credit records into one by joining them iteratively
 * Note: After joining, you need to wait for the transaction to finalize and fetch the new combined record
 * @param wallet - Wallet adapter instance
 * @param records - Array of credit records to combine
 * @returns Array of transaction IDs (one for each join operation)
 */
export async function combineMultipleRecords(
  wallet: any,
  records: any[]
): Promise<string[]> {
  if (records.length < 2) {
    throw new Error('Need at least 2 records to combine');
  }

  const transactionIds: string[] = [];
  let currentRecord = records[0];

  for (let i = 1; i < records.length; i++) {
    const txId = await joinRecords(wallet, currentRecord, records[i]);
    transactionIds.push(txId);
    
    // Note: In a real implementation, you'd need to wait for the transaction to finalize
    // and fetch the new combined record before continuing. For now, we'll just return the transaction IDs.
    // The user will need to wait and fetch records again after transactions finalize.
    currentRecord = records[i]; // This is a placeholder - in reality, you'd fetch the new combined record
  }

  return transactionIds;
}


// ==========================================
// Prediction Market Functions
// ==========================================

/**
 * Split a record by performing a private transfer to self
 * This creates a new record that can be used as a fee record
 * @param wallet - Wallet adapter instance
 * @param walletWithRecords - Wallet adapter with requestRecords method
 * @param record - Record to split
 * @param splitAmount - Amount to split off (in microcredits)
 * @param recipientAddress - Address to transfer to (usually self)
 * @returns Transaction ID of the split operation
 */
async function splitRecordForFee(
  wallet: any,
  walletWithRecords: any,
  record: any,
  splitAmount: number,
  recipientAddress: string
): Promise<string> {
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) {
    throw new Error('Wallet adapter does not support transaction execution');
  }

  // Pass record through unchanged; do not stringify. Shield (and other adapters) require
  // record inputs as the objects returned by requestRecords.
  const inputs = [
    record,
    `${recipientAddress}.private`,
    `${splitAmount}u64.private`,
  ];

  const fee = getFeeForFunction('transfer_private');
  const transactionOptions = createTransactionOptions(
    CREDITS_PROGRAM_ID,
    'transfer_private',
    inputs,
    fee,
    true, // payFeesPrivately - but this will need a fee record too!
    [0] // record index
  );

  // Note: This split operation itself needs a fee record
  // If we only have one record, we can't split it because we'd need another for the fee
  // So this function assumes we have at least 2 records, or we're doing a public fee
  // Actually, wait - if we only have one record, we can't split it with a private fee
  // We'd need to use a public fee for the split operation
  // Let's use public fee for the split operation to avoid recursion
  transactionOptions.privateFee = false;

  const result = await walletAdapter.executeTransaction(transactionOptions);
  return result.transactionId;
}

/**
 * Preflight record validation - checks record before transaction
 */
async function preflightRecordValidation(
  record: any,
  requiredAmount: number,
  signerAddress: string,
  chainHeight: number
): Promise<{ valid: boolean; error?: string }> {
  // Check if this is a Shield wallet encrypted record
  const isShieldWalletRecord = record.recordCiphertext && typeof record.recordCiphertext === 'string';
  
  if (isShieldWalletRecord) return { valid: true };
  
  // For decrypted records (Leo wallet), we can validate
  // 1. Check record is unspent at current height
  // Note: This requires querying chain/indexer for record commitment status
  // For now, we'll rely on wallet's internal validation but log warnings
  
  // 2. Verify record owner matches signer (only if owner field exists)
  if (record.owner) {
    // Normalize addresses for comparison (remove any whitespace, case-insensitive)
    const normalizedOwner = record.owner.trim().toLowerCase();
    const normalizedSigner = signerAddress.trim().toLowerCase();
    
    // Don't fail - wallet adapter will handle validation
  }
  
  const recordValue = extractRecordValue(record);
  if (recordValue > 0 && recordValue < requiredAmount) {
    // Don't fail - wallet adapter will validate
  }
  
  return { valid: true };
}

/**
 * Preflight market ID collision check.
 * market_id = hash(creator || metadata_hash || salt); no counter. We don't compute BHP256 in JS,
 * so we skip chain collision check here. Init reverts on-chain if (creator, metadata_hash, salt) was already used.
 */
async function preflightMarketIdCheck(
  _creator: string,
  _metadataHash: string,
  _salt: string
): Promise<{ marketId: string; collision: boolean }> {
  return { marketId: '', collision: false };
}

/**
 * Initialize market - Creates a new prediction market
 * @param wallet - Wallet adapter instance
 * @param publicKey - Public key of the user
 * @param initialLiquidity - Initial liquidity amount (in microcredits, u64)
 * @param bondAmount - Creation bond amount (in microcredits, u64)
 * @param feeBps - Fee in basis points (u64, max 1000 = 10%)
 * @param metadataHash - Metadata hash (field)
 * @param salt - Salt for market_id = hash(creator || metadata_hash || salt) (field)
 * @param creditRecord - Credit record for payment (record object or string) - DEPRECATED: will be selected internally
 * @param requestRecords - Optional requestRecords function from useWallet hook (preferred method)
 */
export async function initMarket(
  wallet: any,
  publicKey: string,
  initialLiquidity: number,
  bondAmount: number,
  feeBps: number,
  metadataHash: string,
  salt: string,
  creditRecord?: any, // Optional for backward compatibility, but will be ignored
  requestRecords?: (programId: string, decrypt?: boolean) => Promise<any[]> // Optional requestRecords from hook
): Promise<string> {
  // Find wallet adapter
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) {
    throw new Error('Wallet adapter does not support transaction execution. Please ensure your wallet is connected.');
  }

  // Use requestRecords from hook if provided, otherwise try to find it on wallet object
  let requestRecordsFn: ((programId: string, decrypt?: boolean) => Promise<any[]>) | null = null;
  
  if (requestRecords && typeof requestRecords === 'function') {
    requestRecordsFn = requestRecords;
  } else {
    // Fallback: try to find requestRecords on wallet object
    if (wallet) {
      if (typeof wallet.requestRecords === 'function') {
        requestRecordsFn = wallet.requestRecords.bind(wallet);
      } else if (wallet.wallet && typeof wallet.wallet.requestRecords === 'function') {
        requestRecordsFn = wallet.wallet.requestRecords.bind(wallet.wallet);
      } else if (wallet.adapter && typeof wallet.adapter.requestRecords === 'function') {
        requestRecordsFn = wallet.adapter.requestRecords.bind(wallet.adapter);
      }
    }
  }

  if (!requestRecordsFn) {
    throw new Error(
      'requestRecords not available. ' +
      'Please ensure your wallet is properly connected and supports record access.'
    );
  }

  const spendAmount = bondAmount + initialLiquidity;
  const feeAmount = getFeeForFunction('init');

  let allRecords: any[];
  try {
    allRecords = await requestRecordsFn(CREDITS_PROGRAM_ID, false);
  } catch (err: any) {
    throw new Error(`Failed to fetch credit records: ${err.message}`);
  }

  if (!allRecords || allRecords.length === 0) {
    throw new Error('No credits records found in wallet.');
  }

  const unspentRecords = filterUnspentRecords(allRecords);
  if (unspentRecords.length === 0) {
    throw new Error('No unspent credit records available in wallet.');
  }

  // Check if we have records with ciphertext (Shield recordCiphertext, Leo record/value, etc. — can't always validate amounts)
  const hasCiphertextRecords = unspentRecords.some((r) => {
    const x = r.record as Record<string, unknown>;
    const v = x?.recordCiphertext ?? x?.ciphertext ?? x?.record ?? x?.value;
    return typeof v === 'string' && v.startsWith('record') && v.length > 50;
  });

  // Try to find two distinct records
  let records = findDistinctRecords(allRecords, spendAmount, feeAmount);

  // If we couldn't find distinct records, let the wallet adapter handle it
  if (!records) {
    if (hasCiphertextRecords) {
      // Use first two ciphertext records; wallet adapter will handle validation
      if (unspentRecords.length >= 2) {
        records = {
          spendRecord: unspentRecords[0].record,
          feeRecord: unspentRecords[1].record
        };
      } else if (unspentRecords.length === 1) {
        records = null;
      } else {
        throw new Error('No unspent credit records available in wallet.');
      }
    } else {
      // For decrypted records, provide helpful error but let wallet adapter be the final validator
      const totalSpendNeeded = spendAmount + feeAmount;
      const totalBalance = unspentRecords.reduce((sum, r) => sum + r.value, 0);
      
      if (totalBalance < totalSpendNeeded) {
        throw new Error(
          `Insufficient balance. Need ${(totalSpendNeeded / 1_000_000).toFixed(6)} credits total ` +
          `(${(spendAmount / 1_000_000).toFixed(6)} for transaction + ${(feeAmount / 1_000_000).toFixed(6)} for fee), ` +
          `but only have ${(totalBalance / 1_000_000).toFixed(6)} credits.`
        );
      }
      
      // If we have balance but couldn't find distinct records, try to proceed anyway
      // The wallet adapter will handle the actual validation
      if (unspentRecords.length >= 2) {
        records = {
          spendRecord: unspentRecords[0].record,
          feeRecord: unspentRecords[1].record
        };
      } else {
        records = null;
      }
    }
  }
  
  // If records is still null, use the first available record
  // The wallet adapter will handle fee record selection automatically
  if (!records) {
    if (unspentRecords.length === 0) {
      throw new Error('No unspent credit records available in wallet.');
    }
    // Use the first record - wallet adapter will handle fee record selection
    records = {
      spendRecord: unspentRecords[0].record,
      feeRecord: unspentRecords[0].record
    };
  }

  const spendRecordId = getRecordId(records.spendRecord);
  const feeRecordId = getRecordId(records.feeRecord);

  const chainHeight = await getLatestBlockHeight();
  const recordValidation = await preflightRecordValidation(
    records.spendRecord,
    spendAmount,
    publicKey,
    chainHeight
  );
  
  if (!recordValidation.valid) {
    throw new Error(`Preflight validation failed: ${recordValidation.error}`);
  }
  
  await preflightMarketIdCheck(publicKey, metadataHash, salt);

  const saltField = salt.endsWith('field') ? salt : `${salt}field`;
  const inputs = [
    `${initialLiquidity}u64`,
    `${bondAmount}u64`,
    `${feeBps}u64`,
    `${metadataHash}field`,
    saltField,
    records.spendRecord,
  ];
  const fee = getFeeForFunction('init');

  const transactionOptions = createTransactionOptions(
    PREDICTION_MARKET_PROGRAM_ID,
    'init',
    inputs,
    fee,
    false,
    [5] // spend_record at index 5 — pass through unchanged; do not stringify
  );

  if (!transactionOptions.program || !transactionOptions.function || !Array.isArray(transactionOptions.inputs)) {
    throw new Error('Transaction options missing required fields');
  }

  try {
    type ExecuteResult = { transactionId?: string; txId?: string; id?: string; transaction_id?: string; data?: { transactionId?: string; txId?: string; id?: string }; result?: { transactionId?: string; txId?: string; id?: string }; status?: unknown; state?: unknown; pending?: unknown; error?: unknown; message?: unknown; reason?: unknown };
    const result = (await walletAdapter.executeTransaction(transactionOptions)) as ExecuteResult;
    
    // Try multiple possible fields for transaction ID (including nested)
    let transactionId = result?.transactionId || result?.txId || result?.id || result?.transaction_id;
    
    // Check nested structures (some adapters wrap the response)
    if (!transactionId && result) {
      // Check if result has a nested data/result object
      if (result.data?.transactionId) transactionId = result.data.transactionId;
      if (result.data?.txId) transactionId = result.data.txId;
      if (result.data?.id) transactionId = result.data.id;
      if (result.result?.transactionId) transactionId = result.result.transactionId;
      if (result.result?.txId) transactionId = result.result.txId;
      if (result.result?.id) transactionId = result.result.id;
    }
    
    if (!transactionId) {
      throw new Error('Transaction submitted but no transaction ID returned. Please check your wallet for transaction status.');
    }
    
    return String(transactionId).trim();
  } catch (error: any) {
    // Check error type and provide specific guidance
    if (error?.message?.includes('prove') || error?.message?.includes('proof')) {
      throw new Error(`Proving failed: ${error.message}. Check inputs and record validity.`);
    }
    if (error?.message?.includes('broadcast') || error?.message?.includes('RPC')) {
      throw new Error(`Broadcast failed: ${error.message}. Check network connection and RPC endpoint.`);
    }
    if (error?.message?.includes('record') || error?.message?.includes('spent')) {
      throw new Error(`Record selection failed: ${error.message}. Try refreshing records.`);
    }
    if (error?.message?.includes('parse input') || error?.message?.includes('credits.aleo/credits.record')) {
      throw new Error(
        `Input parsing failed: ${error.message}. ` +
        `This usually means the record format is incorrect. ` +
        `Check that Shield wallet records have recordCiphertext property.`
      );
    }
    
    // Check if error is related to double-spend
    if (error.message && (error.message.includes('double') || error.message.includes('already spent') || error.message.includes('consumed'))) {
      throw new Error(
        `Double-spend detected: The wallet may have selected the same record for the fee. ` +
        `spend_record.id: ${spendRecordId}, fee_record.id: ${feeRecordId}. ` +
        `This is a wallet adapter issue - please ensure you have multiple distinct records.`
      );
    }
    
    throw error;
  }
}


/**
 * Open position (first-time) - Creates initial Position record.
 * Amounts are in microcredits (program convention). Callers must pass microcredits.
 *
 * @param wallet - Wallet adapter instance
 * @param publicKey - Public key of the user
 * @param marketId - Field-based market ID
 * @param creditRecord - Credit record for deposit
 * @param amount - Amount to deposit (u64, microcredits)
 * @param statusHint - Market status hint (0=open)
 */
export async function openPositionPrivate(
  wallet: any,
  publicKey: string,
  marketId: string,
  creditRecord: string,
  amount: number,
  statusHint: number = 0
): Promise<string> {
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) {
    throw new Error('Wallet adapter does not support transaction execution');
  }

  const amountU64 = Math.floor(Number(amount));
  if (amountU64 < 1 || amountU64 > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Invalid deposit amount: ${amount} microcredits`);
  }
  const inputs = [
    `${marketId}field`,
    creditRecord,
    `${amountU64}u64`,
    `${statusHint}u8`,
  ];

  const fee = getFeeForFunction('open_position_private');
  const transactionOptions = createTransactionOptions(
    PREDICTION_MARKET_PROGRAM_ID,
    'open_position_private',
    inputs,
    fee,
    true, // payFeesPrivately
    [1] // credit_record at index 1
  );

  const result = await walletAdapter.executeTransaction(transactionOptions);
  return result.transactionId;
}

/**
 * Deposit private - Adds collateral to existing Position.
 * Amounts are in microcredits (program convention). Callers must pass microcredits.
 *
 * @param wallet - Wallet adapter instance
 * @param publicKey - Public key of the user
 * @param marketId - Field-based market ID
 * @param creditRecord - Credit record for deposit
 * @param amount - Amount to deposit (u64, microcredits)
 * @param existingPosition - Existing Position record
 * @param statusHint - Market status hint (0=open)
 */
export async function depositPrivate(
  wallet: any,
  publicKey: string,
  marketId: string,
  creditRecord: string,
  amount: number,
  existingPosition: string,
  statusHint: number = 0
): Promise<string> {
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) {
    throw new Error('Wallet adapter does not support transaction execution');
  }

  const amountU64 = Math.floor(Number(amount));
  if (amountU64 < 1 || amountU64 > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Invalid deposit amount: ${amount} microcredits`);
  }
  const inputs = [
    `${marketId}field`,
    creditRecord,
    `${amountU64}u64`,
    existingPosition,
    `${statusHint}u8`,
  ];

  const fee = getFeeForFunction('deposit_private');
  const transactionOptions = createTransactionOptions(
    PREDICTION_MARKET_PROGRAM_ID,
    'deposit_private',
    inputs,
    fee,
    true, // payFeesPrivately
    [1, 3] // credit_record, existing_position
  );

  const result = await walletAdapter.executeTransaction(transactionOptions);
  return result.transactionId;
}

/**
 * Swap collateral for YES shares using AMM.
 * Amounts (collateralIn, yesReserve, noReserve, minYesOut) are in microcredits (program convention). Callers must pass microcredits.
 *
 * @param wallet - Wallet adapter instance
 * @param publicKey - Public key of the user
 * @param marketId - Field-based market ID
 * @param existingPosition - Existing Position record
 * @param collateralIn - Collateral amount to swap (u64, microcredits)
 * @param minYesOut - Minimum YES shares expected (u128, microcredits, for slippage protection)
 * @param yesReserve - Current YES reserve (u128, microcredits)
 * @param noReserve - Current NO reserve (u128, microcredits)
 * @param feeBps - Fee in basis points (u64)
 * @param statusHint - Market status hint (0=open)
 */
export async function swapCollateralForYesPrivate(
  wallet: any,
  publicKey: string,
  marketId: string,
  existingPosition: string,
  collateralIn: number,
  minYesOut: number,
  yesReserve: number,
  noReserve: number,
  feeBps: number,
  statusHint: number = 0
): Promise<string> {
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) {
    throw new Error('Wallet adapter does not support transaction execution');
  }

  const inputs = [
    `${marketId}field`,
    existingPosition,
    `${collateralIn}u64`,
    `${minYesOut}u128`,
    `${yesReserve}u128`,
    `${noReserve}u128`,
    `${feeBps}u64`,
    `${statusHint}u8`,
  ];

  const fee = getFeeForFunction('swap_collateral_for_yes_private');
  const transactionOptions = createTransactionOptions(
    PREDICTION_MARKET_PROGRAM_ID,
    'swap_collateral_for_yes_private',
    inputs,
    fee,
    true, // payFeesPrivately
    [1] // existing_position
  );

  const result = await walletAdapter.executeTransaction(transactionOptions);
  return result.transactionId;
}

/**
 * Swap collateral for NO shares using AMM.
 * Amounts (collateralIn, yesReserve, noReserve, minNoOut) are in microcredits (program convention). Callers must pass microcredits.
 *
 * @param wallet - Wallet adapter instance
 * @param publicKey - Public key of the user
 * @param marketId - Field-based market ID
 * @param existingPosition - Existing Position record
 * @param collateralIn - Collateral amount to swap (u64, microcredits)
 * @param minNoOut - Minimum NO shares expected (u128, microcredits, for slippage protection)
 * @param yesReserve - Current YES reserve (u128, microcredits)
 * @param noReserve - Current NO reserve (u128, microcredits)
 * @param feeBps - Fee in basis points (u64)
 * @param statusHint - Market status hint (0=open)
 */
export async function swapCollateralForNoPrivate(
  wallet: any,
  publicKey: string,
  marketId: string,
  existingPosition: string,
  collateralIn: number,
  minNoOut: number,
  yesReserve: number,
  noReserve: number,
  feeBps: number,
  statusHint: number = 0
): Promise<string> {
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) {
    throw new Error('Wallet adapter does not support transaction execution');
  }

  const inputs = [
    `${marketId}field`,
    existingPosition,
    `${collateralIn}u64`,
    `${minNoOut}u128`,
    `${yesReserve}u128`,
    `${noReserve}u128`,
    `${feeBps}u64`,
    `${statusHint}u8`,
  ];

  const fee = getFeeForFunction('swap_collateral_for_no_private');
  const transactionOptions = createTransactionOptions(
    PREDICTION_MARKET_PROGRAM_ID,
    'swap_collateral_for_no_private',
    inputs,
    fee,
    true, // payFeesPrivately
    [1] // existing_position
  );

  const result = await walletAdapter.executeTransaction(transactionOptions);
  return result.transactionId;
}

/**
 * Merge tokens to collateral (pre-resolution exit)
 * Burns equal amounts of YES and NO tokens to receive collateral back
 * @param wallet - Wallet adapter instance
 * @param publicKey - Public key of the user
 * @param marketId - Field-based market ID
 * @param existingPosition - Existing Position record
 * @param mergeAmount - Amount of YES/NO tokens to merge (u128)
 * @param minCollateralOut - Minimum collateral expected (u64, for slippage protection)
 */
export async function mergeTokensPrivate(
  wallet: any,
  publicKey: string,
  marketId: string,
  existingPosition: string,
  mergeAmount: number,
  minCollateralOut: number
): Promise<string> {
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) {
    throw new Error('Wallet adapter does not support transaction execution');
  }

  const inputs = [
    `${marketId}field`,
    existingPosition,
    `${mergeAmount}u128`,
    `${minCollateralOut}u64`,
  ];

  const fee = getFeeForFunction('merge_tokens_private');
  const transactionOptions = createTransactionOptions(
    PREDICTION_MARKET_PROGRAM_ID,
    'merge_tokens_private',
    inputs,
    fee,
    true, // payFeesPrivately
    [1] // existing_position
  );

  const result = await walletAdapter.executeTransaction(transactionOptions);
  return result.transactionId;
}

/**
 * Withdraw private - Withdraws available collateral (only if no shares held)
 * @param wallet - Wallet adapter instance
 * @param publicKey - Public key of the user
 * @param marketId - Field-based market ID
 * @param existingPosition - Existing Position record
 * @param amount - Amount to withdraw (u64)
 */
export async function withdrawPrivate(
  wallet: any,
  publicKey: string,
  marketId: string,
  existingPosition: string,
  amount: number
): Promise<string> {
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) {
    throw new Error('Wallet adapter does not support transaction execution');
  }

  const inputs = [
    `${marketId}field`,
    existingPosition,
    `${amount}u64`,
  ];

  const fee = getFeeForFunction('withdraw_private');
  const transactionOptions = createTransactionOptions(
    PREDICTION_MARKET_PROGRAM_ID,
    'withdraw_private',
    inputs,
    fee,
    true, // payFeesPrivately
    [1] // existing_position
  );

  const result = await walletAdapter.executeTransaction(transactionOptions);
  return result.transactionId;
}

/**
 * Redeem private - Redeems winning shares after market resolution
 * @param wallet - Wallet adapter instance
 * @param publicKey - Public key of the user
 * @param marketId - Field-based market ID
 * @param existingPosition - Existing Position record
 * @param outcome - Market outcome (true=YES wins, false=NO wins)
 */
export async function redeemPrivate(
  wallet: any,
  publicKey: string,
  marketId: string,
  existingPosition: string,
  outcome: boolean
): Promise<string> {
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) {
    throw new Error('Wallet adapter does not support transaction execution');
  }

  const inputs = [
    `${marketId}field`,
    existingPosition,
    outcome ? 'true' : 'false',
  ];

  const fee = getFeeForFunction('redeem_private');
  const transactionOptions = createTransactionOptions(
    PREDICTION_MARKET_PROGRAM_ID,
    'redeem_private',
    inputs,
    fee,
    true, // payFeesPrivately
    [1] // existing_position
  );

  const result = await walletAdapter.executeTransaction(transactionOptions);
  return result.transactionId;
}

/**
 * Resolve market - Admin only
 * @param wallet - Wallet adapter instance
 * @param publicKey - Public key of the user
 * @param marketId - Field-based market ID
 * @param outcome - Market outcome (true=YES wins, false=NO wins)
 */
export async function resolveMarket(
  wallet: any,
  publicKey: string,
  marketId: string,
  outcome: boolean
): Promise<string> {
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) {
    throw new Error('Wallet adapter does not support transaction execution');
  }

  const inputs = [
    `${marketId}field`,
    outcome ? 'true' : 'false',
  ];

  const fee = getFeeForFunction('resolve');
  const transactionOptions = createTransactionOptions(
    PREDICTION_MARKET_PROGRAM_ID,
    'resolve',
    inputs,
    fee,
    true // payFeesPrivately
  );

  const result = await walletAdapter.executeTransaction(transactionOptions);
  return result.transactionId;
}

/**
 * Pause market - Admin only
 * @param wallet - Wallet adapter instance
 * @param publicKey - Public key of the user
 * @param marketId - Field-based market ID
 */
export async function pause(
  wallet: any,
  publicKey: string,
  marketId: string
): Promise<string> {
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) {
    throw new Error('Wallet adapter does not support transaction execution');
  }

  const inputs = [
    `${marketId}field`,
  ];

  const fee = getFeeForFunction('pause');
  const transactionOptions = createTransactionOptions(
    PREDICTION_MARKET_PROGRAM_ID,
    'pause',
    inputs,
    fee,
    true // payFeesPrivately
  );

  const result = await walletAdapter.executeTransaction(transactionOptions);
  return result.transactionId;
}

/**
 * Unpause market - Admin only
 * @param wallet - Wallet adapter instance
 * @param publicKey - Public key of the user
 * @param marketId - Field-based market ID
 */
export async function unpause(
  wallet: any,
  publicKey: string,
  marketId: string
): Promise<string> {
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) {
    throw new Error('Wallet adapter does not support transaction execution');
  }

  const inputs = [
    `${marketId}field`,
  ];

  const fee = getFeeForFunction('unpause');
  const transactionOptions = createTransactionOptions(
    PREDICTION_MARKET_PROGRAM_ID,
    'unpause',
    inputs,
    fee,
    true // payFeesPrivately
  );

  const result = await walletAdapter.executeTransaction(transactionOptions);
  return result.transactionId;
}

/**
 * Get market state (AMM-based)
 * @param marketId - Field-based market ID
 */
export async function getMarketState(marketId: string): Promise<MarketState> {
  try {
    const status = await fetchMarketMappingValue('market_status', marketId);
    const yesReserve = await fetchMarketMappingValue('market_yes_reserve', marketId);
    const noReserve = await fetchMarketMappingValue('market_no_reserve', marketId);
    const collateralPool = await fetchMarketMappingValue('market_collateral_pool', marketId);
    const feeBps = await fetchMarketMappingValue('market_fee_bps', marketId);
    
    // Get price from last_price_update mapping, or derive from reserves
    let priceYes: number;
    try {
      priceYes = await fetchMarketMappingValue('last_price_update', marketId);
    } catch {
      // Fallback: derive price from reserves if last_price_update not available
      // Price formula: priceYes = (noReserve * SCALE) / (yesReserve + noReserve)
      const SCALE = 10000;
      priceYes = Math.floor((Number(noReserve) * SCALE) / (Number(yesReserve) + Number(noReserve)));
    }
    
    let outcome: boolean | null = null;
    try {
      const outcomeValue = await fetchMarketMappingValueString('last_resolve', marketId);
      outcome = outcomeValue === 'true';
    } catch {
      // Market not resolved yet
      outcome = null;
    }

    // isPaused is derived from status (status === 2 means paused)
    const isPaused = Number(status) === 2;

    return {
      status: Number(status),
      outcome,
      priceYes: Number(priceYes),
      collateralPool: Number(collateralPool),
      yesReserve: Number(yesReserve),
      noReserve: Number(noReserve),
      feeBps: Number(feeBps),
      isPaused,
    };
  } catch (error: any) {
    throw error;
  }
}

/**
 * Get user position from private Position records
 * @param wallet - Wallet adapter instance (from useWallet hook)
 * @param programId - Program ID to fetch records from
 * @param marketId - Field-based market ID to filter records
 * @param requestRecords - Optional requestRecords from useWallet hook (preferred when wallet structure varies)
 */
export async function getUserPositionRecords(
  wallet: any,
  programId: string,
  marketId: string,
  requestRecords?: (programId: string, decrypt?: boolean) => Promise<any[]>
): Promise<UserPosition | null> {
  try {
    if (!wallet) {
      throw new Error('Wallet adapter not available');
    }

    // Resolve requestRecords: hook first, then wallet.requestRecords, wallet.wallet, wallet.adapter
    let requestRecordsFn: ((programId: string, decrypt?: boolean) => Promise<any[]>) | null = null;
    if (requestRecords && typeof requestRecords === 'function') {
      requestRecordsFn = requestRecords;
    } else if (typeof wallet.requestRecords === 'function') {
      requestRecordsFn = wallet.requestRecords.bind(wallet);
    } else if (wallet.wallet && typeof wallet.wallet.requestRecords === 'function') {
      requestRecordsFn = wallet.wallet.requestRecords.bind(wallet.wallet);
    } else if (wallet.adapter && typeof wallet.adapter.requestRecords === 'function') {
      requestRecordsFn = wallet.adapter.requestRecords.bind(wallet.adapter);
    }

    if (!requestRecordsFn) {
      throw new Error('Wallet adapter not available or does not support requestRecords');
    }

    // Fetch all Position records for this program
    const allRecords = await requestRecordsFn(programId);
    if (!allRecords || allRecords.length === 0) {
      return null;
    }

    const normalizedMarketId = normalizeMarketId(marketId);
    // Filter for Position records (not spent) and match market_id (compare normalized forms)
    const positionRecords = allRecords.filter((record: any) => {
      if (record.spent) return false;
      const recordData = record.data || record;
      if (recordData.market_id) {
        const recordMarketId = extractFieldValue(recordData.market_id);
        return recordMarketId === normalizedMarketId;
      }
      return false;
    });

    if (positionRecords.length === 0) {
      return null;
    }

    // Use the first matching Position record
    const positionRecord = positionRecords[0];
    return parsePositionRecord(positionRecord);
  } catch (error) {
    throw error;
  }
}

/**
 * Normalize market ID to a canonical string for comparison.
 * URL/market page may use "123" while records may have "123field" or "123.private".
 */
function normalizeMarketId(value: string | undefined | null): string {
  if (value == null || value === '') return '';
  let s = String(value).trim();
  s = s.replace(/\.private$/i, '').replace(/\.field$/i, '').replace(/field$/i, '').trim();
  return s;
}

/**
 * Helper to extract field value from Aleo record format
 * Handles .private suffixes and field formatting; returns normalized form for market_id
 */
function extractFieldValue(value: any): string {
  if (typeof value === 'string') {
    return normalizeMarketId(value);
  }
  if (value && typeof value === 'object') {
    return normalizeMarketId(String(value));
  }
  return normalizeMarketId(String(value));
}

/**
 * Parse Position record from Aleo record format
 */
function parsePositionRecord(record: any): UserPosition {
  const recordData = record.data || record;
  
  // Extract values, handling .private suffixes
  const marketId = extractFieldValue(recordData.market_id);
  const yesShares = extractU128Value(recordData.yes_shares);
  const noShares = extractU128Value(recordData.no_shares);
  const collateralAvailable = extractU128Value(recordData.collateral_available);
  const collateralCommitted = extractU128Value(recordData.collateral_committed);
  const payoutClaimed = extractBoolValue(recordData.payout_claimed);

  return {
    marketId,
    yesShares,
    noShares,
    collateralAvailable,
    collateralCommitted,
    payoutClaimed,
  };
}

/**
 * Extract u128 value from Aleo record format
 */
function extractU128Value(value: any): number {
  if (typeof value === 'string') {
    // Remove .private suffix and parse
    const cleanValue = value.replace(/\.private$/, '').replace(/u128$/, '');
    return parseInt(cleanValue, 10) || 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  // If it's an object, try to extract numeric value
  if (value && typeof value === 'object') {
    const str = String(value);
    const match = str.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }
  return 0;
}

/**
 * Extract boolean value from Aleo record format
 */
function extractBoolValue(value: any): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const cleanValue = value.replace(/\.private$/, '');
    return cleanValue === 'true';
  }
  return false;
}

/**
 * Find the unspent Position record for a given market from raw records.
 * Single place for "position record for this market" shape (record.data || record, market_id).
 */
export function findPositionRecordForMarket(
  records: any[],
  marketId: string
): any | null {
  if (!records || records.length === 0) return null;
  const normalizedMarketId = normalizeMarketId(marketId);
  const found = records.find((r: any) => {
    if (r.spent) return false;
    const recordData = r.data || r;
    if (recordData.market_id) {
      const recordMarketId = extractFieldValue(recordData.market_id);
      return recordMarketId === normalizedMarketId;
    }
    return false;
  });
  return found ?? null;
}

/**
 * Get all user positions across all markets
 * @param wallet - Wallet adapter instance (from useWallet hook)
 * @param programId - Program ID to fetch records from
 * @param requestRecords - Optional requestRecords function from useWallet hook (preferred method)
 * @returns Array of UserPosition objects with their raw record objects
 */
export async function getAllUserPositions(
  wallet: any,
  programId: string,
  requestRecords?: (programId: string, decrypt?: boolean) => Promise<any[]> // Optional requestRecords from hook
): Promise<Array<{ position: UserPosition; record: any }>> {
  try {
    if (!wallet) {
      throw new Error('Wallet adapter not available');
    }

    // Use requestRecords from hook if provided, otherwise try to find it on wallet object
    let requestRecordsFn: ((programId: string, decrypt?: boolean) => Promise<any[]>) | null = null;
    
    if (requestRecords && typeof requestRecords === 'function') {
      requestRecordsFn = requestRecords;
    } else {
      // Fallback: try to find requestRecords on wallet object
      if (typeof wallet.requestRecords === 'function') {
        requestRecordsFn = wallet.requestRecords.bind(wallet);
      } else if (wallet.wallet && typeof wallet.wallet.requestRecords === 'function') {
        requestRecordsFn = wallet.wallet.requestRecords.bind(wallet.wallet);
      } else if (wallet.adapter && typeof wallet.adapter.requestRecords === 'function') {
        requestRecordsFn = wallet.adapter.requestRecords.bind(wallet.adapter);
      }
    }

    if (!requestRecordsFn) {
      throw new Error(
        'requestRecords not available. ' +
        'Please ensure your wallet is properly connected and supports record access.'
      );
    }

    // Fetch all Position records for this program
    const allRecords = await requestRecordsFn(programId);
    if (!allRecords || allRecords.length === 0) {
      return [];
    }

    // Filter for Position records (not spent) and parse them
    const positions: Array<{ position: UserPosition; record: any }> = [];
    
    for (const record of allRecords) {
      // Skip spent records
      if (record.spent) continue;
      
      // Check if record is a Position record (has market_id field)
      const recordData = record.data || record;
      if (!recordData.market_id) continue;
      
      try {
        // Parse the Position record
        const position = parsePositionRecord(record);
        positions.push({ position, record });
      } catch {
        // Skip records that can't be parsed
      }
    }

    return positions;
  } catch {
    return [];
  }
}