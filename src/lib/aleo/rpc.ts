import { CREDITS_PROGRAM_ID, PREDICTION_MARKET_PROGRAM_ID, MarketState, UserPosition } from '@/types';
import { getFeeForFunction } from '@/utils/feeCalculator';
import { findWalletAdapter, hasRequestRecords, isIntentOnlyWallet } from './wallet/adapter';
import { createTransactionOptions } from './wallet/tx';
import {
  getRecordId,
  areRecordsDistinct,
  extractRecordValue,
  filterUnspentRecords,
  findDistinctRecords,
  pickRecordForAmount,
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
} from './marketRegistry';

/** Log transaction options before and after send to detect if the wallet mutates them. */
async function executeTransactionWithLog(
  walletAdapter: { executeTransaction: (opts: unknown) => Promise<unknown> },
  transactionOptions: { program?: string; function?: string; inputs?: unknown[]; fee?: number; recordIndices?: number[]; privateFee?: boolean }
): Promise<unknown> {
  const beforeSnapshot = {
    program: transactionOptions.program,
    function: transactionOptions.function,
    inputs: transactionOptions.inputs ? [...transactionOptions.inputs] : [],
    inputsLength: transactionOptions.inputs?.length,
    fee: transactionOptions.fee,
    recordIndices: transactionOptions.recordIndices ? [...(transactionOptions.recordIndices)] : undefined,
    privateFee: transactionOptions.privateFee,
  };
  console.log('[Transaction] BEFORE send to wallet:', beforeSnapshot);

  const result = await walletAdapter.executeTransaction(transactionOptions);

  console.log('[Transaction] AFTER send to wallet (options object now):', {
    program: transactionOptions.program,
    function: transactionOptions.function,
    inputs: transactionOptions.inputs,
    inputsLength: transactionOptions.inputs?.length,
    fee: transactionOptions.fee,
    recordIndices: transactionOptions.recordIndices,
    privateFee: transactionOptions.privateFee,
  });

  return result;
}

