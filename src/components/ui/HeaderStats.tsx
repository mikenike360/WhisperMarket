import React, { useState, useEffect } from 'react';
import { getAllMarkets } from '@/lib/aleo/rpc';

export function HeaderStats() {
  const [stats, setStats] = useState<{ activeMarkets: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let intervalId: NodeJS.Timeout | null = null;

    async function load() {
      if (document.hidden) return;
      try {
        const registry = await getAllMarkets();
        const activeMarkets = registry.filter((m) => m.status === 0).length;
        if (!cancelled) {
          setStats({ activeMarkets });
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
    <div className="hidden lg:flex items-center gap-4 text-xs text-base-content/70">
      <span className="font-medium">{stats.activeMarkets} Active Markets</span>
    </div>
  );
}
