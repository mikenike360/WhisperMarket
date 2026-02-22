import React, { useState, useEffect } from 'react';
import { getOpenMarketIdsFromCache } from '@/services/marketStateCache';

export function HeaderStats() {
  const [stats, setStats] = useState<{ activeMarkets: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId: NodeJS.Timeout | null = null;

    async function load() {
      if (document.hidden) return;
      try {
        const openIds = await getOpenMarketIdsFromCache();
        if (!cancelled) {
          setStats({ activeMarkets: openIds.length });
        }
      } catch {
        if (!cancelled) {
          setStats({ activeMarkets: 0 });
        }
      }
    }

    load();
    intervalId = setInterval(() => {
      if (!document.hidden) {
        load();
      }
    }, 30000); // Update every 30 seconds

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

  if (!stats) return null;

  return (
    <div className="hidden lg:flex items-center gap-4 text-xs text-base-content">
      <span className="font-medium">{stats.activeMarkets} Active Markets</span>
    </div>
  );
}
