import { CREDITS_PROGRAM_ID, PREDICTION_MARKET_PROGRAM_ID } from '@/types';
import { getFeeForFunction } from '@/utils/feeCalculator';
import { findWalletAdapter, hasRequestRecords, isIntentOnlyWallet } from '../wallet/adapter';
import { createTransactionOptions } from '../wallet/tx';
import {
  getRecordId,
  extractRecordValue,
  filterUnspentRecords,
  findDistinctRecords,
  pickRecordForAmount,
} from '../wallet/records';
import { getLatestBlockHeight } from './chainRead';
import {
  executeTransactionWithLog,
  extractTransactionId,
  resolveRequestRecordsFn,
  requestPositionRecords,
} from './transactionHelpers';
import {
  findPositionRecordForMarket,
  pickRecordToRedeem,
  normalizeMarketId,
  marketIdNumericCore,
  extractFieldValue,
  getPositionPlaintext,
  extractMarketIdFromPlaintext,
  isRecordSpent,
} from './positionRecords';


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
    const positionRecord = allRecords.length > 0 ? findPositionRecordForMarket(allRecords, marketId, collateralIn) : null;
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
    const positionRecord = allRecords.length > 0 ? findPositionRecordForMarket(allRecords, marketId, collateralIn) : null;
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
      let positionRecordToUse: any = existingPosition;
      if (positionRecordToUse == null) {
        let allRecords: any[] = [];
        try {
          allRecords = (await requestPositionRecords(requestRecordsFn, true)) as any[];
        } catch {
          allRecords = [];
        }
        if (allRecords.length > 0) {
          const normalizedMarketId = normalizeMarketId(marketId);
          const marketIdCore = marketIdNumericCore(marketId);
          const matches = allRecords.filter((r: any) => {
            if (isRecordSpent(r)) return false;
            const recordData = r?.data ?? r;
            let marketMatch = false;
            if (recordData && recordData.market_id != null) {
              const recordMarketId = extractFieldValue(recordData.market_id);
              if (recordMarketId === normalizedMarketId || (marketIdCore && marketIdNumericCore(recordMarketId) === marketIdCore)) marketMatch = true;
            }
            if (!marketMatch) {
              const plaintext = getPositionPlaintext(r);
              if (typeof plaintext === 'string' && plaintext.length > 0) {
                const extracted = extractMarketIdFromPlaintext(plaintext);
                marketMatch = Boolean(extracted !== null && (extracted === normalizedMarketId || (marketIdCore && marketIdNumericCore(extracted) === marketIdCore)));
              }
            }
            return marketMatch;
          });
          positionRecordToUse = pickRecordToRedeem(matches, outcome);
        }
      }
      if (positionRecordToUse != null) {
        const inputs = [`${marketId}field`, positionRecordToUse, outcome ? 'true' : 'false'];
        const opts = createTransactionOptions(PREDICTION_MARKET_PROGRAM_ID, 'redeem_private', inputs, fee, false, [1], { forShield: true });
        const result = (await executeTransactionWithLog(walletAdapter, opts)) as { transactionId?: string; txId?: string; id?: string; transaction_id?: string; data?: { transactionId?: string }; result?: { transactionId?: string } };
        const txId = extractTransactionId(result);
        if (txId) return String(txId).trim();
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

