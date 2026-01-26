import { JSONRPCClient } from 'json-rpc-2.0';
import { BOUNTY_PROGRAM_ID, PREDICTION_MARKET_PROGRAM_ID, MarketState, UserPosition, CURRENT_RPC_URL } from '@/types';


export const CREDITS_PROGRAM_ID = 'credits.aleo';

// Create the JSON-RPC client
export const client = getClient(CURRENT_RPC_URL);


// returns a string for address-based mappings
export async function fetchMappingValueString(
  mappingName: string,
  key: number
): Promise<string> {
  try {
    const result = await client.request('getMappingValue', {
      programId: BOUNTY_PROGRAM_ID,
      mappingName,
      key: `${key}.public`,
    });
    return result.value; // The address is stored as string in 'result.value'
  } catch (error) {
    console.error(`Failed to fetch mapping ${mappingName} with key ${key}:`, error);
    throw error;
  }
}

export async function fetchMappingValueRaw(
  mappingName: string,
  key: string
): Promise<string> {
  try {

    const keyString = `${key}u64`;

    const result = await client.request("getMappingValue", {
      program_id: BOUNTY_PROGRAM_ID,
      mapping_name: mappingName,
      key: keyString,
    });

    if (!result) {
      throw new Error(
        `No result returned for mapping "${mappingName}" and key "${keyString}"`
      );
    }

    return result;
  } catch (error) {
    console.error(`Failed to fetch mapping "${mappingName}" with key "${key}":`, error);
    throw error;
  }
}


export async function fetchBountyStatusAndReward(bountyId: string) {
  try {
 
    const keyU64 = `${bountyId}u64`;


    const statusResult = await client.request('getMappingValue', {
      program_id: BOUNTY_PROGRAM_ID,
      mapping_name: 'bounty_status',
      key: keyU64,
    });

    const rewardResult = await client.request('getMappingValue', {
      program_id: BOUNTY_PROGRAM_ID,
      mapping_name: 'bounty_reward',
      key: keyU64,
    });

    return {
      status: statusResult?.value ?? statusResult ?? null,
      reward: rewardResult?.value ?? rewardResult ?? null,
    };
  } catch (error) {
    console.error('Error fetching bounty status/reward from chain:', error);
    throw new Error('Failed to fetch chain data');
  }
}

export async function readBountyMappings(bountyId: string) {
  // Fetch raw strings for all mappings
  const creator = await fetchMappingValueRaw('bounty_creator', bountyId);
  const payment = await fetchMappingValueRaw('bounty_payment', bountyId);
  const status = await fetchMappingValueRaw('bounty_status', bountyId);

  return {
    creator,  
    payment,  
    status,   
  };
}

export async function readProposalMappings(bountyId: number, proposalId: number) {
  // Ensure safe arithmetic using BigInt
  const compositeProposalId = (BigInt(bountyId) * BigInt(1_000_000) + BigInt(proposalId)).toString();

  console.log("Fetching data for Composite Proposal ID:", compositeProposalId);

  try {
    // Fetch all mappings related to the proposal
    const proposalBountyId = await fetchMappingValueRaw("proposal_bounty_id", compositeProposalId);
    const proposalProposer = await fetchMappingValueRaw("proposal_proposer", compositeProposalId);
    const proposalStatus = await fetchMappingValueRaw("proposal_status", compositeProposalId);

    return {
      proposalBountyId,
      proposalProposer,
      proposalStatus,
    };
  } catch (error) {
    console.error("Error fetching proposal mappings:", error);
    throw error;
  }
}



/**
 * Utility to fetch program transactions
 */
export async function getProgramTransactions(
  functionName: string,
  page = 0,
  maxTransactions = 100
) {
  return client.request('aleoTransactionsForProgram', {
    programId: BOUNTY_PROGRAM_ID,
    functionName,
    page,
    maxTransactions,
  });
}

/**
 * Fetch all init transactions for prediction market program
 * This helps discover all markets that have been created
 */
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

/**
 * Discover markets by querying init transactions and extracting market IDs
 * Market IDs are stored in mappings (market_status, market_creator, etc.)
 * We extract them from the finalize operations in transactions
 */
