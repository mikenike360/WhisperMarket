import React from 'react';
import { toCredits } from '@/utils/credits';

interface MarketStatsProps {
  collateralPool: number;
  yesReserve: number;
  noReserve: number;
  feeBps: number;
}

export const MarketStats: React.FC<MarketStatsProps> = ({
  collateralPool,
  yesReserve,
  noReserve,
  feeBps,
}) => {
  const feePercent = (feeBps / 100).toFixed(2);
  const formatCredits = (n: number) =>
    toCredits(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body py-4">
        <h3 className="card-title text-base mb-3">Market statistics</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-base-200/60 p-3">
            <div className="text-xs text-base-content/60 uppercase tracking-wide mb-0.5">Pool</div>
            <div className="font-semibold text-primary text-lg">{formatCredits(collateralPool)}</div>
            <div className="text-xs text-base-content/50">Total liquidity (credits)</div>
          </div>
          <div className="rounded-lg bg-base-200/60 p-3">
            <div className="text-xs text-base-content/60 uppercase tracking-wide mb-0.5">Fee</div>
            <div className="font-semibold text-lg">{feePercent}%</div>
            <div className="text-xs text-base-content/50">Per swap</div>
          </div>
          <div className="rounded-lg bg-success/10 p-3">
            <div className="text-xs text-base-content/60 uppercase tracking-wide mb-0.5">YES reserve</div>
            <div className="font-semibold text-success text-lg">{formatCredits(yesReserve)}</div>
            <div className="text-xs text-base-content/50">AMM (credits)</div>
          </div>
          <div className="rounded-lg bg-error/10 p-3">
            <div className="text-xs text-base-content/60 uppercase tracking-wide mb-0.5">NO reserve</div>
            <div className="font-semibold text-error text-lg">{formatCredits(noReserve)}</div>
            <div className="text-xs text-base-content/50">AMM (credits)</div>
          </div>
        </div>
      </div>
    </div>
  );
};
