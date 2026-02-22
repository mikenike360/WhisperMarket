import React, { useState, useEffect } from 'react';
import { getTotalMarketsCount, getMarketState } from '@/lib/aleo/rpc';
import { getOpenMarketIdsFromCache, getCachedMarketStates } from '@/services/marketStateCache';
import { toCredits } from '@/utils/credits';

interface PlatformStatsProps {
  className?: string;
}

export function PlatformStats({ className = '' }: PlatformStatsProps) {
  const [stats, setStats] = useState<{
    totalMarkets: number;
    totalCollateral: number;
    activeMarkets: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const openIds = await getOpenMarketIdsFromCache();
        const [totalMarkets, cachedStates] = await Promise.all([
          getTotalMarketsCount(),
          openIds.length > 0 ? getCachedMarketStates(openIds, { allowStale: true }) : Promise.resolve({}),
        ]);
        const activeMarkets = openIds.length;
        let totalCollateral = 0;
        for (const marketId of openIds) {
          const state = cachedStates[marketId];
          if (state) {
            totalCollateral += state.collateralPool;
          }
        }
        const missIds = openIds.filter((id) => !cachedStates[id]).slice(0, 20);
        if (missIds.length > 0 && !cancelled) {
          const pools = await Promise.all(
            missIds.map((marketId) =>
              getMarketState(marketId).then((s) => s.collateralPool).catch(() => 0)
            )
          );
          totalCollateral += pools.reduce((sum, p) => sum + p, 0);
        }

        if (!cancelled) {
          setStats({
            totalMarkets,
            activeMarkets,
            totalCollateral,
          });
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setStats({
            totalMarkets: 0,
            activeMarkets: 0,
            totalCollateral: 0,
          });
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className={`card shadow-xl rounded-xl ${className}`} style={{ backgroundColor: '#171717', borderColor: '#404040', borderWidth: 1 }}>
        <div className="card-body py-4">
          <div className="stats stats-horizontal w-full">
            {[1, 2, 3].map((i) => (
              <div key={i} className="stat animate-pulse">
                <div className="stat-title h-4 bg-base-300 rounded w-20 mb-2" />
                <div className="stat-value h-8 bg-base-300 rounded w-24" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className={`card shadow-xl rounded-xl ${className}`} style={{ backgroundColor: '#171717', borderColor: '#404040', borderWidth: 1 }}>
      <div className="card-body py-4">
        <div className="stats stats-vertical lg:stats-horizontal shadow w-full">
          <div className="stat">
            <div className="stat-title text-sm font-bold" style={{ color: '#ffffff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>Active Markets</div>
            <div className="stat-value text-3xl font-bold text-primary">{stats.activeMarkets}</div>
            <div className="stat-desc text-sm font-medium" style={{ color: '#ffffff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>{stats.totalMarkets} total markets</div>
          </div>
          <div className="stat">
            <div className="stat-title text-sm font-bold" style={{ color: '#ffffff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>Total Aleo credits</div>
            <div className="stat-value text-3xl font-bold text-success">
              {toCredits(stats.totalCollateral).toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2,
              })}
            </div>
            <div className="stat-desc text-sm font-medium" style={{ color: '#ffffff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>in pools</div>
          </div>
          <div className="stat">
            <div className="stat-title text-sm font-bold" style={{ color: '#ffffff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>Platform Status</div>
            <div className="stat-value text-2xl">
              <span className="badge badge-success badge-lg">Live</span>
            </div>
            <div className="stat-desc text-sm font-medium" style={{ color: '#ffffff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>Built on Aleo</div>
          </div>
        </div>
      </div>
    </div>
  );
}