export async function discoverMarketsFromChain(): Promise<string[]> {
  try {
    const transactions = await getMarketInitTransactions(0, 1000);
    const marketIds = new Set<string>();

    if (!transactions || !Array.isArray(transactions)) {
      return [];
    }

    // Parse transactions to extract market IDs from finalize operations
    transactions.forEach((tx: any) => {
      // Check if transaction has execution with finalize operations
      if (tx.transaction?.execution?.finalize) {
        const finalizeOps = tx.transaction.execution.finalize;
        
        // Look for mapping updates to market_status (which uses market_id as key)
        finalizeOps.forEach((op: any) => {
          if (op.type === 'update_key_value' || op.type === 'set_key_value') {
            // Check if this is a market_status mapping update
            // The mapping_id would be something like "prediction_market_testing.aleo/market_status"
            if (op.mapping_id && op.mapping_id.includes('market_status')) {
              // The key_id contains the market_id (field)
              if (op.key_id) {
                // Extract the field value (market_id)
                // The key_id format might be a field value
                const marketId = String(op.key_id).replace(/field$/, '');
                if (marketId) {
                  marketIds.add(marketId);
                }
              }
            }
          }
        });
      }

      // Also check transitions for any market_id references
      if (tx.transaction?.execution?.transitions) {
        tx.transaction.execution.transitions.forEach((transition: any) => {
          if (transition.function === 'init') {
            // The market_id is calculated in the async block, so it won't be in inputs
            // But we can check finalize operations which happen after
          }
        });
      }
    });

    return Array.from(marketIds);
  } catch (error) {
    console.error('Failed to discover markets from chain:', error);
    return [];
  }
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
 * 1. Post Bounty
 */
export async function postBounty(
  caller: string,
  bountyId: number,
  reward: number
): Promise<string> {
  const inputs = [
    `${caller}.private`,
    `${bountyId}.private`,
    `${caller}.private`,
    `${reward}.private`,
  ];
  const result = await client.request('executeTransition', {
    programId: BOUNTY_PROGRAM_ID,
    functionName: 'post_bounty',
    inputs,
  });
  if (!result.transactionId) {
    throw new Error('Transaction failed: No transactionId returned.');
  }
  return result.transactionId;
}

/**
 * 2. View Bounty by ID
 */
export async function viewBountyById(
  bountyId: number
): Promise<{ payment: number; status: number }> {
  const inputs = [`${bountyId}.private`];
  const result = await client.request('executeTransition', {
    programId: BOUNTY_PROGRAM_ID,
    functionName: 'view_bounty_by_id',
    inputs,
  });

  // Fetch finalized data from the mappings
  const payment = await fetchMappingValue('bounty_output_payment', bountyId);
  const status = await fetchMappingValue('bounty_output_status', bountyId);

  return { payment, status };
}

/**
 * 3. Submit Proposal
 */
export async function submitProposal(
  caller: string,
  bountyId: number,
  proposalId: number,
  proposer: string
): Promise<string> {
  const inputs = [
    `${caller}.private`,
    `${bountyId}.private`,
    `${proposalId}.private`,
    `${proposer}.private`,
  ];
  const result = await client.request('executeTransition', {
    programId: BOUNTY_PROGRAM_ID,
    functionName: 'submit_proposal',
    inputs,
  });
  return result.transactionId;
}

/**
 * 4. Accept Proposal
 */
export async function acceptProposal(
  caller: string,
  bountyId: number,
  proposalId: number,
  creator: string,
  reward: number
): Promise<string> {
  const inputs = [
    `${caller}.private`,
    `${bountyId}.private`,
    `${proposalId}.private`,
    `${creator}.private`,
    `${reward}.private`,
  ];
  const result = await client.request('executeTransition', {
    programId: BOUNTY_PROGRAM_ID,
    functionName: 'accept_proposal',
    inputs,
  });
  return result.transactionId;
}

/**
 * 5. Delete Bounty
 */
export async function deleteBounty(
  caller: string,
  bountyId: number
): Promise<string> {
  const inputs = [`${caller}.private`, `${bountyId}.private`];
  const result = await client.request('executeTransition', {
    programId: BOUNTY_PROGRAM_ID,
    functionName: 'delete_bounty',
    inputs,
  });
  return result.transactionId;
}

/**
 * 6. Wait for Transaction Finalization
 */
export async function waitForTransactionToFinalize(
  transactionId: string
): Promise<boolean> {
  const maxRetries = 30;
  const delay = 1000; // 1 second
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const status = await client.request('getTransactionStatus', { id: transactionId });
      if (status === 'finalized') {
        return true;
      }
    } catch (error) {
      console.error(`Failed to get transaction status: ${error}`);
    }
    retries++;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  return false; // Return false if transaction is not finalized
}


