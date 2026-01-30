/**
 * Read-only chain queries: mappings, program fetch, tx status, block height.
 * Single source of truth for RPC client is ../client.
 * Mapping reads use AleoScan API (more reliable), transaction operations use JSON-RPC.
 */
import { client, getClient } from './client';
import { PREDICTION_MARKET_PROGRAM_ID, CURRENT_RPC_URL } from '@/types';
import { getMappingValueFromAleoScan } from './aleoscanClient';

export async function getMarketInitTransactions(
  page = 0,
  maxTransactions = 100
) {
  return client.request('aleoTransactionsForProgram', {
    programId: PREDICTION_MARKET_PROGRAM_ID,
    functionName: 'init',
    page,
    maxTransactions,
  });
}

export async function getLatestBlockHeight(): Promise<number> {
  try {
    const response = await client.request('latestHeight', {});
    return parseInt(String(response), 10) || 0;
  } catch {
    return 0;
  }
}

export async function checkTransactionStatus(transactionId: string): Promise<void> {
  try {
    await client.request('getTransactionStatus', {
      id: transactionId,
    });
  } catch {
    // Transaction not yet on chain
  }
}

export async function waitForTransactionToFinalize(
  transactionId: string
): Promise<boolean> {
  const maxRetries = 30;
  const delay = 1000;
  let retries = 0;
  while (retries < maxRetries) {
    try {
      const status = await client.request('getTransactionStatus', {
        id: transactionId,
      });
      if (status === 'finalized') {
        return true;
      }
    } catch {
      // Not yet on chain, retry
    }
    retries++;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return false;
}

async function getDeploymentTransaction(programId: string): Promise<unknown> {
  const response = await fetch(
    `${CURRENT_RPC_URL}find/transactionID/deployment/${programId}`
  );
  const deployTxId = await response.json();
  const txResponse = await fetch(
    `${CURRENT_RPC_URL}transaction/${deployTxId}`
  );
  return txResponse.json();
}

export async function getVerifyingKey(
  programId: string,
  functionName: string
): Promise<string> {
  const deploymentTx = (await getDeploymentTransaction(programId)) as {
    deployment: { verifying_keys: [string, unknown[]][] };
  };
  const allVerifyingKeys = deploymentTx.deployment.verifying_keys;
  const entry = allVerifyingKeys.find((vk) => vk[0] === functionName);
  if (!entry) throw new Error(`Verifying key not found for ${functionName}`);
  return entry[1][0] as string;
}

export async function getProgram(programId: string, apiUrl: string): Promise<string> {
  const rpcClient = getClient(apiUrl);
  const program = await rpcClient.request('program', { id: programId });
  return program as string;
}

export async function fetchMarketMappingValue(
  mappingName: string,
  key: string
): Promise<number> {
  try {
    // Use AleoScan API for mapping reads
    const value = await getMappingValueFromAleoScan(
      PREDICTION_MARKET_PROGRAM_ID,
      mappingName,
      `${key}field`
    );
    
    if (value === null) {
      throw new Error(`Mapping ${mappingName} not found or program not deployed`);
    }
    
    // AleoScan returns values with type suffixes like "1u64" or quoted strings
    // Extract the numeric part by removing quotes, type suffixes, and whitespace
    let cleanValue = String(value).trim();
    // Remove surrounding quotes if present
    if ((cleanValue.startsWith('"') && cleanValue.endsWith('"')) || 
        (cleanValue.startsWith("'") && cleanValue.endsWith("'"))) {
      cleanValue = cleanValue.slice(1, -1);
    }
    // Remove type suffixes (u64, u128, field, etc.)
    cleanValue = cleanValue.replace(/(u\d+|field|private|public)$/i, '').trim();
    
    const numValue = parseInt(cleanValue, 10);
    if (isNaN(numValue)) {
      throw new Error(`Invalid numeric value for mapping ${mappingName}[${key}]: ${value} (cleaned: ${cleanValue})`);
    }
    
    return numValue;
  } catch (error: unknown) {
    throw error;
  }
}

export async function fetchMarketMappingValueString(
  mappingName: string,
  key: string
): Promise<string> {
  try {
    // Use AleoScan API for mapping reads
    const value = await getMappingValueFromAleoScan(
      PREDICTION_MARKET_PROGRAM_ID,
      mappingName,
      `${key}field`
    );
    
    if (value === null) {
      throw new Error(`Mapping ${mappingName} not found or program not deployed`);
    }
    
    return value;
  } catch (error: unknown) {
    throw error;
  }
}

/**
 * Get total number of markets from total_markets mapping
 * Returns 0 if the mapping doesn't exist (no markets created yet)
 */
export async function getTotalMarketsCount(): Promise<number> {
  try {
    // Use AleoScan API for mapping reads
    const value = await getMappingValueFromAleoScan(
      PREDICTION_MARKET_PROGRAM_ID,
      'total_markets',
      '0u64' // total_markets[0u64] stores the count
    );
    
    if (value === null) return 0;

    // AleoScan returns values with type suffixes like "1u64" or quoted strings like '"1u64"'
    // Extract the numeric part by removing quotes, type suffixes (u64, u128, field, etc.), and whitespace
    let cleanValue = String(value).trim();
    // Remove surrounding quotes if present
    if ((cleanValue.startsWith('"') && cleanValue.endsWith('"')) || 
        (cleanValue.startsWith("'") && cleanValue.endsWith("'"))) {
      cleanValue = cleanValue.slice(1, -1);
    }
    // Remove type suffixes (u64, u128, field, etc.)
    cleanValue = cleanValue.replace(/(u\d+|field|private|public)$/i, '').trim();
    
    const count = parseInt(cleanValue, 10);
    return isNaN(count) ? 0 : count;
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    const isMappingNotFound = errorMessage.includes('not found') || 
                              errorMessage.includes('does not exist') ||
                              errorMessage.includes('Mapping not found');
    if (isMappingNotFound) return 0;
    return 0;
  }
}

/**
 * Get market ID at specific index from market_index mapping
 * Returns null if the mapping doesn't exist at that index
 */
export async function getMarketIdAtIndex(index: number): Promise<string | null> {
  try {
    // Use AleoScan API for mapping reads
    const value = await getMappingValueFromAleoScan(
      PREDICTION_MARKET_PROGRAM_ID,
      'market_index',
      `${index}u64`
    );
    
    if (value === null) return null;
    
    // AleoScan returns values with type suffixes like "5876945607271027451885340988094905867884195093098210518443342717670717944265field"
    // or quoted strings like '"5876945607271027451885340988094905867884195093098210518443342717670717944265field"'
    let cleanValue = String(value).trim();
    // Remove surrounding quotes if present
    if ((cleanValue.startsWith('"') && cleanValue.endsWith('"')) || 
        (cleanValue.startsWith("'") && cleanValue.endsWith("'"))) {
      cleanValue = cleanValue.slice(1, -1);
    }
    // Remove 'field' suffix if present
    return cleanValue.replace(/field$/i, '').trim();
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    const isMappingNotFound = errorMessage.includes('not found') || 
                              errorMessage.includes('does not exist') ||
                              errorMessage.includes('Mapping not found');
    if (isMappingNotFound) return null;
    return null;
  }
}

/**
 * Get creator address for a market from market_creator mapping
 */
export async function fetchMarketCreator(marketId: string): Promise<string | null> {
  try {
    // Use AleoScan API for mapping reads
    const value = await getMappingValueFromAleoScan(
      PREDICTION_MARKET_PROGRAM_ID,
      'market_creator',
      `${marketId}field`
    );
    
    if (value === null) return null;
    return value;
  } catch {
    return null;
  }
}
