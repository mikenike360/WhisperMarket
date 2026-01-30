import React from 'react';
import { UserPosition, MarketState } from '@/types';
import { toCredits } from '@/utils/credits';

interface PortfolioSummaryProps {
  positions: Array<{
    position: UserPosition;
    marketState: MarketState | null;
  }>;
}

export const PortfolioSummary: React.FC<PortfolioSummaryProps> = ({ positions }) => {
  const totalMarkets = positions.length;
  const totalYesShares = positions.reduce((sum, p) => sum + p.position.yesShares, 0);
  const totalNoShares = positions.reduce((sum, p) => sum + p.position.noShares, 0);
  const totalAvailableCollateral = positions.reduce(
    (sum, p) => sum + p.position.collateralAvailable,
    0
  );
  const totalCommittedCollateral = positions.reduce(
    (sum, p) => sum + p.position.collateralCommitted,
    0
  );
  const totalCollateral = totalAvailableCollateral + totalCommittedCollateral;

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

  return (
    <div className="card bg-base-100 shadow-xl mb-6 rounded-xl border border-base-200">
      <div className="card-body">
        <h2 className="card-title mb-4">Portfolio Summary</h2>
        <div className="stats stats-vertical lg:stats-horizontal shadow w-full">
          <div className="stat">
            <div className="stat-title">Total Markets</div>
            <div className="stat-value">{totalMarkets}</div>
            <div className="stat-desc">
              {openMarkets} open, {resolvedMarkets} resolved, {pausedMarkets} paused
            </div>
          </div>

          <div className="stat">
            <div className="stat-title">Total Collateral</div>
            <div className="stat-value text-primary">
              {toCredits(totalCollateral).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
            </div>
            <div className="stat-desc">
              {toCredits(totalAvailableCollateral).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} available,{' '}
              {toCredits(totalCommittedCollateral).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} committed (credits)
            </div>
          </div>

          <div className="stat">
            <div className="stat-title">Total Shares</div>
            <div className="stat-value">
              {toCredits(totalYesShares + totalNoShares).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
            </div>
            <div className="stat-desc">
              {toCredits(totalYesShares).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} YES, {toCredits(totalNoShares).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} NO (credits)
            </div>
          </div>

          {totalPotentialPayout > 0 && (
            <div className="stat">
              <div className="stat-title">Potential Payout</div>
              <div className="stat-value text-success">
                {toCredits(totalPotentialPayout).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
              </div>
              <div className="stat-desc">From resolved markets (credits)</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
