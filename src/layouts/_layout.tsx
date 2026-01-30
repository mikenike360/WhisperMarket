import { useWindowScroll } from '@/hooks/use-window-scroll';
import { useIsMounted } from '@/hooks/use-is-mounted';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { WalletMultiButton } from '@provablehq/aleo-wallet-adaptor-react-ui';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { useTheme } from 'next-themes';
import Footer from '@/components/ui/Footer';
import { TransactionTracker } from '@/components/transactions/TransactionTracker';
import { ScrollingTicker } from '@/components/ui/ScrollingTicker';
import { HeaderStats } from '@/components/ui/HeaderStats';
import routes from '@/config/routes';

require('@provablehq/aleo-wallet-adaptor-react-ui/dist/styles.css');

const themes = [
  'luxury',
  'forest',
  'synthwave',
  'black',
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
      className="select select-bordered select-sm max-w-[8rem]"
    >
      {themes.map((t) => (
        <option key={t} value={t}>
          {t.charAt(0).toUpperCase() + t.slice(1)}
        </option>
      ))}
    </select>
  );
}

function HeaderRightArea() {
  return (
    <div className="relative order-last flex shrink-0 items-center gap-2 sm:gap-4 lg:gap-6">
      <ThemeSelector />
      <WalletMultiButton />
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
            className="text-xl font-bold tracking-tight text-base-content hover:opacity-80 transition-opacity"
            aria-label="Home"
          >
            WhisperMarket
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
    <div className="bg-base-100 text-base-content flex min-h-screen flex-col">
      <Header />
      <ScrollingTicker />
      <main
        className={`mb-12 flex flex-grow flex-col ${
          isLanding
            ? 'pt-20 sm:pt-28 md:pt-32 bg-primary'
            : 'pt-28 sm:pt-32 md:pt-36 bg-base-100'
        }`}
      >
        {children}
      </main>
      <Footer />
      <TransactionTracker />
    </div>
  );
}
