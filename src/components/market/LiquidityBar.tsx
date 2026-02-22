import React from 'react';
import { toCredits } from '@/utils/credits';

interface LiquidityBarProps {
  collateralPool: number;
  maxPool?: number;
  showLabel?: boolean;
  className?: string;
}

export function LiquidityBar({
  collateralPool,
  maxPool,
  showLabel = true,
  className = '',
}: LiquidityBarProps) {
  const poolCredits = toCredits(collateralPool);
  const percentage = maxPool ? (collateralPool / maxPool) * 100 : 0;
  
  // Determine liquidity level for color
  const getLiquidityColor = () => {
    if (!maxPool) return 'bg-primary';
    const ratio = collateralPool / maxPool;
    if (ratio > 0.7) return 'bg-success';
    if (ratio > 0.3) return 'bg-warning';
    return 'bg-error';
  };

  const creditsStr = poolCredits.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  return (
    <div className={className}>
      {showLabel && (
        <div className="flex justify-between items-baseline gap-2 mb-2">
          <span className="text-sm font-medium text-base-content/80">Pool depth</span>
          <span className="text-sm font-semibold tabular-nums text-base-content">
            {creditsStr} <span className="font-normal text-base-content/70">credits</span>
          </span>
        </div>
      )}
      <div className="w-full h-2.5 bg-base-200 rounded-full overflow-hidden border border-base-300/50">
        <div
          className={`h-full rounded-full transition-all duration-300 ${getLiquidityColor()}`}
          style={{
            width: maxPool ? `${Math.min(percentage, 100)}%` : '100%',
          }}
        />
      </div>
    </div>
  );
}