/**
 * 7. Transfer Payment
 */
export async function transfer(
  caller: string,
  receiver: string,
  amount: number
): Promise<string> {
  const inputs = [`${caller}.private`, `${receiver}.private`, `${amount}.private`];
  const result = await client.request('executeTransition', {
    programId: BOUNTY_PROGRAM_ID,
    functionName: 'transfer',
    inputs,
  });
  if (!result.transactionId) {
    throw new Error('Transaction failed: No transactionId returned.');
  }
  return result.transactionId;
}


/**
 * Helper to Fetch Mapping Values
 */
export async function fetchMappingValue(
  mappingName: string,
  key: string | number // Allow both string and number
): Promise<number> {
  try {
    // Convert `key` to string if it's a number
    const keyString = typeof key === 'number' ? `${key}.public` : `${key}.public`;

    const result = await client.request('getMappingValue', {
      programId: BOUNTY_PROGRAM_ID,
      mappingName,
      key: keyString, // Always pass as a string
    });

    return parseInt(result.value, 10); // Parse as integer
  } catch (error) {
    console.error(
      `Failed to fetch mapping ${mappingName} with key ${key}:`,
      error
    );
    throw error;
  }
}

/**
 * Utility to Create JSON-RPC Client
 */
export function getClient(apiUrl: string): JSONRPCClient {
  const client: JSONRPCClient = new JSONRPCClient((jsonRPCRequest: any) =>
    fetch(apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(jsonRPCRequest),
    }).then((response) => {
      if (response.status === 200) {
        return response.json().then((jsonRPCResponse) =>
          client.receive(jsonRPCResponse)
        );
      }
      throw new Error(response.statusText);
    })
  );
  return client;
}

/**
 * Get Verifying Key for a Function
 */
async function getDeploymentTransaction(programId: string): Promise<any> {
  const response = await fetch(`${CURRENT_RPC_URL}find/transactionID/deployment/${programId}`);
  const deployTxId = await response.json();
  const txResponse = await fetch(`${CURRENT_RPC_URL}transaction/${deployTxId}`);
  const tx = await txResponse.json();
  return tx;
}

export async function getVerifyingKey(
  programId: string,
  functionName: string
): Promise<string> {
  const deploymentTx = await getDeploymentTransaction(programId);

  const allVerifyingKeys = deploymentTx.deployment.verifying_keys;
  const verifyingKey = allVerifyingKeys.filter((vk: any) => vk[0] === functionName)[0][1][0];
  return verifyingKey;
}

export async function getProgram(programId: string, apiUrl: string): Promise<string> {
  const client = getClient(apiUrl);
  const program = await client.request('program', {
    id: programId
  });
  return program;
}


//Deny a proposal

export async function denyProposal(
  caller: string,
  bountyId: number,
  proposalId: number
): Promise<string> {
  const inputs = [
    `${caller}.private`,   
    `${bountyId}.private`, 
    `${proposalId}.private` 
  ];
    
    const result = await client.request('executeTransition', {
      programId: BOUNTY_PROGRAM_ID,
      functionName: 'deny_proposal', 
      inputs, 
    });

    return result.transactionId;
}

// ==========================================
// Prediction Market Functions
// ==========================================

/**
 * Initialize market - Creates a new prediction market
 * Uses executeTransition RPC which automatically works with wallet adapters
 * @param initialLiquidity - Initial liquidity amount (in microcredits, u64)
 * @param bondAmount - Creation bond amount (in microcredits, u64)
 * @param feeBps - Fee in basis points (u64, max 1000 = 10%)
 * @param metadataHash - Metadata hash (field)
 * @param creditRecord - Credit record for payment (record object or string)
 */