/** Recursively find first string in obj that starts with "at" (Provable tx id). */
function findAtIdInObject(obj: unknown, depth: number): string | null {
  if (depth <= 0 || obj == null) return null;
  if (typeof obj === 'string') {
    const s = obj.trim();
    return s.startsWith('at') ? s : null;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findAtIdInObject(item, depth - 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof obj === 'object') {
    const o = obj as Record<string, unknown>;
    for (const key of ['id', 'transactionId', 'txId', 'transaction_id']) {
      const found = findAtIdInObject(o[key], depth - 1);
      if (found) return found;
    }
    for (const v of Object.values(o)) {
      const found = findAtIdInObject(v, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

/** Provable Explorer expects transaction IDs in bech32 format (prefix "at"). Prefer "at" id; fallback to any id so the popup always shows. */
function extractTransactionId(result: unknown): string | null {
  if (result == null) return null;
  const candidates: string[] = [];
  const r = result as Record<string, unknown>;
  for (const key of ['transactionId', 'id', 'txId', 'transaction_id']) {
    const v = r[key];
    if (typeof v === 'string' && v.trim()) candidates.push(v.trim());
  }
  const data = r.data as Record<string, unknown> | undefined;
  if (data && typeof data === 'object') {
    for (const key of ['transactionId', 'id', 'txId', 'transaction_id']) {
      const v = data[key];
      if (typeof v === 'string' && v.trim()) candidates.push(v.trim());
    }
  }
  const nested = r.result as Record<string, unknown> | undefined;
  if (nested && typeof nested === 'object') {
    for (const key of ['transactionId', 'id', 'txId', 'transaction_id']) {
      const v = nested[key];
      if (typeof v === 'string' && v.trim()) candidates.push(v.trim());
    }
  }
  const atId = candidates.find((s) => s.startsWith('at'));
  if (atId) return atId;
  const atIdDeep = findAtIdInObject(result, 8);
  if (atIdDeep) return atIdDeep;
  return candidates[0] ?? null;
}

/** Resolve requestRecords from optional param or wallet (adapter, wallet, nested paths). */
function resolveRequestRecordsFn(
  wallet: any,
  requestRecords?: (programId: string, decrypt?: boolean) => Promise<any[]>
): ((programId: string, decrypt?: boolean) => Promise<any[]>) | null {
  if (requestRecords && typeof requestRecords === 'function') {
    return requestRecords;
  }
  if (!wallet || typeof wallet !== 'object') return null;
  const adapter = findWalletAdapter(wallet);
  if (adapter && typeof adapter.requestRecords === 'function') {
    return adapter.requestRecords.bind(adapter);
  }
  if (typeof (wallet as any).requestRecords === 'function') {
    return (wallet as any).requestRecords.bind(wallet);
  }
  if ((wallet as any).wallet && typeof (wallet as any).wallet.requestRecords === 'function') {
    return (wallet as any).wallet.requestRecords.bind((wallet as any).wallet);
  }
  if ((wallet as any).adapter && typeof (wallet as any).adapter.requestRecords === 'function') {
    return (wallet as any).adapter.requestRecords.bind((wallet as any).adapter);
  }
  if ((wallet as any).adapter?.wallet && typeof (wallet as any).adapter.wallet.requestRecords === 'function') {
    return (wallet as any).adapter.wallet.requestRecords.bind((wallet as any).adapter.wallet);
  }
  if ((wallet as any).wallet?.adapter && typeof (wallet as any).wallet.adapter.requestRecords === 'function') {
    return (wallet as any).wallet.adapter.requestRecords.bind((wallet as any).wallet.adapter);
  }
  return null;
}

/** Program ID variants some wallets use for whisper_market Position records. */
const POSITION_PROGRAM_IDS = [PREDICTION_MARKET_PROGRAM_ID, 'whisper_market'] as const;

function normalizeRecordsResponse(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw != null && typeof raw === 'object' && Array.isArray((raw as any).records)) return (raw as any).records;
  if (raw != null) return [raw];
  return [];
}

/**
 * Request Position records from the wallet, trying multiple program ID variants
 * (e.g. "whisper_market.aleo" and "whisper_market") so we get records regardless of wallet naming.
 */
async function requestPositionRecords(
  requestRecordsFn: (programId: string, decrypt?: boolean) => Promise<any[]>,
  decrypt: boolean
): Promise<unknown[]> {
  let combined: unknown[] = [];
  const seen = new Set<string>();
  for (const programId of POSITION_PROGRAM_IDS) {
    try {
      const raw = await requestRecordsFn(programId, decrypt);
      const list = normalizeRecordsResponse(raw);
      for (const r of list) {
        const key = typeof r === 'string' ? r.slice(0, 200) : JSON.stringify(r).slice(0, 200);
        if (!seen.has(key)) {
          seen.add(key);
          combined.push(r);
        }
      }
    } catch {
      // Skip this program ID variant
    }
  }
  return combined;
}

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
} from './marketRegistry';
export { normalizeCreditsRecordInput, redactForLog } from './wallet/recordSanitizer';

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
    [0, 1], // record indices
    { forShield: isIntentOnlyWallet(wallet) }
  );

  const result = await executeTransactionWithLog(walletAdapter, transactionOptions);
  const txId = extractTransactionId(result);
  if (!txId) throw new Error('Transaction failed: No transaction ID returned.');
  return txId;
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

  // Record is normalized to decrypted string (plaintext) for the adapter, same as Leo wallet.
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
    true, // payFeesPrivately — caller must have a second record for the fee
    [0], // record index
    { forShield: isIntentOnlyWallet(wallet) }
  );

  const result = await executeTransactionWithLog(walletAdapter, transactionOptions);
  const txId = extractTransactionId(result);
  if (!txId) throw new Error('Transaction failed: No transaction ID returned.');
  return txId;
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
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) {
    throw new Error('Wallet adapter does not support transaction execution. Please ensure your wallet is connected.');
  }

  const requestRecordsFn = resolveRequestRecordsFn(wallet, requestRecords);
  const saltField = salt.endsWith('field') ? salt : `${salt}field`;
  const fee = getFeeForFunction('init');

  // init() inputs (0-based): 0=initial_liquidity, 1=bond_amount, 2=fee_bps, 3=metadata_hash, 4=salt, 5=credit_record.
  // If an error says "input #5", it may be 1-based (meaning salt at our index 4) or 0-based (meaning record at our index 5).

  // Shield: fetch decrypted records and pass plaintext string; only use intent path when requestRecords unavailable or decrypt fails.
  if (isIntentOnlyWallet(wallet)) {
    if (requestRecordsFn) {
      const feeAmount = getFeeForFunction('init');
      const requiredMicrocredits = bondAmount + initialLiquidity + feeAmount;
      let allRecords: unknown[] | null = null;
      try {
        allRecords = await requestRecordsFn(CREDITS_PROGRAM_ID, true);
      } catch {
        allRecords = null;
      }
      if (allRecords && allRecords.length > 0) {
        let unspentRecords = filterUnspentRecords(allRecords);
        if (unspentRecords.length === 0) {
          unspentRecords = allRecords.map((r) => ({ record: r, value: 1, id: null } as { record: unknown; value: number; id: string | null }));
        }
        const picked = pickRecordForAmount(unspentRecords, requiredMicrocredits);
        if (!picked) {
          const totalKnown = unspentRecords.reduce((sum, r) => sum + r.value, 0);
          const allCiphertext = unspentRecords.every((r) => r.value <= 1);
          if (!allCiphertext) {
            throw new Error(
              `No record with sufficient balance. Need ${(requiredMicrocredits / 1_000_000).toFixed(6)} credits (${requiredMicrocredits} microcredits) including fee; you have ${(totalKnown / 1_000_000).toFixed(6)} credits in unspent records.`
            );
          }
        }
        const chosenRecord = picked ? picked.record : unspentRecords[0].record;
        if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_DEBUG_RECORD_INPUTS === 'true') {
          console.log('[initMarket] Shield record path: using decrypted chosenRecord for input #5');
        }
        const inputs = [
          `${initialLiquidity}u64`,
          `${bondAmount}u64`,
          `${feeBps}u64`,
          `${metadataHash}field`,
          saltField,
          chosenRecord,
        ];
        const transactionOptions = createTransactionOptions(
          PREDICTION_MARKET_PROGRAM_ID,
          'init',
          inputs,
          fee,
          false,
          [5],
          { forShield: true }
        );
        const result = await executeTransactionWithLog(walletAdapter, transactionOptions);
        const transactionId = extractTransactionId(result);
        if (transactionId) return transactionId;
      }
    }
    throw new Error('Unable to fetch credit records. Ensure your wallet supports requestRecords and you have credits.');
  }

  if (!requestRecordsFn || !hasRequestRecords(wallet)) {
    throw new Error('Unable to fetch credit records. Ensure your wallet supports requestRecords and you have credits.');
  }

  const spendAmount = bondAmount + initialLiquidity;
  const feeAmount = getFeeForFunction('init');

  // Request decrypted records so we pass plaintext to executeTransaction (same as Shield / Leo).
  let allRecords: any[];
  try {
    allRecords = await requestRecordsFn(CREDITS_PROGRAM_ID, true);
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

  const hasCiphertextRecords = unspentRecords.some((r) => {
    const x = r.record as Record<string, unknown>;
    const v = x?.recordCiphertext ?? x?.ciphertext ?? x?.record ?? x?.value;
    return typeof v === 'string' && v.startsWith('record') && v.length > 50;
  });

  let records = findDistinctRecords(allRecords, spendAmount, feeAmount);

  if (!records) {
    if (hasCiphertextRecords) {
      if (unspentRecords.length >= 2) {
        records = { spendRecord: unspentRecords[0].record, feeRecord: unspentRecords[1].record };
      } else if (unspentRecords.length === 1) {
        records = null;
      } else {
        throw new Error('No unspent credit records available in wallet.');
      }
    } else {
      const totalSpendNeeded = spendAmount + feeAmount;
      const totalBalance = unspentRecords.reduce((sum, r) => sum + r.value, 0);
      if (totalBalance < totalSpendNeeded) {
        throw new Error(
          `Insufficient balance. Need ${(totalSpendNeeded / 1_000_000).toFixed(6)} credits total ` +
          `(${(spendAmount / 1_000_000).toFixed(6)} for transaction + ${(feeAmount / 1_000_000).toFixed(6)} for fee), ` +
          `but only have ${(totalBalance / 1_000_000).toFixed(6)} credits.`
        );
      }
      if (unspentRecords.length >= 2) {
        records = { spendRecord: unspentRecords[0].record, feeRecord: unspentRecords[1].record };
      } else {
        records = null;
      }
    }
  }

  if (!records) {
    if (unspentRecords.length === 0) throw new Error('No unspent credit records available in wallet.');
    records = { spendRecord: unspentRecords[0].record, feeRecord: unspentRecords[0].record };
  }

  const spendRecordId = getRecordId(records.spendRecord);
  const feeRecordId = getRecordId(records.feeRecord);

  const chainHeight = await getLatestBlockHeight();
  const recordValidation = await preflightRecordValidation(records.spendRecord, spendAmount, publicKey, chainHeight);
  if (!recordValidation.valid) throw new Error(`Preflight validation failed: ${recordValidation.error}`);

  await preflightMarketIdCheck(publicKey, metadataHash, salt);

  const inputs = [
    `${initialLiquidity}u64`,
    `${bondAmount}u64`,
    `${feeBps}u64`,
    `${metadataHash}field`,
    saltField,
    records.spendRecord,
  ];

  const transactionOptions = createTransactionOptions(
    PREDICTION_MARKET_PROGRAM_ID,
    'init',
    inputs,
    fee,
    true,
    [5],
    { forShield: false }
  );

  if (!transactionOptions.program || !transactionOptions.function || !Array.isArray(transactionOptions.inputs)) {
    throw new Error('Transaction options missing required fields');
  }

  try {
    const result = await executeTransactionWithLog(walletAdapter, transactionOptions);
    const transactionId = extractTransactionId(result);
    if (!transactionId) throw new Error('Transaction submitted but no transaction ID returned. Please check your wallet for transaction status.');
    return transactionId;
  } catch (error: any) {
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
        `Input parsing failed: ${error.message}. This usually means the record format is incorrect. Pass the decrypted record as a string (plaintext), like the Leo wallet.`
      );
    }
    if (error.message && (error.message.includes('double') || error.message.includes('already spent') || error.message.includes('consumed'))) {
      throw new Error(
        `Double-spend detected: The wallet may have selected the same record for the fee. spend_record.id: ${spendRecordId}, fee_record.id: ${feeRecordId}. Please ensure you have multiple distinct records.`
      );
    }
    throw error;
  }
}


