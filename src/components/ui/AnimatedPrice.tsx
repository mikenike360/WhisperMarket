import React, { useEffect, useState, useRef } from 'react';
import { formatPriceCents } from '@/utils/priceDisplay';

interface AnimatedPriceProps {
  priceBps: number;
  className?: string;
  decimals?: number;
  showChange?: boolean;
}

export function AnimatedPrice({
  priceBps,
  className = '',
  decimals = 1,
  showChange = false,
}: AnimatedPriceProps) {
  const [displayPrice, setDisplayPrice] = useState(priceBps);
  const [changeDirection, setChangeDirection] = useState<'up' | 'down' | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevPriceRef = useRef<number>(priceBps);

  useEffect(() => {
    if (prevPriceRef.current !== priceBps) {
      const direction = priceBps > prevPriceRef.current ? 'up' : 'down';
      setChangeDirection(direction);
      setIsAnimating(true);
      setDisplayPrice(priceBps);

      const timer = setTimeout(() => {
        setIsAnimating(false);
        setChangeDirection(null);
      }, 600);

      prevPriceRef.current = priceBps;
      return () => clearTimeout(timer);
    }
  }, [priceBps]);

  const colorClass =
    changeDirection === 'up'
      ? 'text-success'
      : changeDirection === 'down'
      ? 'text-error'
      : '';

  const animationClass = isAnimating ? 'animate-pulse' : '';

  return (
    <span
      className={`transition-all duration-300 ${colorClass} ${animationClass} ${className}`}
    >
      {formatPriceCents(displayPrice, { decimals })}
    </span>
  );
}