export async function initMarket(
  initialLiquidity: number,
  bondAmount: number,
  feeBps: number,
  metadataHash: string,
  creditRecord: any // Can be record object or string - executeTransition handles it
): Promise<string> {
  const inputs = [
    `${initialLiquidity}u64`,
    `${bondAmount}u64`,
    `${feeBps}u64`,
    `${metadataHash}field`,
    creditRecord, // Credit record - executeTransition will handle wallet interaction and record decryption
  ];

  // executeTransition RPC automatically works with wallet adapters
  // It will prompt the wallet for signing and handle record decryption with DecryptPermission.UponRequest
  const result = await client.request('executeTransition', {
    programId: PREDICTION_MARKET_PROGRAM_ID,
    functionName: 'init',
    inputs,
  });

  if (!result.transactionId) {
    throw new Error('Transaction failed: No transactionId returned.');
  }

  return result.transactionId;
}


/**
 * Open position (first-time) - Creates initial Position record
 * @param marketId - Field-based market ID
 * @param creditRecord - Credit record for deposit
 * @param amount - Amount to deposit (u64)
 * @param statusHint - Market status hint (0=open)
 */
export async function openPositionPrivate(
  marketId: string,
  creditRecord: string,
  amount: number,
  statusHint: number = 0
): Promise<string> {
  const inputs = [
    `${marketId}field`,
    creditRecord,
    `${amount}u64`,
    `${statusHint}u8`,
  ];

  const result = await client.request('executeTransition', {
    programId: PREDICTION_MARKET_PROGRAM_ID,
    functionName: 'open_position_private',
    inputs,
  });

  if (!result.transactionId) {
    throw new Error('Transaction failed: No transactionId returned.');
  }

  return result.transactionId;
}

/**
 * Deposit private - Adds collateral to existing Position
 * @param marketId - Field-based market ID
 * @param creditRecord - Credit record for deposit
 * @param amount - Amount to deposit (u64)
 * @param existingPosition - Existing Position record
 * @param statusHint - Market status hint (0=open)
 */
export async function depositPrivate(
  marketId: string,
  creditRecord: string,
  amount: number,
  existingPosition: string,
  statusHint: number = 0
): Promise<string> {
  const inputs = [
    `${marketId}field`,
    creditRecord,
    `${amount}u64`,
    existingPosition, // Position record (already in correct format)
    `${statusHint}u8`,
  ];

  const result = await client.request('executeTransition', {
    programId: PREDICTION_MARKET_PROGRAM_ID,
    functionName: 'deposit_private',
    inputs,
  });

  if (!result.transactionId) {
    throw new Error('Transaction failed: No transactionId returned.');
  }

  return result.transactionId;
}

/**
 * Swap collateral for YES shares using AMM
 * @param marketId - Field-based market ID
 * @param existingPosition - Existing Position record
 * @param collateralIn - Collateral amount to swap (u64)
 * @param minYesOut - Minimum YES shares expected (u128, for slippage protection)
 * @param yesReserve - Current YES reserve (u128)
 * @param noReserve - Current NO reserve (u128)
 * @param feeBps - Fee in basis points (u64)
 * @param statusHint - Market status hint (0=open)
 */
export async function swapCollateralForYesPrivate(
  marketId: string,
  existingPosition: string,
  collateralIn: number,
  minYesOut: number,
  yesReserve: number,
  noReserve: number,
  feeBps: number,
  statusHint: number = 0
): Promise<string> {
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

  const result = await client.request('executeTransition', {
    programId: PREDICTION_MARKET_PROGRAM_ID,
    functionName: 'swap_collateral_for_yes_private',
    inputs,
  });

  if (!result.transactionId) {
    throw new Error('Transaction failed: No transactionId returned.');
  }

  return result.transactionId;
}

