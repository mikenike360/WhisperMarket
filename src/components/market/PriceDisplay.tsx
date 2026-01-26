import React from 'react';
import { calculatePriceFromReserves } from '@/utils/positionHelpers';

interface PriceDisplayProps {
  yesReserve: number;
  noReserve: number;
}

export const PriceDisplay: React.FC<PriceDisplayProps> = ({
  yesReserve,
  noReserve,
}) => {
  // Calculate price from AMM reserves
  const priceYes = calculatePriceFromReserves(yesReserve, noReserve);
  const priceNo = 10000 - priceYes;
  
  const yesPercent = (priceYes / 100).toFixed(2);
  const noPercent = (priceNo / 100).toFixed(2);

  return (
    <div className="card bg-base-100 shadow-xl mb-6">
      <div className="card-body">
        <h3 className="card-title mb-4">Current Prices</h3>
        
        <div className="space-y-4">
          {/* YES Price */}
          <div>
            <div className="flex justify-between mb-2">
              <span className="font-semibold text-success">YES</span>
              <span className="font-bold text-success">{yesPercent}%</span>
            </div>
            <progress
              className="progress progress-success w-full"
              value={priceYes}
              max={10000}
            />
          </div>

          {/* NO Price */}
          <div>
            <div className="flex justify-between mb-2">
              <span className="font-semibold text-error">NO</span>
              <span className="font-bold text-error">{noPercent}%</span>
            </div>
            <progress
              className="progress progress-error w-full"
              value={priceNo}
              max={10000}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
