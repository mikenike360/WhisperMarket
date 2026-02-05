import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { getAllMarkets, getMarketState } from '@/lib/aleo/rpc';
import { getMarketsMetadata } from '@/services/marketMetadata';
import { calculatePriceFromReserves } from '@/utils/positionHelpers';
import { formatPriceCents } from '@/utils/priceDisplay';
import { toCredits } from '@/utils/credits';
import routes from '@/config/routes';

interface TickerItem {
  marketId: string;
  title: string;
  priceYes: number;
  priceNo: number;
  pool: number;
}

export function ScrollingTicker() {
  const [tickerItems, setTickerItems] = useState<TickerItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let intervalId: NodeJS.Timeout | null = null;

    async function load() {
      if (document.hidden) return; // Don't fetch when tab is hidden

      try {
        const registry = await getAllMarkets();
        const active = registry
          .filter((m) => m.status === 0)
          .sort((a, b) => {
            // Sort by marketId for consistent ordering (we don't have volume data)
            return a.marketId.localeCompare(b.marketId);
          })
          .slice(0, 10);

        if (active.length === 0) {
          if (!cancelled) {
            setTickerItems([]);
            setLoading(false);
          }
          return;
        }

        const ids = active.map((m) => m.marketId);
        const metadataMap = await getMarketsMetadata(ids);
        const stateResults = await Promise.all(
          active.map((m) => getMarketState(m.marketId).catch(() => null))
        );
        if (cancelled) return;
        const results: TickerItem[] = [];
        for (let i = 0; i < active.length; i++) {
          const state = stateResults[i];
          if (!state) continue;
          const m = active[i];
          const meta = metadataMap[m.marketId];
          const priceYes = calculatePriceFromReserves(state.yesReserve, state.noReserve);
          const priceNo = 10000 - priceYes;
          results.push({
            marketId: m.marketId,
            title: meta?.title ?? `Market ${m.marketId.slice(0, 8)}...`,
            priceYes,
            priceNo,
            pool: state.collateralPool,
          });
        }

        if (!cancelled) {
          setTickerItems(results);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setTickerItems([]);
          setLoading(false);
        }
      }
    }

    load();
    // Refresh every 10 seconds
    intervalId = setInterval(() => {
      if (!document.hidden) {
        load();
      }
    }, 10000);

    // Handle visibility change
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        load();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const tickerContent = useMemo(() => {
    if (tickerItems.length === 0) return [];
    // Always duplicate once for seamless infinite scroll
    // The animation moves by 50%, which perfectly loops back to the start
    return [...tickerItems, ...tickerItems];
  }, [tickerItems]);

  // Always show ticker, even if no markets (show placeholder or empty state)
  if (loading) {
    return (
      <div className="hidden md:block fixed top-16 sm:top-20 z-20 w-full bg-base-200 border-b border-base-300 h-10 overflow-hidden">
        <div className="flex items-center justify-center h-full">
          <span className="text-xs text-base-content/60">Loading markets...</span>
        </div>
      </div>
    );
  }

  if (tickerItems.length === 0) {
    return (
      <div className="hidden md:block fixed top-16 sm:top-20 z-20 w-full bg-base-200 border-b border-base-300 h-10 overflow-hidden">
        <div className="flex items-center justify-center h-full">
          <span className="text-xs text-base-content/60">No active markets</span>
        </div>
      </div>
    );
  }

  return (
    <div className="hidden md:block fixed top-16 sm:top-20 z-20 w-full bg-base-200 border-b border-base-300 h-10 overflow-hidden" aria-live="polite">
      <div className="flex items-center h-full animate-scroll-ticker will-change-transform" style={{ width: 'max-content' }}>
        {tickerContent.map((item, idx) => (
          <Link
            key={`${item.marketId}-${idx}`}
            href={`${routes.market}?marketId=${encodeURIComponent(item.marketId)}`}
            className="flex items-center gap-4 px-6 h-full whitespace-nowrap hover:bg-base-300 transition-colors text-sm text-base-content/90 hover:text-base-content flex-shrink-0"
          >
            <span className="font-semibold truncate max-w-[200px]">{item.title}</span>
            <span className="text-success font-medium">
              YES {formatPriceCents(item.priceYes, { decimals: 1 })}
            </span>
            <span className="text-error font-medium">
              NO {formatPriceCents(item.priceNo, { decimals: 1 })}
            </span>
            <span className="text-base-content/60">
              Pool: {toCredits(item.pool).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} credits
            </span>
            <span className="text-base-content/40">•</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