/**
 * Open position (first-time) - Creates initial Position record.
 * When creditRecord is omitted (e.g. Shield), uses Shield record path or intent path.
 */
export async function openPositionPrivate(
  wallet: any,
  publicKey: string,
  marketId: string,
  creditRecord: string | undefined,
  amount: number,
  statusHint: number = 0,
  requestRecords?: (programId: string, decrypt?: boolean) => Promise<any[]>
): Promise<string> {
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) throw new Error('Wallet adapter does not support transaction execution');

  const amountU64 = Math.floor(Number(amount));
  if (amountU64 < 1 || amountU64 > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Invalid deposit amount: ${amount} microcredits`);
  }

  const fee = getFeeForFunction('open_position_private');

  if (creditRecord != null && !isIntentOnlyWallet(wallet) && hasRequestRecords(wallet)) {
    const inputs = [`${marketId}field`, creditRecord, `${amountU64}u64`, `${statusHint}u8`];
    const transactionOptions = createTransactionOptions(PREDICTION_MARKET_PROGRAM_ID, 'open_position_private', inputs, fee, true, [1], { forShield: false });
    const result = await executeTransactionWithLog(walletAdapter, transactionOptions);
    const txId = extractTransactionId(result);
    if (!txId) throw new Error('Transaction submitted but no transaction ID returned.');
    return txId;
  }

  if (isIntentOnlyWallet(wallet)) {
    const requestRecordsFn = resolveRequestRecordsFn(wallet, requestRecords);
    if (requestRecordsFn) {
      let allRecords: unknown[] | null = null;
      try {
        allRecords = await requestRecordsFn(CREDITS_PROGRAM_ID, true);
      } catch {
        allRecords = null;
      }
      if (allRecords && allRecords.length > 0) {
        const requiredMicrocredits = amountU64 + fee;
        let unspentRecords = filterUnspentRecords(allRecords);
        if (unspentRecords.length === 0) {
          unspentRecords = allRecords.map((r) => ({ record: r, value: 1, id: null } as { record: unknown; value: number; id: string | null }));
        }
        const picked = pickRecordForAmount(unspentRecords, requiredMicrocredits);
        const chosenRecord = picked ? picked.record : unspentRecords[0].record;
        const inputs = [`${marketId}field`, chosenRecord, `${amountU64}u64`, `${statusHint}u8`];
        const transactionOptions = createTransactionOptions(PREDICTION_MARKET_PROGRAM_ID, 'open_position_private', inputs, fee, false, [1], { forShield: true });
        const result = await executeTransactionWithLog(walletAdapter, transactionOptions);
        const txId = extractTransactionId(result);
        if (txId) return txId;
      }
    }
    throw new Error('No credit record available. Refresh records or ensure your wallet supports requestRecords.');
  }

  throw new Error('No credit record available. Refresh records or ensure your wallet supports requestRecords.');
}

/**
 * Deposit private - Adds collateral to existing Position.
 * When creditRecord or existingPosition omitted (e.g. Shield), uses Shield record path or intent path.
 */
export async function depositPrivate(
  wallet: any,
  publicKey: string,
  marketId: string,
  creditRecord: string | undefined,
  amount: number,
  existingPosition: string | undefined,
  statusHint: number = 0,
  requestRecords?: (programId: string, decrypt?: boolean) => Promise<any[]>
): Promise<string> {
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) throw new Error('Wallet adapter does not support transaction execution');

  const amountU64 = Math.floor(Number(amount));
  if (amountU64 < 1 || amountU64 > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Invalid deposit amount: ${amount} microcredits`);
  }

  const fee = getFeeForFunction('deposit_private');

  if (creditRecord != null && existingPosition != null && !isIntentOnlyWallet(wallet) && hasRequestRecords(wallet)) {
    const inputs = [`${marketId}field`, creditRecord, `${amountU64}u64`, existingPosition, `${statusHint}u8`];
    const transactionOptions = createTransactionOptions(PREDICTION_MARKET_PROGRAM_ID, 'deposit_private', inputs, fee, true, [1, 3], { forShield: false });
    const result = await executeTransactionWithLog(walletAdapter, transactionOptions);
    const txId = extractTransactionId(result);
    if (!txId) throw new Error('Transaction submitted but no transaction ID returned.');
    return txId;
  }

  if (isIntentOnlyWallet(wallet)) {
    const requestRecordsFn = resolveRequestRecordsFn(wallet, requestRecords);
    if (requestRecordsFn) {
      let creditRecords: unknown[] | null = null;
      let positionRecords: unknown[] | null = null;
      try {
        creditRecords = await requestRecordsFn(CREDITS_PROGRAM_ID, true);
        positionRecords = await requestPositionRecords(requestRecordsFn, true);
      } catch {
        creditRecords = null;
        positionRecords = null;
      }
      const requiredCredits = amountU64 + fee;
      if (creditRecords && creditRecords.length > 0 && positionRecords && positionRecords.length > 0) {
        let unspentCredits = filterUnspentRecords(creditRecords);
        if (unspentCredits.length === 0) {
          unspentCredits = creditRecords.map((r) => ({ record: r, value: 1, id: null } as { record: unknown; value: number; id: string | null }));
        }
        const pickedCredit = pickRecordForAmount(unspentCredits, requiredCredits);
        const chosenCredit = pickedCredit ? pickedCredit.record : unspentCredits[0].record;
        const positionRecord = findPositionRecordForMarket(positionRecords, marketId);
        if (positionRecord) {
          const inputs = [`${marketId}field`, chosenCredit, `${amountU64}u64`, positionRecord, `${statusHint}u8`];
          const transactionOptions = createTransactionOptions(PREDICTION_MARKET_PROGRAM_ID, 'deposit_private', inputs, fee, false, [1, 3], { forShield: true });
          const result = (await executeTransactionWithLog(walletAdapter, transactionOptions)) as { transactionId?: string; txId?: string; id?: string; transaction_id?: string; data?: { transactionId?: string }; result?: { transactionId?: string } };
          const txId = extractTransactionId(result);
          if (txId) return String(txId).trim();
        }
      }
    }
    throw new Error('No credit or position record available. Add collateral first and refresh records.');
  }

  throw new Error('No credit or position record available. Add collateral first and refresh records.');
}

