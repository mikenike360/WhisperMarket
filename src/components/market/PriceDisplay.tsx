import React, { useState, useEffect } from 'react';
import { calculatePriceFromReserves } from '@/utils/positionHelpers';
import { AnimatedPrice } from '@/components/ui/AnimatedPrice';

interface PriceDisplayProps {
  yesReserve: number;
  noReserve: number;
}

export const PriceDisplay: React.FC<PriceDisplayProps> = ({
  yesReserve,
  noReserve,
}) => {
  const [priceYes, setPriceYes] = useState(() =>
    calculatePriceFromReserves(yesReserve, noReserve)
  );
  const [priceNo, setPriceNo] = useState(() => 10000 - priceYes);

  useEffect(() => {
    const newPriceYes = calculatePriceFromReserves(yesReserve, noReserve);
    const newPriceNo = 10000 - newPriceYes;
    setPriceYes(newPriceYes);
    setPriceNo(newPriceNo);
  }, [yesReserve, noReserve]);

  return (
    <div className="card bg-base-100 shadow-xl mb-6 rounded-xl">
      <div className="card-body">
        <h3 className="card-title mb-1">Probability / Price per share</h3>
        <p className="text-sm text-base-content/60 mb-4" title="¢ = cents per share">
          Price per share in cents (¢). YES + NO = 100¢.
        </p>

        <div className="flex justify-between items-baseline mb-2">
          <span className="text-success font-bold text-2xl sm:text-3xl">
            <AnimatedPrice priceBps={priceYes} decimals={1} showChange />
          </span>
          <span className="text-base-content/60 text-sm font-medium">YES</span>
        </div>
        <div className="flex w-full rounded-full overflow-hidden bg-base-200 h-4 mb-4">
          <div
            className="bg-success h-full transition-all duration-300"
            style={{ width: `${(priceYes / 10000) * 100}%` }}
          />
          <div
            className="bg-error h-full transition-all duration-300"
            style={{ width: `${(priceNo / 10000) * 100}%` }}
          />
        </div>

        <div className="flex justify-between items-baseline mb-2">
          <span className="text-error font-bold text-2xl sm:text-3xl">
            <AnimatedPrice priceBps={priceNo} decimals={1} showChange />
          </span>
          <span className="text-base-content/60 text-sm font-medium">NO</span>
        </div>
      </div>
    </div>
  );
};
