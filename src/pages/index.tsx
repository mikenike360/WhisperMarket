import type { NextPageWithLayout } from '@/types';
import { NextSeo } from 'next-seo';
import Layout from '@/layouts/_layout';
import Button from '@/components/ui/button';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import { getAllMarkets, getMarketState } from '@/lib/aleo/rpc';
import { getMarketsMetadata } from '@/services/marketMetadata';
import { calculatePriceFromReserves } from '@/utils/positionHelpers';
import { formatPriceCents } from '@/utils/priceDisplay';
import routes from '@/config/routes';
import { SkeletonCard } from '@/components/ui/SkeletonCard';
import { PlatformStats } from '@/components/ui/PlatformStats';
import { AnimatedPrice } from '@/components/ui/AnimatedPrice';
import { useIntersectionObserver } from '@/hooks/use-intersection-observer';

interface PreviewMarket {
  marketId: string;
  title: string;
  description: string;
  priceYes: number;
  priceNo: number;
}

const FEATURES = [
  {
    title: 'Private & on-chain',
    description: 'Markets and positions are settled on Aleo with privacy-preserving execution.',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
  },
  {
    title: 'YES / NO markets',
    description: 'Trade shares on binary outcomes. Buy YES if you think it will happen, NO if not.',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    title: 'Aleo-powered',
    description: 'Built on Aleo for programmable privacy and verifiable on-chain resolution.',
    icon: (
      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
];

const MainPage: NextPageWithLayout = () => {
  const router = useRouter();
  const [previewMarkets, setPreviewMarkets] = useState<PreviewMarket[]>([]);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [featuresRef, featuresVisible] = useIntersectionObserver({ threshold: 0.1 });
  const [marketsRef, marketsVisible] = useIntersectionObserver({ threshold: 0.1 });

  useEffect(() => {
    let cancelled = false;
    let intervalId: NodeJS.Timeout | null = null;

    async function load() {
      if (document.hidden) return; // Don't fetch when tab is hidden

      try {
        const registry = await getAllMarkets();
        const active = registry.filter((m) => m.status === 0).slice(0, 3);
        if (active.length === 0) {
          setPreviewMarkets([]);
          setPreviewLoading(false);
          return;
        }
        const ids = active.map((m) => m.marketId);
        const metadataMap = await getMarketsMetadata(ids);
        const stateResults = await Promise.all(
          active.map((m) => getMarketState(m.marketId).catch(() => null))
        );
        if (cancelled) return;
        const results: PreviewMarket[] = [];
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
            description: meta?.description ?? 'Prediction market',
            priceYes,
            priceNo,
          });
        }
        if (!cancelled) {
          setPreviewMarkets(results);
          setPreviewLoading(false);
        }
      } catch {
        if (!cancelled) {
          setPreviewMarkets([]);
          setPreviewLoading(false);
        }
      }
    }

    load();
    // Poll every 8 seconds
    intervalId = setInterval(() => {
      if (!document.hidden) {
        load();
      }
    }, 8000);

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

  return (
    <>
      <NextSeo
        title="WhisperMarket"
        description="Private prediction marketplace on Aleo. Trade YES/NO shares on binary outcomes with privacy-preserving execution."
      />

      <div className="min-h-full flex flex-col">
        {/* Hero */}
        <section className="relative flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8 py-20 sm:py-28 md:py-32 text-center">
          <h1
            className="relative text-5xl font-black tracking-tight sm:text-6xl md:text-7xl leading-tight"
            style={{
              color: '#ffffff',
              textShadow: '0 2px 4px rgba(0,0,0,0.8), 0 4px 12px rgba(0,0,0,0.6)',
            }}
          >
            WhisperMarket
          </h1>
          <p
            className="relative mt-6 mb-8 text-lg sm:text-xl font-semibold max-w-lg"
            style={{
              color: '#ffffff',
              textShadow: '0 2px 4px rgba(0,0,0,0.8)',
            }}
          >
            A Private Prediction Marketplace built on the Aleo blockchain.
          </p>
          <div className="relative flex flex-col sm:flex-row items-center gap-4">
            <Button
              onClick={() => router.push(routes.markets)}
              className="btn btn-primary px-6 py-3 text-lg font-semibold"
            >
              Browse Markets
            </Button>
            <a
              href="#features"
              className="link link-hover font-bold text-base"
              style={{ color: '#ffffff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
            >
              How it works →
            </a>
          </div>
        </section>

        {/* Platform Stats */}
        <section className="px-4 sm:px-6 lg:px-8 py-8">
          <div className="max-w-7xl mx-auto">
            <PlatformStats />
          </div>
        </section>

        {/* Features */}
        <section id="features" className="px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <div className="max-w-7xl mx-auto">
            <h2
              className="text-3xl sm:text-4xl font-black text-center mb-8 sm:mb-12"
              style={{
                color: '#ffffff',
                textShadow: '0 2px 4px rgba(0,0,0,0.8), 0 4px 12px rgba(0,0,0,0.6)',
              }}
            >
              Why WhisperMarket
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
              {FEATURES.map((f, idx) => (
                <div
                  key={f.title}
                  className="card shadow-xl rounded-xl hover:shadow-2xl hover:-translate-y-1 transition-all duration-200"
                  style={{ backgroundColor: '#171717', borderColor: '#404040', borderWidth: 1 }}
                >
                  <div className="card-body items-center text-center p-6">
                    <div style={{ color: '#ffffff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>{f.icon}</div>
                    <h3 className="card-title text-lg font-bold" style={{ color: '#ffffff', textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}>{f.title}</h3>
                    <p className="text-sm font-medium" style={{ color: '#ffffff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>{f.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Markets preview */}
        <section
          ref={marketsRef as React.RefObject<HTMLElement>}
          className={`px-4 sm:px-6 lg:px-8 py-12 sm:py-16 transition-all duration-700 ${
            marketsVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-12">
              <h2
                className="text-3xl sm:text-4xl font-black"
                style={{
                  color: '#ffffff',
                  textShadow: '0 2px 4px rgba(0,0,0,0.8), 0 4px 12px rgba(0,0,0,0.6)',
                }}
              >
                Explore markets
              </h2>
              <Link href={routes.markets} className="btn btn-primary btn-sm sm:btn-md">
                View all markets
              </Link>
            </div>
            {previewLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map((i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : previewMarkets.length === 0 ? (
              <div className="card shadow-xl rounded-xl" style={{ backgroundColor: '#171717', borderColor: '#404040', borderWidth: 1 }}>
                <div className="card-body items-center text-center py-12">
                  <p className="font-medium" style={{ color: '#ffffff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>No active markets yet.</p>
                  <Link href={routes.markets} className="btn btn-primary btn-sm mt-2">
                    View markets
                  </Link>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {previewMarkets.map((m) => (
                  <Link
                    key={m.marketId}
                    href={`${routes.market}?marketId=${encodeURIComponent(m.marketId)}`}
                    className="card shadow-xl rounded-xl hover:shadow-2xl transition-all duration-200 hover:-translate-y-1"
                    style={{ backgroundColor: '#171717', borderColor: '#404040', borderWidth: 1 }}
                  >
                    <div className="card-body p-5">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h3 className="font-bold line-clamp-2 flex-1" style={{ color: '#ffffff', textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}>{m.title}</h3>
                      </div>
                      <p className="text-sm font-medium line-clamp-1 mb-3" style={{ color: '#ffffff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>{m.description}</p>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="text-success font-bold">
                          <AnimatedPrice priceBps={m.priceYes} decimals={1} showChange />{' '}
                          <span className="font-semibold text-xs" style={{ color: '#ffffff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>YES</span>
                        </span>
                        <span className="text-error font-bold">
                          <AnimatedPrice priceBps={m.priceNo} decimals={1} showChange />{' '}
                          <span className="font-semibold text-xs" style={{ color: '#ffffff', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>NO</span>
                        </span>
                      </div>
                      <div className="flex w-full rounded-full overflow-hidden h-3" style={{ backgroundColor: '#404040' }}>
                        <div
                          className="bg-success h-full transition-all"
                          style={{ width: `${(m.priceYes / 10000) * 100}%` }}
                        />
                        <div
                          className="bg-error h-full transition-all"
                          style={{ width: `${(m.priceNo / 10000) * 100}%` }}
                        />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Footer CTA - Subtle */}
        <section className="px-4 sm:px-6 lg:px-8 py-12">
          <div className="max-w-7xl mx-auto text-center">
            <Link
              href={routes.markets}
              className="link link-hover text-base font-extrabold inline-flex items-center gap-2"
              style={{
                color: '#ffffff',
                textShadow: '0 2px 4px rgba(0,0,0,0.8)',
              }}
            >
              View all markets →
            </Link>
          </div>
        </section>
      </div>
    </>
  );
};

MainPage.getLayout = (page) => <Layout>{page}</Layout>;
export default MainPage;