/**
 * Swap collateral for YES shares using AMM.
 * Same pattern as init/deposit_private: when requestRecords is available, request Position records from whisper_market.aleo (decrypt: true), pass the decrypted record string to the wallet.
 */
export async function swapCollateralForYesPrivate(
  wallet: any,
  publicKey: string,
  marketId: string,
  existingPosition: string | undefined,
  collateralIn: number,
  minYesOut: number,
  yesReserve: number,
  noReserve: number,
  feeBps: number,
  statusHint: number = 0,
  requestRecords?: (programId: string, decrypt?: boolean) => Promise<any[]>
): Promise<string> {
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) throw new Error('Wallet adapter does not support transaction execution');

  const fee = getFeeForFunction('swap_collateral_for_yes_private');
  const requestRecordsFn = resolveRequestRecordsFn(wallet, requestRecords);

  // Same as init/deposit_private: request records from program (whisper_market.aleo), get decrypted record, pass to wallet.
  if (requestRecordsFn) {
    let allRecords: unknown[] = [];
    try {
      allRecords = await requestPositionRecords(requestRecordsFn, true);
    } catch {
      try {
        allRecords = await requestPositionRecords(requestRecordsFn, false);
      } catch {
        allRecords = [];
      }
    }
    const positionRecord = allRecords.length > 0 ? findPositionRecordForMarket(allRecords, marketId) : null;
    if (positionRecord) {
      const inputs = [
        `${marketId}field`,
        positionRecord,
        `${collateralIn}u64`,
        `${minYesOut}u128`,
        `${yesReserve}u128`,
        `${noReserve}u128`,
        `${feeBps}u64`,
        `${statusHint}u8`,
      ];
      const opts = createTransactionOptions(PREDICTION_MARKET_PROGRAM_ID, 'swap_collateral_for_yes_private', inputs, fee, false, [1], { forShield: isIntentOnlyWallet(wallet) });
      const result = (await executeTransactionWithLog(walletAdapter, opts)) as { transactionId?: string; txId?: string; id?: string; transaction_id?: string; data?: { transactionId?: string }; result?: { transactionId?: string } };
      const txId = extractTransactionId(result);
      if (txId) return String(txId).trim();
    }
    // When wallet returned records but none matched: fall through to use existingPosition from page if available.
  }

  // Fallback: use position record from app state (e.g. from "Refresh records" or when wallet returns a different record shape).
  if (existingPosition != null) {
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
    const opts = createTransactionOptions(PREDICTION_MARKET_PROGRAM_ID, 'swap_collateral_for_yes_private', inputs, fee, true, [1], { forShield: isIntentOnlyWallet(wallet) });
    const result = (await executeTransactionWithLog(walletAdapter, opts)) as { transactionId?: string; txId?: string; id?: string; transaction_id?: string; data?: { transactionId?: string }; result?: { transactionId?: string } };
    const txId = extractTransactionId(result);
    if (!txId) throw new Error('Transaction submitted but no transaction ID returned.');
    return txId;
  }

  throw new Error('No position record for this market. Add collateral first, then refresh records and try again.');
}

/**
 * Swap collateral for NO shares using AMM.
 * Same pattern as init/deposit_private: when requestRecords is available, request Position records from whisper_market.aleo (decrypt: true), pass the decrypted record string to the wallet.
 */
