import { client } from './client';
import { getMarketInitTransactions, fetchMarketMappingValue } from './chainRead';
import { getActiveMarketIds, getAllMarketsWithData, type MarketRegistryEntry } from '../marketRegistry';
import { getMarketState } from './marketState';

/**
 * Query a transaction by ID to get finalize operations.
 */
async function getTransactionWithFinalize(transactionId: string): Promise<any> {
  try {
    try {
      const tx = await client.request('getTransaction', { id: transactionId });
      if (tx) return tx;
    } catch {
      // continue
    }

    for (let page = 0; page < 3; page++) {
      try {
        const txs = await getMarketInitTransactions(page, 100);
        if (!txs || !Array.isArray(txs) || txs.length === 0) break;
        const foundTx = txs.find((tx: any) => {
          const txId = tx.id || tx.transaction_id || tx.transactionId || tx.transaction?.id;
          return txId === transactionId || String(txId) === String(transactionId);
        });
        if (foundTx) return foundTx;
      } catch {
        break;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function discoverMarketsFromChain(): Promise<string[]> {
  try {
    const allTransactionIds: string[] = [];
    const transactionsWithFinalize: any[] = [];

    for (let page = 0; page < 5; page++) {
      try {
        const txs = await getMarketInitTransactions(page, 100);
        if (!txs || !Array.isArray(txs) || txs.length === 0) break;

        txs.forEach((tx: any) => {
          const hasFinalize = tx.finalize || tx.transaction?.finalize || tx.execution?.finalize || tx.transaction?.execution?.finalize;
          if (hasFinalize) {
            transactionsWithFinalize.push(tx);
          } else {
            const txId = tx.id || tx.transaction_id || tx.transactionId || tx.transaction?.id;
            if (txId && typeof txId === 'string') allTransactionIds.push(txId);
          }
        });
        if (txs.length < 100) break;
      } catch {
        break;
      }
    }

    const marketIds = new Set<string>();

    let transactions: any[] = [...transactionsWithFinalize];
    if (allTransactionIds.length > 0) {
      const transactionsToQuery = allTransactionIds.slice(0, 50);
      const transactionPromises = transactionsToQuery.map((txId) => getTransactionWithFinalize(txId));
      const queriedTxs = (await Promise.all(transactionPromises)).filter((tx) => tx !== null);
      transactions.push(...queriedTxs);
    }

    transactions.forEach((tx: any) => {
      try {
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
              if (
                (opType === 'update_key_value' || opType === 'set_key_value' || opType === 'UpdateKeyValue' || opType === 'SetKeyValue') &&
                mappingId &&
                typeof mappingId === 'string' &&
                mappingId.includes('market_status')
              ) {
                if (keyId) {
                  let marketId = String(keyId);
                  marketId = marketId.replace(/\.field$/, '').replace(/field$/, '').replace(/\.private$/, '').trim();
                  if (marketId && marketId.length > 0) marketIds.add(marketId);
                }
              }
            } catch {
              // skip
            }
          });
        }
      } catch {
        // skip
      }
    });
    return Array.from(marketIds);
  } catch {
    return [];
  }
}

export async function extractMarketIdFromTransaction(
  transactionId: string,
  retries: number = 3,
  delayMs: number = 2000
): Promise<string | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
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
        const marketMappings = [
          'market_status',
          'market_creator',
          'market_metadata_hash',
          'market_bond',
          'market_collateral_pool',
          'market_yes_reserve',
          'market_no_reserve',
        ];
        for (const op of finalizeOps) {
          const opType = op.type || op.Type || op.op_type || op.opType;
          const mappingId = op.mapping_id || op.mappingId || op.mapping || op.mapping_name || '';
          const keyId = op.key_id || op.keyId || op.key || op.key_id_field || op.key_field || '';
          const isMappingUpdate =
            opType === 'update_key_value' ||
            opType === 'set_key_value' ||
            opType === 'UpdateKeyValue' ||
            opType === 'SetKeyValue' ||
            opType === 'mapping_update' ||
            (opType === undefined && mappingId && keyId);
          if (isMappingUpdate && mappingId && typeof mappingId === 'string') {
            const isMarketMapping = marketMappings.some(
              (m) => mappingId.includes(m) || mappingId.endsWith(m) || mappingId.includes('market')
            );
            if (isMarketMapping && keyId) {
              let marketId = String(keyId);
              marketId = marketId.replace(/\.field$/, '').replace(/field$/, '').replace(/\.private$/, '').trim();
              if (!marketId || marketId === 'undefined' || marketId === 'null') {
                const nestedKey = op.key?.id || op.key?.value || op.value?.key || op.value?.id;
                if (nestedKey) marketId = String(nestedKey).replace(/\.field$/, '').replace(/field$/, '').replace(/\.private$/, '').trim();
              }
              if (marketId && marketId.length > 0 && marketId !== 'undefined' && marketId !== 'null') return marketId;
            }
          }
        }
      }

      const execution = tx.execution || tx.transaction?.execution;
      if (execution) {
        const transitions = execution.transitions || execution.transition || [];
        for (const transition of Array.isArray(transitions) ? transitions : [transitions]) {
          if (transition && (transition.function === 'init' || transition.functionName === 'init')) {
            const inputs = transition.inputs || transition.input || [];
            for (let i = 0; i < (Array.isArray(inputs) ? inputs.length : 1); i++) {
              const input = Array.isArray(inputs) ? inputs[i] : inputs;
              if (input && typeof input === 'string') {
                const fieldMatch = input.match(/(\d+)\.?\s*field/i) || input.match(/(\d+field)/i);
                if (fieldMatch) {
                  const potentialMarketId = fieldMatch[1].replace(/field/i, '').trim();
                  if (potentialMarketId && potentialMarketId.length > 10) {
                    try {
                      await fetchMarketMappingValue('market_status', potentialMarketId);
                      return potentialMarketId;
                    } catch {
                      // continue
                    }
                  }
                }
              }
            }
            const outputs = transition.outputs || transition.output || [];
            for (const output of Array.isArray(outputs) ? outputs : [outputs]) {
              if (output && typeof output === 'string' && output.includes('field')) {
                const potentialMarketId = output.replace(/\.field$/, '').replace(/field$/, '').trim();
                if (potentialMarketId && potentialMarketId.length > 10) {
                  try {
                    await fetchMarketMappingValue('market_status', potentialMarketId);
                    return potentialMarketId;
                  } catch {
                    // continue
                  }
                }
              }
            }
          }
        }
      }
    } catch {
      // retry
    }
  }
  return null;
}

export async function discoverMarketsByTestingIds(potentialIds: string[]): Promise<string[]> {
  const validMarketIds: string[] = [];
  for (const marketId of potentialIds) {
    try {
      await getMarketState(marketId);
      validMarketIds.push(marketId);
    } catch {
      // skip
    }
  }
  return validMarketIds;
}

export async function getAllActiveMarketIds(): Promise<string[]> {
  return getActiveMarketIds();
}

export async function getAllMarkets(): Promise<MarketRegistryEntry[]> {
  return getAllMarketsWithData();
}
