import React, { useState, useEffect, useMemo } from 'react';
import { getAllMarkets, getMarketState } from '@/lib/aleo/rpc';
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
        const registry = await getAllMarkets();
        const active = registry.filter((m) => m.status === 0);
        const totalMarkets = registry.length;
        const activeMarkets = active.length;

        // Calculate total collateral from active markets
        let totalCollateral = 0;
        const marketPromises = active.slice(0, 20).map(async (m) => {
          try {
            const state = await getMarketState(m.marketId);
            return state.collateralPool;
          } catch {
            return 0;
          }
        });
        const pools = await Promise.all(marketPromises);
        totalCollateral = pools.reduce((sum, pool) => sum + pool, 0);

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
            <div className="stat-title text-sm font-bold" style={{ color: '#ffffff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>Total Collateral</div>
            <div className="stat-value text-3xl font-bold text-success">
              {toCredits(stats.totalCollateral).toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2,
              })}
            </div>
            <div className="stat-desc text-sm font-medium" style={{ color: '#ffffff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>credits in pools</div>
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
