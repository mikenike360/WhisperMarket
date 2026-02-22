import React from 'react';
import { toCredits } from '@/utils/credits';
import type { UserPosition } from '@/types';

interface MarketPositionCardProps {
  position: UserPosition | null;
  /** Global collateral balance (microcredits). Shown as available when present. */
  globalBalance?: number;
  isOpen?: boolean;
}

export const MarketPositionCard: React.FC<MarketPositionCardProps> = ({ position, globalBalance, isOpen }) => {
  if (!position) {
    return (
      <div className="card bg-base-100 shadow-xl rounded-xl">
        <div className="card-body">
          <h3 className="card-title text-base mb-2">Your position</h3>
          <p className="text-sm text-base-content">
            No position yet. Open a position below, then add Cash from Portfolio to start trading.
          </p>
        </div>
      </div>
    );
  }

  const available = globalBalance ?? position.collateralAvailable;
  return (
    <div className="card bg-base-100 shadow-xl rounded-xl">
      <div className="card-body">
        <h3 className="card-title text-base mb-3">Your position</h3>
        <div className="rounded-lg bg-primary/10 p-3 mb-3">
          <span className="text-xs text-base-content uppercase tracking-wide">Available Cash</span>
          <div className="font-semibold text-primary text-lg">
            {toCredits(available).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} credits
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col rounded-lg bg-base-200/60 p-3">
            <span className="text-xs text-base-content uppercase tracking-wide">Committed</span>
            <span className="font-semibold text-base-content">
              {toCredits(position.yesShares + position.noShares).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
            </span>
            <span className="text-xs text-base-content">credits (YES + NO shares)</span>
          </div>
          <div className="flex flex-col rounded-lg bg-success/10 p-3">
            <span className="text-xs text-base-content uppercase tracking-wide">YES shares</span>
            <span className="font-semibold text-success">
              {toCredits(position.yesShares).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
            </span>
          </div>
          <div className="flex flex-col rounded-lg bg-error/10 p-3">
            <span className="text-xs text-base-content uppercase tracking-wide">NO shares</span>
            <span className="font-semibold text-error">
              {toCredits(position.noShares).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
