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
export {
  discoverMarketsFromChain,
  extractMarketIdFromTransaction,
  discoverMarketsByTestingIds,
  getAllActiveMarketIds,
  getAllMarkets,
} from './rpc/marketDiscovery';
export { clearMarketStateCache, getMarketState, getUserPositionRecords } from './rpc/marketState';
export { transferPublic, transferPrivate, joinRecords, combineMultipleRecords } from './rpc/credits';
export {
  initMarket,
  openPositionPrivate,
  depositPrivate,
  swapCollateralForYesPrivate,
  swapCollateralForNoPrivate,
  mergeTokensPrivate,
  withdrawPrivate,
  redeemPrivate,
  resolveMarket,
  pause,
  unpause,
} from './rpc/marketTransactions';
export { findPositionRecordForMarket, getAllUserPositions, pickRecordToRedeem } from './rpc/positionRecords';
