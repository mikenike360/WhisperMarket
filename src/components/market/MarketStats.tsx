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
  
  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h3 className="card-title mb-4">Market Statistics</h3>
        
        <div className="stats stats-vertical lg:stats-horizontal shadow w-full">
          <div className="stat">
            <div className="stat-title">Collateral Pool</div>
            <div className="stat-value text-primary">
              {toCredits(collateralPool).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
            </div>
            <div className="stat-desc">Initial liquidity + all deposits (credits). Each 1-credit deposit adds 1 to this.</div>
          </div>

          <div className="stat">
            <div className="stat-title">YES Reserve</div>
            <div className="stat-value text-success">
              {toCredits(yesReserve).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
            </div>
            <div className="stat-desc">AMM YES tokens (credits)</div>
          </div>

          <div className="stat">
            <div className="stat-title">NO Reserve</div>
            <div className="stat-value text-error">
              {toCredits(noReserve).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
            </div>
            <div className="stat-desc">AMM NO tokens (credits)</div>
          </div>

          <div className="stat">
            <div className="stat-title">Trading Fee</div>
            <div className="stat-value">
              {feePercent}%
            </div>
            <div className="stat-desc">Per swap</div>
          </div>
        </div>
      </div>
    </div>
  );
};
