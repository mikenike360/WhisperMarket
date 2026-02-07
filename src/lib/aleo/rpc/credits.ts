import { CREDITS_PROGRAM_ID } from '@/types';
import { getFeeForFunction } from '@/utils/feeCalculator';
import { client } from './client';
import { findWalletAdapter, isIntentOnlyWallet } from '../wallet/adapter';
import { createTransactionOptions } from '../wallet/tx';
import { executeTransactionWithLog, extractTransactionId } from './transactionHelpers';

/**
 * Transfer credits publicly between two accounts.
 */
export async function transferPublic(
  recipient: string,
  amount: string
): Promise<string> {
  const inputs = [
    `${recipient}.public`,
    `${amount}u64`,
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
 */
export async function transferPrivate(
  senderRecord: string,
  recipient: string,
  amount: string
): Promise<{ recipientRecord: string; senderRecord: string }> {
  const inputs = [
    `${senderRecord}`,
    `${recipient}.private`,
    `${amount}u64.private`,
  ];

  const result = await client.request('executeTransition', {
    programId: CREDITS_PROGRAM_ID,
    functionName: 'transfer_private',
    inputs,
  });

  if (!result.transactionId) {
    throw new Error('Transaction failed: No transactionId returned.');
  }

  return {
    recipientRecord: result.outputs[0],
    senderRecord: result.outputs[1],
  };
}

/**
 * Join two credit records into one
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

  const inputs = [record1, record2];
  const fee = getFeeForFunction('join');
  const transactionOptions = createTransactionOptions(
    CREDITS_PROGRAM_ID,
    'join',
    inputs,
    fee,
    true,
    [0, 1],
    { forShield: isIntentOnlyWallet(wallet) }
  );

  const result = await executeTransactionWithLog(walletAdapter, transactionOptions);
  const txId = extractTransactionId(result);
  if (!txId) throw new Error('Transaction failed: No transaction ID returned.');
  return txId;
}

/**
 * Combine multiple credit records into one by joining them iteratively
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
    currentRecord = records[i];
  }

  return transactionIds;
}