/**
 * Swap collateral for NO shares using AMM
 * @param marketId - Field-based market ID
 * @param existingPosition - Existing Position record
 * @param collateralIn - Collateral amount to swap (u64)
 * @param minNoOut - Minimum NO shares expected (u128, for slippage protection)
 * @param yesReserve - Current YES reserve (u128)
 * @param noReserve - Current NO reserve (u128)
 * @param feeBps - Fee in basis points (u64)
 * @param statusHint - Market status hint (0=open)
 */
export async function swapCollateralForNoPrivate(
  marketId: string,
  existingPosition: string,
  collateralIn: number,
  minNoOut: number,
  yesReserve: number,
  noReserve: number,
  feeBps: number,
  statusHint: number = 0
): Promise<string> {
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

  const result = await client.request('executeTransition', {
    programId: PREDICTION_MARKET_PROGRAM_ID,
    functionName: 'swap_collateral_for_no_private',
    inputs,
  });

  if (!result.transactionId) {
    throw new Error('Transaction failed: No transactionId returned.');
  }

  return result.transactionId;
}

/**
 * Merge tokens to collateral (pre-resolution exit)
 * Burns equal amounts of YES and NO tokens to receive collateral back
 * @param marketId - Field-based market ID
 * @param existingPosition - Existing Position record
 * @param mergeAmount - Amount of YES/NO tokens to merge (u128)
 * @param minCollateralOut - Minimum collateral expected (u64, for slippage protection)
 */
export async function mergeTokensPrivate(
  marketId: string,
  existingPosition: string,
  mergeAmount: number,
  minCollateralOut: number
): Promise<string> {
  const inputs = [
    `${marketId}field`,
    existingPosition,
    `${mergeAmount}u128`,
    `${minCollateralOut}u64`,
  ];

  const result = await client.request('executeTransition', {
    programId: PREDICTION_MARKET_PROGRAM_ID,
    functionName: 'merge_tokens_private',
    inputs,
  });

  if (!result.transactionId) {
    throw new Error('Transaction failed: No transactionId returned.');
  }

  return result.transactionId;
}

/**
 * Withdraw private - Withdraws available collateral (only if no shares held)
 * @param marketId - Field-based market ID
 * @param existingPosition - Existing Position record
 * @param amount - Amount to withdraw (u64)
 */
export async function withdrawPrivate(
  marketId: string,
  existingPosition: string,
  amount: number
): Promise<string> {
  const inputs = [
    `${marketId}field`,
    existingPosition,
    `${amount}u64`,
  ];

  const result = await client.request('executeTransition', {
    programId: PREDICTION_MARKET_PROGRAM_ID,
    functionName: 'withdraw_private',
    inputs,
  });

  if (!result.transactionId) {
    throw new Error('Transaction failed: No transactionId returned.');
  }

  return result.transactionId;
}

/**
 * Redeem private - Redeems winning shares after market resolution
 * @param marketId - Field-based market ID
 * @param existingPosition - Existing Position record
 * @param outcome - Market outcome (true=YES wins, false=NO wins)
 */
export async function redeemPrivate(
  marketId: string,
  existingPosition: string,
  outcome: boolean
): Promise<string> {
  const inputs = [
    `${marketId}field`,
    existingPosition,
    outcome ? 'true' : 'false',
  ];

  const result = await client.request('executeTransition', {
    programId: PREDICTION_MARKET_PROGRAM_ID,
    functionName: 'redeem_private',
    inputs,
  });

  if (!result.transactionId) {
    throw new Error('Transaction failed: No transactionId returned.');
  }

  return result.transactionId;
}

/**
 * Resolve market - Admin only
 * @param marketId - Field-based market ID
 * @param outcome - Market outcome (true=YES wins, false=NO wins)
 */
export async function resolveMarket(
  marketId: string,
  outcome: boolean
): Promise<string> {
  const inputs = [
    `${marketId}field`,
    outcome ? 'true' : 'false',
  ];

  const result = await client.request('executeTransition', {
    programId: PREDICTION_MARKET_PROGRAM_ID,
    functionName: 'resolve',
    inputs,
  });

  if (!result.transactionId) {
    throw new Error('Transaction failed: No transactionId returned.');
  }

  return result.transactionId;
}

/**
 * Pause market - Admin only
 * @param marketId - Field-based market ID
 */