export async function swapCollateralForNoPrivate(
  wallet: any,
  publicKey: string,
  marketId: string,
  existingPosition: string | undefined,
  collateralIn: number,
  minNoOut: number,
  yesReserve: number,
  noReserve: number,
  feeBps: number,
  statusHint: number = 0,
  requestRecords?: (programId: string, decrypt?: boolean) => Promise<any[]>
): Promise<string> {
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) throw new Error('Wallet adapter does not support transaction execution');

  const fee = getFeeForFunction('swap_collateral_for_no_private');
  const requestRecordsFn = resolveRequestRecordsFn(wallet, requestRecords);

  // Request Position records (try whisper_market.aleo and whisper_market), match by market_id in plaintext.
  if (requestRecordsFn) {
    let allRecords: unknown[] = [];
    try {
      allRecords = await requestPositionRecords(requestRecordsFn, true);
    } catch {
      try {
        allRecords = await requestPositionRecords(requestRecordsFn, false);
      } catch {
        allRecords = [];
      }
    }
    const positionRecord = allRecords.length > 0 ? findPositionRecordForMarket(allRecords, marketId) : null;
    if (positionRecord) {
      const inputs = [
        `${marketId}field`,
        positionRecord,
        `${collateralIn}u64`,
        `${minNoOut}u128`,
        `${yesReserve}u128`,
        `${noReserve}u128`,
        `${feeBps}u64`,
        `${statusHint}u8`,
      ];
      const opts = createTransactionOptions(PREDICTION_MARKET_PROGRAM_ID, 'swap_collateral_for_no_private', inputs, fee, false, [1], { forShield: isIntentOnlyWallet(wallet) });
      const result = (await executeTransactionWithLog(walletAdapter, opts)) as { transactionId?: string; txId?: string; id?: string; transaction_id?: string; data?: { transactionId?: string }; result?: { transactionId?: string } };
      const txId = extractTransactionId(result);
      if (txId) return String(txId).trim();
    }
    // When wallet returned records but none matched: fall through to use existingPosition from page if available.
  }

  // Fallback: use position record from app state (e.g. from "Refresh records" or when wallet returns a different record shape).
  if (existingPosition != null) {
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
    const opts = createTransactionOptions(PREDICTION_MARKET_PROGRAM_ID, 'swap_collateral_for_no_private', inputs, fee, true, [1], { forShield: isIntentOnlyWallet(wallet) });
    const result = (await executeTransactionWithLog(walletAdapter, opts)) as { transactionId?: string; txId?: string; id?: string; transaction_id?: string; data?: { transactionId?: string }; result?: { transactionId?: string } };
    const txId = extractTransactionId(result);
    if (!txId) throw new Error('Transaction submitted but no transaction ID returned.');
    return txId;
  }

  throw new Error('No position record for this market. Add collateral first, then refresh records and try again.');
}

/**
 * Merge tokens to collateral (pre-resolution exit).
 * When existingPosition omitted (e.g. Shield), uses Shield record path or intent path.
 */
export async function mergeTokensPrivate(
  wallet: any,
  publicKey: string,
  marketId: string,
  existingPosition: string | undefined,
  mergeAmount: number,
  minCollateralOut: number,
  requestRecords?: (programId: string, decrypt?: boolean) => Promise<any[]>
): Promise<string> {
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) throw new Error('Wallet adapter does not support transaction execution');

  const fee = getFeeForFunction('merge_tokens_private');

  if (existingPosition != null && !isIntentOnlyWallet(wallet) && hasRequestRecords(wallet)) {
    const inputs = [`${marketId}field`, existingPosition, `${mergeAmount}u128`, `${minCollateralOut}u64`];
    const opts = createTransactionOptions(PREDICTION_MARKET_PROGRAM_ID, 'merge_tokens_private', inputs, fee, true, [1], { forShield: false });
    const result = (await executeTransactionWithLog(walletAdapter, opts)) as { transactionId?: string; txId?: string; id?: string; transaction_id?: string; data?: { transactionId?: string }; result?: { transactionId?: string } };
    const txId = extractTransactionId(result);
    if (!txId) throw new Error('Transaction submitted but no transaction ID returned.');
    return txId;
  }

  if (isIntentOnlyWallet(wallet)) {
    const requestRecordsFn = resolveRequestRecordsFn(wallet, requestRecords);
    if (requestRecordsFn) {
      let allRecords: unknown[] = [];
      try {
        allRecords = await requestPositionRecords(requestRecordsFn, true);
      } catch {
        allRecords = [];
      }
      if (allRecords.length > 0) {
        const positionRecord = findPositionRecordForMarket(allRecords, marketId);
        if (positionRecord) {
          const inputs = [`${marketId}field`, positionRecord, `${mergeAmount}u128`, `${minCollateralOut}u64`];
          const opts = createTransactionOptions(PREDICTION_MARKET_PROGRAM_ID, 'merge_tokens_private', inputs, fee, false, [1], { forShield: true });
          const result = (await executeTransactionWithLog(walletAdapter, opts)) as { transactionId?: string; txId?: string; id?: string; transaction_id?: string; data?: { transactionId?: string }; result?: { transactionId?: string } };
          const txId = extractTransactionId(result);
          if (txId) return String(txId).trim();
        }
      }
    }
    throw new Error('No position record for this market. Add collateral first, then refresh records and try again.');
  }

  if (existingPosition == null) {
    throw new Error('No position record for this market. Add collateral first, then refresh records and try again.');
  }
  const inputs = [`${marketId}field`, existingPosition, `${mergeAmount}u128`, `${minCollateralOut}u64`];
  const opts = createTransactionOptions(PREDICTION_MARKET_PROGRAM_ID, 'merge_tokens_private', inputs, fee, true, [1], { forShield: isIntentOnlyWallet(wallet) });
  const result = (await executeTransactionWithLog(walletAdapter, opts)) as { transactionId?: string; txId?: string; id?: string; transaction_id?: string; data?: { transactionId?: string }; result?: { transactionId?: string } };
  const txId = extractTransactionId(result);
    if (!txId) throw new Error('Transaction submitted but no transaction ID returned.');
    return txId;
}

/**
 * Withdraw private - Withdraws available collateral (only if no shares held).
 * When existingPosition omitted (e.g. Shield), uses Shield record path or intent path.
 */
