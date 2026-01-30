import React from 'react';
import { calculatePriceFromReserves } from '@/utils/positionHelpers';
import { formatPriceCents } from '@/utils/priceDisplay';

interface PriceDisplayProps {
  yesReserve: number;
  noReserve: number;
}

export const PriceDisplay: React.FC<PriceDisplayProps> = ({
  yesReserve,
  noReserve,
}) => {
  // Calculate price from AMM reserves (basis points)
  const priceYes = calculatePriceFromReserves(yesReserve, noReserve);
  const priceNo = 10000 - priceYes;

  return (
    <div className="card bg-base-100 shadow-xl mb-6">
      <div className="card-body">
        <h3 className="card-title mb-1">Current price per share</h3>
        <p className="text-sm text-base-content/60 mb-4" title="¢ = cents per share">
          Price per share in cents (¢)
        </p>

        <div className="space-y-4">
          {/* YES Price */}
          <div>
            <div className="flex justify-between mb-2">
              <span className="font-semibold text-success">YES</span>
              <span className="font-bold text-success">{formatPriceCents(priceYes)}</span>
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
              <span className="font-bold text-error">{formatPriceCents(priceNo)}</span>
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