export async function pause(
  marketId: string
): Promise<string> {
  const inputs = [
    `${marketId}field`,
  ];

  const result = await client.request('executeTransition', {
    programId: PREDICTION_MARKET_PROGRAM_ID,
    functionName: 'pause',
    inputs,
  });

  if (!result.transactionId) {
    throw new Error('Transaction failed: No transactionId returned.');
  }

  return result.transactionId;
}

/**
 * Unpause market - Admin only
 * @param marketId - Field-based market ID
 */
export async function unpause(
  marketId: string
): Promise<string> {
  const inputs = [
    `${marketId}field`,
  ];

  const result = await client.request('executeTransition', {
    programId: PREDICTION_MARKET_PROGRAM_ID,
    functionName: 'unpause',
    inputs,
  });

  if (!result.transactionId) {
    throw new Error('Transaction failed: No transactionId returned.');
  }

  return result.transactionId;
}

/**
 * Fetch mapping value for prediction market (field-based keys)
 */
async function fetchMarketMappingValue(
  mappingName: string,
  key: string
): Promise<number> {
  try {
    // Field-based keys: use field suffix instead of .public
    const result = await client.request('getMappingValue', {
      programId: PREDICTION_MARKET_PROGRAM_ID,
      mappingName,
      key: `${key}field`,
    });

    if (!result || result.value === undefined) {
      throw new Error(`Mapping ${mappingName} not found or program not deployed`);
    }

    return parseInt(result.value, 10);
  } catch (error: any) {
    // Only log detailed errors in development, keep production clean
    if (process.env.NODE_ENV === 'development') {
      console.warn(`Failed to fetch mapping ${mappingName} with key ${key}`);
    }
    throw error;
  }
}

/**
 * Fetch mapping value as string for prediction market (field-based keys)
 */
async function fetchMarketMappingValueString(
  mappingName: string,
  key: string
): Promise<string> {
  try {
    // Field-based keys: use field suffix instead of .public
    const result = await client.request('getMappingValue', {
      programId: PREDICTION_MARKET_PROGRAM_ID,
      mappingName,
      key: `${key}field`,
    });

    if (!result || result.value === undefined) {
      throw new Error(`Mapping ${mappingName} not found or program not deployed`);
    }

    return result.value;
  } catch (error: any) {
    // Only log detailed errors in development
    if (process.env.NODE_ENV === 'development') {
      console.warn(`Failed to fetch mapping ${mappingName} with key ${key}`);
    }
    throw error;
  }
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
    // Only log in development to avoid console spam
    if (process.env.NODE_ENV === 'development') {
      console.warn('Failed to fetch market state - program may not be deployed');
    }
    throw error;
  }
}

/**
 * Get user position from private Position records
 * @param wallet - Wallet adapter instance (from useWallet hook)
 * @param programId - Program ID to fetch records from
 * @param marketId - Field-based market ID to filter records
 */
export async function getUserPositionRecords(
  wallet: any,
  programId: string,
  marketId: string
): Promise<UserPosition | null> {
  try {
    if (!wallet || !wallet.requestRecords) {
      throw new Error('Wallet adapter not available or does not support requestRecords');
    }

    // Fetch all Position records for this program
    const allRecords = await wallet.requestRecords(programId);
    if (!allRecords || allRecords.length === 0) {
      return null;
    }

    // Filter for Position records (not spent) and match market_id
    const positionRecords = allRecords.filter((record: any) => {
      // Check if record is a Position record and not spent
      if (record.spent) return false;
      
      // Position records have market_id field
      const recordData = record.data || record;
      if (recordData.market_id) {
        // Extract market_id value (handle .private suffix)
        const recordMarketId = extractFieldValue(recordData.market_id);
        return recordMarketId === marketId;
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
    console.error('Failed to fetch user position records:', error);
    throw error;
  }
}

/**
 * Helper to extract field value from Aleo record format
 * Handles .private suffixes and field formatting
 */
function extractFieldValue(value: any): string {
  if (typeof value === 'string') {
    // Remove .private suffix if present
    return value.replace(/\.private$/, '');
  }
  // If it's an object, try to extract the value
  if (value && typeof value === 'object') {
    return String(value);
  }
  return String(value);
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