export async function withdrawPrivate(
  wallet: any,
  publicKey: string,
  marketId: string,
  existingPosition: string | undefined,
  amount: number,
  requestRecords?: (programId: string, decrypt?: boolean) => Promise<any[]>
): Promise<string> {
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) throw new Error('Wallet adapter does not support transaction execution');

  const fee = getFeeForFunction('withdraw_private');

  if (existingPosition != null && !isIntentOnlyWallet(wallet) && hasRequestRecords(wallet)) {
    const inputs = [`${marketId}field`, existingPosition, `${amount}u64`];
    const opts = createTransactionOptions(PREDICTION_MARKET_PROGRAM_ID, 'withdraw_private', inputs, fee, true, [1], { forShield: false });
    const result = (await executeTransactionWithLog(walletAdapter, opts)) as { transactionId?: string; txId?: string; id?: string; transaction_id?: string; data?: { transactionId?: string }; result?: { transactionId?: string } };
    const txId = extractTransactionId(result);
    if (!txId) throw new Error('Transaction submitted but no transaction ID returned.');
    return txId;
  }

  if (isIntentOnlyWallet(wallet)) {
    const requestRecordsFn = resolveRequestRecordsFn(wallet, requestRecords);
    if (requestRecordsFn) {
      let allRecords: unknown[] = [];
      try {
        allRecords = await requestPositionRecords(requestRecordsFn, true);
      } catch {
        allRecords = [];
      }
      if (allRecords.length > 0) {
        const positionRecord = findPositionRecordForMarket(allRecords, marketId);
        if (positionRecord) {
          const inputs = [`${marketId}field`, positionRecord, `${amount}u64`];
          const opts = createTransactionOptions(PREDICTION_MARKET_PROGRAM_ID, 'withdraw_private', inputs, fee, false, [1], { forShield: true });
          const result = (await executeTransactionWithLog(walletAdapter, opts)) as { transactionId?: string; txId?: string; id?: string; transaction_id?: string; data?: { transactionId?: string }; result?: { transactionId?: string } };
          const txId = extractTransactionId(result);
          if (txId) return String(txId).trim();
        }
      }
    }
    throw new Error('No position record for this market. Refresh records and try again.');
  }

  if (existingPosition == null) {
    throw new Error('No position record for this market. Refresh records and try again.');
  }
  const inputs = [`${marketId}field`, existingPosition, `${amount}u64`];
  const opts = createTransactionOptions(PREDICTION_MARKET_PROGRAM_ID, 'withdraw_private', inputs, fee, true, [1], { forShield: isIntentOnlyWallet(wallet) });
  const result = (await executeTransactionWithLog(walletAdapter, opts)) as { transactionId?: string; txId?: string; id?: string; transaction_id?: string; data?: { transactionId?: string }; result?: { transactionId?: string } };
  const txId = extractTransactionId(result);
    if (!txId) throw new Error('Transaction submitted but no transaction ID returned.');
    return txId;
}

/**
 * Redeem private - Redeems winning shares after market resolution.
 * When existingPosition omitted (e.g. Shield), uses Shield record path or intent path.
 */
export async function redeemPrivate(
  wallet: any,
  publicKey: string,
  marketId: string,
  existingPosition: string | undefined,
  outcome: boolean,
  requestRecords?: (programId: string, decrypt?: boolean) => Promise<any[]>
): Promise<string> {
  const walletAdapter = findWalletAdapter(wallet);
  if (!walletAdapter) throw new Error('Wallet adapter does not support transaction execution');

  const fee = getFeeForFunction('redeem_private');

  if (existingPosition != null && !isIntentOnlyWallet(wallet) && hasRequestRecords(wallet)) {
    const inputs = [`${marketId}field`, existingPosition, outcome ? 'true' : 'false'];
    const opts = createTransactionOptions(PREDICTION_MARKET_PROGRAM_ID, 'redeem_private', inputs, fee, true, [1], { forShield: false });
    const result = (await executeTransactionWithLog(walletAdapter, opts)) as { transactionId?: string; txId?: string; id?: string; transaction_id?: string; data?: { transactionId?: string }; result?: { transactionId?: string } };
    const txId = extractTransactionId(result);
    if (!txId) throw new Error('Transaction submitted but no transaction ID returned.');
    return txId;
  }

  if (isIntentOnlyWallet(wallet)) {
    const requestRecordsFn = resolveRequestRecordsFn(wallet, requestRecords);
    if (requestRecordsFn) {
      let allRecords: unknown[] = [];
      try {
        allRecords = await requestPositionRecords(requestRecordsFn, true);
      } catch {
        allRecords = [];
      }
      if (allRecords.length > 0) {
        const positionRecord = findPositionRecordForMarket(allRecords, marketId);
        if (positionRecord) {
          const inputs = [`${marketId}field`, positionRecord, outcome ? 'true' : 'false'];
          const opts = createTransactionOptions(PREDICTION_MARKET_PROGRAM_ID, 'redeem_private', inputs, fee, false, [1], { forShield: true });
          const result = (await executeTransactionWithLog(walletAdapter, opts)) as { transactionId?: string; txId?: string; id?: string; transaction_id?: string; data?: { transactionId?: string }; result?: { transactionId?: string } };
          const txId = extractTransactionId(result);
          if (txId) return String(txId).trim();
        }
      }
    }
    throw new Error('No position record for this market. Refresh records and try again.');
  }

  if (existingPosition == null) {
    throw new Error('No position record for this market. Refresh records and try again.');
  }
  const inputs = [`${marketId}field`, existingPosition, outcome ? 'true' : 'false'];
  const opts = createTransactionOptions(PREDICTION_MARKET_PROGRAM_ID, 'redeem_private', inputs, fee, true, [1], { forShield: isIntentOnlyWallet(wallet) });
  const result = (await executeTransactionWithLog(walletAdapter, opts)) as { transactionId?: string; txId?: string; id?: string; transaction_id?: string; data?: { transactionId?: string }; result?: { transactionId?: string } };
  const txId = extractTransactionId(result);
    if (!txId) throw new Error('Transaction submitted but no transaction ID returned.');
    return txId;
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

  const result = await executeTransactionWithLog(walletAdapter, transactionOptions);
  const txId = extractTransactionId(result);
  if (!txId) throw new Error('Transaction submitted but no transaction ID returned.');
  return txId;
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

  const result = await executeTransactionWithLog(walletAdapter, transactionOptions);
  const txId = extractTransactionId(result);
  if (!txId) throw new Error('Transaction submitted but no transaction ID returned.');
  return txId;
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

  const result = await executeTransactionWithLog(walletAdapter, transactionOptions);
  const txId = extractTransactionId(result);
  if (!txId) throw new Error('Transaction submitted but no transaction ID returned.');
  return txId;
}

