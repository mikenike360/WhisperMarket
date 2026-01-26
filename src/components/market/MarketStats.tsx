import React from 'react';

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
              {collateralPool.toLocaleString()}
            </div>
            <div className="stat-desc">Total deposited</div>
          </div>

          <div className="stat">
            <div className="stat-title">YES Reserve</div>
            <div className="stat-value text-success">
              {yesReserve.toLocaleString()}
            </div>
            <div className="stat-desc">AMM YES tokens</div>
          </div>

          <div className="stat">
            <div className="stat-title">NO Reserve</div>
            <div className="stat-value text-error">
              {noReserve.toLocaleString()}
            </div>
            <div className="stat-desc">AMM NO tokens</div>
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
