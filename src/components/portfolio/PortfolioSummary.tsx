import React from 'react';
import { UserPosition, MarketState } from '@/types';
import { toCredits } from '@/utils/credits';

interface PortfolioSummaryProps {
  positions: Array<{
    position: UserPosition;
    marketState: MarketState | null;
  }>;
  /** Global collateral balance (microcredits). Used as available when present. */
  globalBalance?: number;
}

export const PortfolioSummary: React.FC<PortfolioSummaryProps> = ({ positions, globalBalance }) => {
  const totalMarkets = positions.length;
  const totalYesShares = positions.reduce((sum, p) => sum + p.position.yesShares, 0);
  const totalNoShares = positions.reduce((sum, p) => sum + p.position.noShares, 0);
  const totalAvailableCash = globalBalance ?? positions.reduce(
    (sum, p) => sum + p.position.collateralAvailable,
    0
  );
  const totalCommittedCollateral = positions.reduce(
    (sum, p) => sum + p.position.collateralCommitted,
    0
  );
  const totalShares = totalYesShares + totalNoShares;

  // Calculate total potential payout for resolved markets
  const totalPotentialPayout = positions.reduce((sum, p) => {
    if (!p.marketState || p.marketState.status !== 1 || p.marketState.outcome === null) {
      return sum;
    }
    if (p.marketState.outcome === true && p.position.yesShares > 0) {
      return sum + p.position.yesShares;
    } else if (p.marketState.outcome === false && p.position.noShares > 0) {
      return sum + p.position.noShares;
    }
    return sum;
  }, 0);

  // Count markets by status
  const openMarkets = positions.filter(
    p => p.marketState?.status === 0
  ).length;
  const resolvedMarkets = positions.filter(
    p => p.marketState?.status === 1
  ).length;
  const pausedMarkets = positions.filter(
    p => p.marketState?.status === 2
  ).length;

  const cashStr = toCredits(totalAvailableCash).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 });
  const sharesStr = toCredits(totalShares).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 });
  const payoutStr = toCredits(totalPotentialPayout).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 });

  return (
    <div className="card bg-base-100 shadow-xl rounded-xl border border-base-200 overflow-hidden">
      <div className="card-body p-4">
        <h2 className="card-title text-base mb-3 gap-2">
          <span className="text-lg leading-none" aria-hidden>💵</span>
          Portfolio Summary
        </h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 rounded-lg bg-base-200/50 px-3 py-2">
            <span className="text-sm text-base-content/80">Total Cash</span>
            <span className="font-semibold text-primary tabular-nums">{cashStr}</span>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-base-200/50 px-3 py-2">
            <span className="text-sm text-base-content/80">Total Shares</span>
            <span className="font-semibold tabular-nums">{sharesStr}</span>
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-base-200/50 px-3 py-2">
            <span className="text-sm text-base-content/80">Markets</span>
            <span className="flex items-center gap-2 text-right">
              <span className="font-semibold tabular-nums">{totalMarkets}</span>
              <span className="text-xs text-base-content/60" title={`${openMarkets} open, ${resolvedMarkets} resolved, ${pausedMarkets} paused`}>
                {openMarkets} open · {resolvedMarkets} resolved · {pausedMarkets} paused
              </span>
            </span>
          </div>
        </div>
        <p className="text-xs text-base-content/60 mt-2">
          {toCredits(totalCommittedCollateral).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} credits committed in positions
        </p>
        {totalPotentialPayout > 0 && (
          <div className="mt-3 rounded-lg bg-success/10 border border-success/20 px-3 py-2 text-sm text-success flex items-center justify-between gap-2">
            <span>Payout available</span>
            <strong className="tabular-nums">{payoutStr} credits</strong>
          </div>
        )}
      </div>
    </div>
  );
};
