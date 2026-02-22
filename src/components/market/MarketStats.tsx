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
  const poolCreditsStr = formatCredits(collateralPool);

  return (
    <div className="card bg-base-100 shadow-xl rounded-xl overflow-hidden">
      <div className="card-body py-4">
        <h3 className="card-title text-base mb-4">Market statistics</h3>

        {/* Pool liquidity – prominent block */}
        <div className="rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg leading-none opacity-80" aria-hidden>💧</span>
            <span className="text-sm font-semibold uppercase tracking-wider text-base-content/80">
              Pool liquidity
            </span>
          </div>
          <div className="text-2xl font-bold text-primary tabular-nums mb-1">
            {poolCreditsStr}
            <span className="text-base font-medium text-base-content/70 ml-1.5">credits</span>
          </div>
          <p className="text-xs text-base-content/60">
            Total credits in the AMM pool available for trading
          </p>
        </div>

        {/* Fee and reserves */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="rounded-lg bg-base-200/60 p-3">
            <div className="text-xs text-base-content/70 uppercase tracking-wide mb-0.5">Fee</div>
            <div className="font-semibold text-lg tabular-nums">{feePercent}%</div>
            <div className="text-xs text-base-content/60">Per swap</div>
          </div>
          <div className="rounded-lg bg-success/10 border border-success/20 p-3">
            <div className="text-xs text-base-content/70 uppercase tracking-wide mb-0.5">YES reserve</div>
            <div className="font-semibold text-success text-lg tabular-nums">{formatCredits(yesReserve)}</div>
            <div className="text-xs text-base-content/60">AMM (credits)</div>
          </div>
          <div className="rounded-lg bg-error/10 border border-error/20 p-3">
            <div className="text-xs text-base-content/70 uppercase tracking-wide mb-0.5">NO reserve</div>
            <div className="font-semibold text-error text-lg tabular-nums">{formatCredits(noReserve)}</div>
            <div className="text-xs text-base-content/60">AMM (credits)</div>
          </div>
        </div>
      </div>
    </div>
  );
};
