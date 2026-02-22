import { useWindowScroll } from '@/hooks/use-window-scroll';
import { useIsMounted } from '@/hooks/use-is-mounted';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { WalletMultiButton } from '@provablehq/aleo-wallet-adaptor-react-ui';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { useTheme } from 'next-themes';
import Footer from '@/components/ui/Footer';
import { ScrollingTicker } from '@/components/ui/ScrollingTicker';
import VoxelShaderBackground from '@/components/ui/VoxelShaderBackground';
import { fetchUserCollateral } from '@/lib/aleo/rpc';
import { toCredits } from '@/utils/credits';
import routes from '@/config/routes';

require('@provablehq/aleo-wallet-adaptor-react-ui/dist/styles.css');

const themes = [
  'light',
  'dark',
  'retro',
  'black',
  'luxury',
  'forest',
  'synthwave',
  'cupcake',
  'dracula',
  'night',
];

function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <select
      value={theme}
      onChange={(e) => setTheme(e.target.value)}
      className="select select-bordered select-sm min-w-[9.5rem] sm:min-w-0 max-w-[11rem]"
    >
      {themes.map((t) => (
        <option key={t} value={t}>
          {t.charAt(0).toUpperCase() + t.slice(1)}
        </option>
      ))}
    </select>
  );
}

function HeaderCashBalance() {
  const { publicKey, address } = useWallet();
  const userAddress = publicKey || address;
  const [cashBalance, setCashBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!userAddress) {
      setCashBalance(null);
      return;
    }
    let cancelled = false;
    fetchUserCollateral(userAddress).then((balance) => {
      if (!cancelled) setCashBalance(balance);
    }).catch(() => {
      if (!cancelled) setCashBalance(null);
    });
    return () => { cancelled = true; };
  }, [userAddress]);

  if (!userAddress || cashBalance === null) return null;
  const credits = toCredits(cashBalance);
  const full = credits.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 });
  const short = credits.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return (
    <Link
      href={routes.portfolio}
      className="inline-flex items-center gap-1.5 rounded-lg bg-base-300/80 px-2.5 py-1 text-sm font-medium text-base-content transition-colors hover:bg-base-300"
      title={`Cash: ${full} credits — go to portfolio`}
    >
      <span className="text-base leading-none" aria-hidden>💵</span>
      <span className="tabular-nums">{short}</span>
    </Link>
  );
}

function HeaderRightArea() {
  return (
    <div className="relative order-last flex shrink-0 items-center gap-2 sm:gap-4 lg:gap-6">
      <ThemeSelector />
      <HeaderCashBalance />
      <div className="wallet-button-wrap flex items-center shrink-0">
        <WalletMultiButton />
      </div>
    </div>
  );
}

export function Header() {
  const windowScroll = useWindowScroll();
  const isMounted = useIsMounted();

  return (
    <nav
      className={`fixed top-0 z-30 w-full bg-base-200 transition-all duration-300 ${
        isMounted && windowScroll.y > 10 ? 'shadow-card backdrop-blur' : ''
      }`}
    >
      <div className="flex flex-wrap items-center justify-between px-4 py-4 sm:px-6 lg:px-8 xl:px-10 3xl:px-12">
        <div className="flex items-center gap-4 sm:gap-6">
          <Link
            href={routes.home}
            className="flex items-center gap-2 text-xl font-bold tracking-tight text-base-content hover:opacity-80 transition-opacity"
            aria-label="Home"
          >
            <img src="/logo.png" alt="" className="h-8 w-auto" width={32} height={32} />
            <span>WhisperMarket</span>
          </Link>
          <nav className="flex items-center gap-3 sm:gap-4">
            <Link href={routes.markets} className="link link-hover font-medium text-sm sm:text-base">
              Markets
            </Link>
            <Link href={routes.portfolio} className="link link-hover font-medium text-sm sm:text-base">
              Portfolio
            </Link>
          </nav>
        </div>
        <div className="flex items-center">
          <HeaderRightArea />
        </div>
      </div>
    </nav>
  );
}

interface LayoutProps {}

export default function Layout({
  children,
}: React.PropsWithChildren<LayoutProps>) {
  const router = useRouter();
  const isLanding = router.pathname === '/';

  return (
    <div
      className={`flex min-h-screen flex-col ${isLanding ? 'bg-transparent text-base-content' : 'bg-base-100 text-base-content'}`}
      data-landing={isLanding ? 'true' : undefined}
    >
      {isLanding && <VoxelShaderBackground />}
      <Header />
      <ScrollingTicker />
      <main
        className={`mb-12 flex flex-grow flex-col ${
          isLanding
            ? 'relative z-10 pt-20 sm:pt-28 md:pt-32 bg-transparent'
            : 'pt-28 sm:pt-32 md:pt-36 bg-base-100'
        }`}
      >
        {children}
      </main>
      <Footer isLanding={isLanding} />
    </div>
  );
}
