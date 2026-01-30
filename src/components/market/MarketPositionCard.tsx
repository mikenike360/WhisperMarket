import React from 'react';
import { toCredits } from '@/utils/credits';
import type { UserPosition } from '@/types';

interface MarketPositionCardProps {
  position: UserPosition | null;
  isOpen?: boolean;
}

export const MarketPositionCard: React.FC<MarketPositionCardProps> = ({ position, isOpen }) => {
  if (!position) {
    return (
      <div className="card bg-base-100 shadow-xl rounded-xl">
        <div className="card-body">
          <h3 className="card-title text-base mb-2">Your position</h3>
          <p className="text-sm text-base-content/70">
            No position yet. Add collateral below to start trading.
          </p>
        </div>
      </div>
    );
  }

  const totalCollateral = position.collateralAvailable + position.collateralCommitted;
  const hasUnspentCollateral = position.collateralAvailable > 0;

  return (
    <div className="card bg-base-100 shadow-xl rounded-xl">
      <div className="card-body">
        <h3 className="card-title text-base mb-3">Your position</h3>
        {isOpen && hasUnspentCollateral && (
          <div className="alert alert-warning py-2 mb-3 text-sm">
            <span>Use or withdraw collateral before the market resolves. Unspent collateral cannot be withdrawn after resolution.</span>
          </div>
        )}
        <div className="rounded-lg bg-primary/10 p-3 mb-3">
          <span className="text-xs text-base-content/60 uppercase tracking-wide">Total collateral</span>
          <div className="font-semibold text-primary text-lg">
            {toCredits(totalCollateral).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} credits
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col rounded-lg bg-base-200/60 p-3">
            <span className="text-xs text-base-content/60 uppercase tracking-wide">Available</span>
            <span className="font-semibold text-primary">
              {toCredits(position.collateralAvailable).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
            </span>
            <span className="text-xs text-base-content/50">credits (for buying)</span>
          </div>
          <div className="flex flex-col rounded-lg bg-base-200/60 p-3">
            <span className="text-xs text-base-content/60 uppercase tracking-wide">Committed</span>
            <span className="font-semibold text-secondary">
              {toCredits(position.collateralCommitted).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
            </span>
            <span className="text-xs text-base-content/50">credits (backing shares)</span>
          </div>
          <div className="flex flex-col rounded-lg bg-success/10 p-3">
            <span className="text-xs text-base-content/60 uppercase tracking-wide">YES shares</span>
            <span className="font-semibold text-success">
              {toCredits(position.yesShares).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
            </span>
          </div>
          <div className="flex flex-col rounded-lg bg-error/10 p-3">
            <span className="text-xs text-base-content/60 uppercase tracking-wide">NO shares</span>
            <span className="font-semibold text-error">
              {toCredits(position.noShares).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
