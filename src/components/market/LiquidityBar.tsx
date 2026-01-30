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

  return (
    <div className={className}>
      {showLabel && (
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-base-content/60">Liquidity</span>
          <span className="text-xs font-medium text-base-content/80">
            {poolCredits.toLocaleString(undefined, {
              minimumFractionDigits: 0,
              maximumFractionDigits: 2,
            })}{' '}
            credits
          </span>
        </div>
      )}
      <div className="w-full h-2 bg-base-200 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ${getLiquidityColor()}`}
          style={{
            width: maxPool ? `${Math.min(percentage, 100)}%` : '100%',
          }}
        />
      </div>
    </div>
  );
}
