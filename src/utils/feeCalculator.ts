// feeCalculator.ts

export interface FeeMapping {
    [functionName: string]: number; // fee in credits
  }
  
  // Hard-coded fee values in credits
  export const defaultFeeValues: FeeMapping = {
    //You can use Leo Playground to get the fee values for each function
    // https://playground.aleo.org/
    transfer_public: 0.04406,
    transfer_private: 0.04406,
    join: 0.05, // Fee for joining/combining credit records
    init: 0.05, // Estimated fee for init function - adjust based on actual testing
    // Prediction Market Functions
    open_position_private: 0.05, // Estimated - adjust based on actual testing
    deposit_global_private: 0.05, // Estimated - adjust based on actual testing
    withdraw_global_private: 0.05, // Estimated - adjust based on actual testing
    mint_pairs_private: 0.05, // v2: add collateral, get equal YES+NO
    mint_yes_only_private: 0.05, // v2: add collateral, receive YES only (mint + swap)
    mint_no_only_private: 0.05, // v2: add collateral, receive NO only (mint + swap)
    swap_yes_no_private: 0.05, // v2: sell YES for NO
    swap_no_yes_private: 0.05, // v2: sell NO for YES
    merge_tokens_private: 0.05, // Estimated - adjust based on actual testing
    redeem_private: 0.05, // Estimated - adjust based on actual testing
    resolve: 0.05, // Estimated - adjust based on actual testing
    pause: 0.05, // Estimated - adjust based on actual testing
    unpause: 0.05, // Estimated - adjust based on actual testing
  };
  
  /**
   * Returns the fee for a given function in micro credits.
   * (1 credit = 1,000,000 micro credits)
   */
  export function getFeeForFunction(functionName: string): number {
    const feeInCredits = defaultFeeValues[functionName];
    if (feeInCredits === undefined) {
      throw new Error(`No fee value found for function: ${functionName}`);
    }
    return feeInCredits * 1_000_000; // convert credits to micro credits
  }
  