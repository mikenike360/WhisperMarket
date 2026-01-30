import type { NextPage } from 'next';
import type { ReactElement, ReactNode } from 'react';
import { Network } from '@provablehq/aleo-types';

//Change to Network.MAINNET for mainnet or Network.TESTNET for testnet
export const CURRENT_NETWORK: Network = Network.TESTNET;


//TESTNET_RPC_URL=https://testnetbeta.aleorpc.com
//MAINNET_RPC_URL=https://mainnet.aleorpc.com
export const CURRENT_RPC_URL = "https://testnetbeta.aleorpc.com";

// AleoScan API URLs for mapping reads (more reliable than JSON-RPC)
export const ALEOSCAN_API_URL = "https://testnet.aleoscan.io/api";
export const ALEOSCAN_MAINNET_API_URL = "https://api.aleoscan.io";

export type NextPageWithLayout<P = {}> = NextPage<P> & {
  authorization?: boolean;
  getLayout?: (page: ReactElement) => ReactNode;
};

export const CREDITS_PROGRAM_ID = 'credits.aleo';

// Prediction Market Types
// Program ID: whisper_market.aleo
export const PREDICTION_MARKET_PROGRAM_ID = 'whisper_market.aleo';

export type MarketState = {
  status: number; // 0=open, 1=resolved, 2=paused
  outcome: boolean | null; // true=YES, false=NO, null if not resolved
  priceYes: number; // Current YES price (0-10000) - derived from AMM reserves
  collateralPool: number;
  yesReserve: number; // AMM YES token reserve
  noReserve: number; // AMM NO token reserve
  feeBps: number; // Fee in basis points
  isPaused: boolean;
};

export type UserPosition = {
  marketId: string; // Field-based market ID
  yesShares: number;
  noShares: number;
  collateralAvailable: number; // Available collateral for swaps/withdrawals
  collateralCommitted: number; // Committed collateral backing shares
  payoutClaimed: boolean; // Whether payout has been claimed after resolution
};

export type Trade = {
  user: string;
  side: 'yes' | 'no';
  collateral: number;
  shares: number;
  timestamp?: number;
};

export type MarketMetadata = {
  marketId: string;
  title: string;
  description: string;
  category?: string;
};