const MARKET_STATE_CACHE_TTL_MS = 45 * 1000; // 45 seconds
const marketStateCache = new Map<string, { data: MarketState; timestamp: number }>();

/**
 * Clear the getMarketState cache. Call after refresh or when market state may have changed.
 */
export function clearMarketStateCache(): void {
  marketStateCache.clear();
}

/**
 * Get market state (AMM-based). Cached per marketId for 45 seconds to reduce API load.
 * @param marketId - Field-based market ID
 */
export async function getMarketState(marketId: string): Promise<MarketState> {
  const cached = marketStateCache.get(marketId);
  if (cached && Date.now() - cached.timestamp < MARKET_STATE_CACHE_TTL_MS) {
    return cached.data;
  }

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
      // Read from market_outcome (canonical mapping; same one used by redeem_private and shown on chain)
      let outcomeValue = await fetchMarketMappingValueString('market_outcome', marketId);
      // Strip quotes and Aleo type suffixes (e.g. ".private") that the API may return
      outcomeValue = outcomeValue.trim().replace(/^["']|["']$/g, '').replace(/\.(private|public)$/i, '').trim();
      const raw = outcomeValue.toLowerCase();
      outcome = raw === 'true' || raw === '1';
    } catch {
      // Market not resolved yet
      outcome = null;
    }

    // isPaused is derived from status (status === 2 means paused)
    const isPaused = Number(status) === 2;

    const state: MarketState = {
      status: Number(status),
      outcome,
      priceYes: Number(priceYes),
      collateralPool: Number(collateralPool),
      yesReserve: Number(yesReserve),
      noReserve: Number(noReserve),
      feeBps: Number(feeBps),
      isPaused,
    };
    marketStateCache.set(marketId, { data: state, timestamp: Date.now() });
    return state;
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
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/\.private$/i, '').replace(/\.field$/i, '').replace(/field$/i, '').trim();
  return s;
}

