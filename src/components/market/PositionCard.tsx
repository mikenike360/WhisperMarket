import React from 'react';
import { toCredits } from '@/utils/credits';

interface PositionCardProps {
  yesShares: number;
  noShares: number;
  collateralAvailable: number;
  collateralCommitted: number;
  payoutClaimed: boolean;
}

export const PositionCard: React.FC<PositionCardProps> = ({
  yesShares,
  noShares,
  collateralAvailable,
  collateralCommitted,
  payoutClaimed,
}) => {
  const totalCollateral = collateralAvailable + collateralCommitted;

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h3 className="card-title mb-4">Your Positions</h3>
        
        <div className="stats stats-vertical lg:stats-horizontal shadow w-full mb-4">
          <div className="stat">
            <div className="stat-title">YES Shares</div>
            <div className="stat-value text-success">
              {toCredits(yesShares).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
            </div>
            <div className="stat-desc">credits</div>
          </div>

          <div className="stat">
            <div className="stat-title">NO Shares</div>
            <div className="stat-value text-error">
              {toCredits(noShares).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
            </div>
            <div className="stat-desc">credits</div>
          </div>

          <div className="stat">
            <div className="stat-title">Available Collateral</div>
            <div className="stat-value text-primary">
              {toCredits(collateralAvailable).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
            </div>
            <div className="stat-desc">For swaps/withdrawals (credits)</div>
          </div>

          <div className="stat">
            <div className="stat-title">Committed Collateral</div>
            <div className="stat-value text-secondary">
              {toCredits(collateralCommitted).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
            </div>
            <div className="stat-desc">Backing shares (credits)</div>
          </div>
        </div>

        {payoutClaimed && (
          <div className="alert alert-success mt-4">
            <span>Payout has been claimed</span>
          </div>
        )}
      </div>
    </div>
  );
};
