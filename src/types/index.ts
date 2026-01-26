import type { NextPage } from 'next';
import type { ReactElement, ReactNode } from 'react';
import { Network } from '@provablehq/aleo-types';

//Change to Network.MAINNET for mainnet or Network.TESTNET for testnet
export const CURRENT_NETWORK: Network = Network.TESTNET;


//TESTNET_RPC_URL=https://testnetbeta.aleorpc.com
//MAINNET_RPC_URL=https://mainnet.aleorpc.com
export const CURRENT_RPC_URL = "https://testnetbeta.aleorpc.com";

export type NextPageWithLayout<P = {}> = NextPage<P> & {
  authorization?: boolean;
  getLayout?: (page: ReactElement) => ReactNode;
};

// src/types/index.ts
export type ProposalData = {
  bountyId: number;
  proposalId: number;
  proposerAddress: string;
  proposalText?: string;
  fileName?: string;
  fileUrl?: string;
  status?: string;
  rewardSent?: boolean;
};

export type BountyData = {
  id: number;
  title: string;
  reward: string;
  deadline: string;
  creatorAddress: string;
  proposals?: ProposalData[];
};

export const BOUNTY_PROGRAM_ID = 'zkontract.aleo';

// Prediction Market Types
// Program ID: prediction_market_testing.aleo
// Deployed address: at17m27s7dw5pszldlut6p780jxvuuda2xl6k7tv39tt9zptyz8dqyq3hxjs8
export const PREDICTION_MARKET_PROGRAM_ID = 'prediction_market_testing.aleo';

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