/** Numeric core of a market ID for flexible matching (e.g. "5099...5667field" and "5099...5667" match). */
function marketIdNumericCore(value: string | undefined | null): string {
  if (value == null || value === '') return '';
  const s = String(value).trim();
  const match = s.match(/\d+/);
  return match ? match[0] : s;
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
 * Parse Position record from Aleo record format.
 * Supports (1) object with top-level market_id, yes_shares, etc. and (2) chain/indexer shape with recordPlaintext string.
 */
function parsePositionRecord(record: any): UserPosition {
  const recordData = record?.data ?? record;
  const plaintext = getPositionPlaintext(record);

  // Chain/indexer or string shape: plaintext contains the full struct string
  if (typeof plaintext === 'string' && plaintext.length > 0 && extractMarketIdFromPlaintext(plaintext) !== null) {
    return parsePositionFromPlaintext(plaintext);
  }

  // Object shape: top-level or record.data fields
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
 * Extract u128 value from Aleo record format.
 * Handles: "15000000u128.private", "15000000u128", "\"15000000u128\"", 15000000.
 */
function extractU128Value(value: any): number {
  if (typeof value === 'string') {
    let s = value.trim().replace(/^["']|["']$/g, '').replace(/\.private/gi, '').replace(/u128/gi, '').trim();
    const match = s.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  }
  if (typeof value === 'number') {
    return value;
  }
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
/** Extract market_id from plaintext string (e.g. "market_id: 123field", "market_id: 123field.private", or JSON-like "market_id": "123field"). */
function extractMarketIdFromPlaintext(plaintext: string): string | null {
  if (!plaintext || typeof plaintext !== 'string') return null;
  // Leo struct style: market_id: 11277985945263598566field.private
  let m = plaintext.match(/market_id\s*:\s*([^\s,}\]"']+)/);
  if (m) return normalizeMarketId(m[1]);
  // Quoted value: market_id: "11277985945263598566field" or "market_id": "11277985945263598566field"
  m = plaintext.match(/market_id\s*:\s*["']([^"']+)["']/);
  if (m) return normalizeMarketId(m[1]);
  m = plaintext.match(/"market_id"\s*:\s*["']?([^"',}\s]+)/);
  if (m) return normalizeMarketId(m[1]);
  // Fallback: any occurrence of market_id followed by something that looks like a field (digits + optional "field")
  m = plaintext.match(/market_id\s*:\s*(\d+[^\s,}\]]*)/);
  if (m) return normalizeMarketId(m[1]);
  return null;
}

/** Extract value for a key from plaintext struct (e.g. "yes_shares: 0u128.private" -> "0u128.private"). Stops at comma, newline, or closing brace. */
function extractValueFromPlaintext(plaintext: string, key: string): string | null {
  if (!plaintext || typeof plaintext !== 'string') return null;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = plaintext.match(new RegExp(`${escaped}\\s*:\\s*([^,\\n}\\]]+)`, 'm'));
  if (!m) return null;
  return m[1].trim().replace(/\s*[})\]]\s*$/, '').trim();
}

/** Parse Position from chain/indexer record plaintext (recordPlaintext string). */
function parsePositionFromPlaintext(plaintext: string): UserPosition {
  const marketId = extractMarketIdFromPlaintext(plaintext) ?? '';
  const yesSharesStr = extractValueFromPlaintext(plaintext, 'yes_shares');
  const noSharesStr = extractValueFromPlaintext(plaintext, 'no_shares');
  const collateralAvailableStr = extractValueFromPlaintext(plaintext, 'collateral_available');
  const collateralCommittedStr = extractValueFromPlaintext(plaintext, 'collateral_committed');
  const payoutClaimedStr = extractValueFromPlaintext(plaintext, 'payout_claimed');
  return {
    marketId,
    yesShares: yesSharesStr != null ? extractU128Value(yesSharesStr) : 0,
    noShares: noSharesStr != null ? extractU128Value(noSharesStr) : 0,
    collateralAvailable: collateralAvailableStr != null ? extractU128Value(collateralAvailableStr) : 0,
    collateralCommitted: collateralCommittedStr != null ? extractU128Value(collateralCommittedStr) : 0,
    payoutClaimed: payoutClaimedStr != null ? extractBoolValue(payoutClaimedStr) : false,
  };
}

/** Keys that may hold the decrypted plaintext string (wallet/chain shape). */
const POSITION_PLAINTEXT_KEYS = [
  'recordPlaintext',
  'record_plaintext',
  'plaintext',
  'record',
  'value',
  'decryptedRecord',
  'decrypted',
  'data',
];

/**
 * Get the plaintext string from a single record (wallet may return object with plaintext key or the raw string).
 */
function getPositionPlaintext(r: any): string | undefined {
  if (typeof r === 'string' && r.trim().length > 0) return r.trim();
  const recordData = r?.data ?? r;
  if (typeof recordData === 'string' && recordData.trim().length > 0) return recordData.trim();
  for (const key of POSITION_PLAINTEXT_KEYS) {
    const val = recordData?.[key] ?? (r as any)?.[key];
    if (typeof val === 'string' && val.length > 0) return val;
  }
  return undefined;
}

export function findPositionRecordForMarket(
  records: any[],
  marketId: string
): any | null {
  if (!records || records.length === 0) return null;
  const normalizedMarketId = normalizeMarketId(marketId);
  const marketIdCore = marketIdNumericCore(marketId);
  const found = records.find((r: any) => {
    if (r != null && r.spent === true) return false;
    const recordData = r?.data ?? r;
    if (recordData && recordData.market_id != null) {
      const recordMarketId = extractFieldValue(recordData.market_id);
      if (recordMarketId === normalizedMarketId) return true;
      if (marketIdCore && marketIdNumericCore(recordMarketId) === marketIdCore) return true;
    }
    const plaintext = getPositionPlaintext(r);
    if (typeof plaintext === 'string' && plaintext.length > 0) {
      const extracted = extractMarketIdFromPlaintext(plaintext);
      if (extracted !== null && extracted === normalizedMarketId) return true;
      if (extracted !== null && marketIdCore && marketIdNumericCore(extracted) === marketIdCore) return true;
    }
    return false;
  });
  return found ?? null;
}

/**
 * Get all user positions across all markets.
 *
 * How positions and unspent collateral are calculated:
 * 1. Request Position records from the wallet (whisper_market.aleo and whisper_market).
 * 2. For each unspent record (spent !== true), parse it via parsePositionRecord:
 *    - Plaintext path: if record has plaintext (recordPlaintext, plaintext, or raw string), we extract
 *      market_id, collateral_available, collateral_committed, yes_shares, no_shares, payout_claimed
 *      using regexes that match Leo struct style (e.g. "collateral_available: 15000000u128.private").
 *    - Object path: if record has top-level data (record.data or record) with those field names, we read them directly.
 * 3. We return one entry per record (no aggregation). Each position has the values from that single record.
 *
 * We aggregate by marketId: total unspent collateral and YES/NO shares are the sum across all
 * unspent Position records for that market. One entry per market with aggregated position; we attach
 * the first record for that market for use as existingPosition in transactions.
 *
 * @param wallet - Wallet adapter instance (from useWallet hook)
 * @param programId - Program ID to fetch records from
 * @param requestRecords - Optional requestRecords function from useWallet hook (preferred method)
 * @returns Array of { position: UserPosition, record } — one entry per market, position = summed values
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

    let requestRecordsFn: ((programId: string, decrypt?: boolean) => Promise<any[]>) | null = null;
    if (requestRecords && typeof requestRecords === 'function') {
      requestRecordsFn = requestRecords;
    } else {
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

    let allRecords: any[] = [];
    const usePositionHelper = programId === PREDICTION_MARKET_PROGRAM_ID || programId === 'whisper_market';
    try {
      allRecords = usePositionHelper
        ? await requestPositionRecords(requestRecordsFn, true)
        : normalizeRecordsResponse(await requestRecordsFn(programId, true));
    } catch {
      try {
        allRecords = usePositionHelper
          ? await requestPositionRecords(requestRecordsFn, false)
          : normalizeRecordsResponse(await requestRecordsFn(programId, false));
      } catch {
        allRecords = [];
      }
    }
    if (!allRecords || allRecords.length === 0) {
      return [];
    }

    // Parse all unspent Position records, then aggregate by marketId so total collateral and shares sum correctly.
    const byMarket = new Map<string, { position: UserPosition; records: any[] }>();

    for (const record of allRecords) {
      if (record != null && record.spent === true) continue;

      const recordData = record?.data ?? record;
      const plaintext = getPositionPlaintext(record);
      const hasMarketIdDirect = recordData && recordData.market_id != null;
      const hasMarketIdInPlaintext = typeof plaintext === 'string' && extractMarketIdFromPlaintext(plaintext) !== null;
      if (!hasMarketIdDirect && !hasMarketIdInPlaintext) continue;

      try {
        const position = parsePositionRecord(record);
        const existing = byMarket.get(position.marketId);
        if (existing) {
          existing.position.collateralAvailable += position.collateralAvailable;
          existing.position.collateralCommitted += position.collateralCommitted;
          existing.position.yesShares += position.yesShares;
          existing.position.noShares += position.noShares;
          if (position.payoutClaimed) existing.position.payoutClaimed = true;
          existing.records.push(record);
        } else {
          byMarket.set(position.marketId, {
            position: { ...position },
            records: [record],
          });
        }
      } catch {
        // Skip records that can't be parsed
      }
    }

    return Array.from(byMarket.entries()).map(([, { position, records }]) => ({
      position,
      record: records[0],
    }));
  } catch {
    return [];
  }
}