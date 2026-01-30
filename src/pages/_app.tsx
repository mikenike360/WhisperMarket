// _app.tsx
import type { AppProps } from 'next/app';
import type { NextPageWithLayout } from '@/types';
import { useState } from 'react';
import Head from 'next/head';
import Script from 'next/script';
import { Hydrate, QueryClient, QueryClientProvider } from 'react-query';
import { ReactQueryDevtools } from 'react-query/devtools';
import { ThemeProvider } from 'next-themes';

// Import Aleo Wallet Adapter dependencies
import { AleoWalletProvider } from '@provablehq/aleo-wallet-adaptor-react';
import { WalletModalProvider } from '@provablehq/aleo-wallet-adaptor-react-ui';
import { LeoWalletAdapter } from '@provablehq/aleo-wallet-adaptor-leo';
import { FoxWalletAdapter } from '@provablehq/aleo-wallet-adaptor-fox';
import { SoterWalletAdapter } from '@provablehq/aleo-wallet-adaptor-soter';
import { ShieldWalletAdapter } from '@provablehq/aleo-wallet-adaptor-shield';
import { DecryptPermission } from '@provablehq/aleo-wallet-adaptor-core';
import { Network } from '@provablehq/aleo-types';

// Lazy load PuzzleWalletAdapter to avoid ESM issues with @puzzlehq/sdk-core
let PuzzleWalletAdapter: any = null;
try {
  const puzzleModule = require('@provablehq/aleo-wallet-adaptor-puzzle');
  PuzzleWalletAdapter = puzzleModule.PuzzleWalletAdapter;
} catch {
  // PuzzleWalletAdapter not available
}

// Import global styles and wallet modal styles
import 'swiper/swiper-bundle.css';

import '@/assets/css/globals.css';

require('@provablehq/aleo-wallet-adaptor-react-ui/dist/styles.css');

import { CURRENT_NETWORK, CURRENT_RPC_URL, PREDICTION_MARKET_PROGRAM_ID } from '@/types';
import { TransactionProvider } from '@/contexts/TransactionContext';

// Initialize the wallet adapters - following ProvableHQ example pattern
// Puzzle wallet is conditionally included to avoid ESM resolution issues
const wallets = [
  new ShieldWalletAdapter(),
  new LeoWalletAdapter(),
  new FoxWalletAdapter(),
  new SoterWalletAdapter(),
];

// Add Puzzle wallet if it loaded successfully
if (PuzzleWalletAdapter) {
  try {
    wallets.push(new PuzzleWalletAdapter());
  } catch {
    // Puzzle wallet init failed
  }
}

type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout;
};

function CustomApp({ Component, pageProps }: AppPropsWithLayout) {
  const [queryClient] = useState(() => new QueryClient());
  const getLayout = Component.getLayout ?? ((page) => page);

  return (
    <>
      <Script
        id="process-env-polyfill"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{
          __html: `(function(){var g=typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:this;if(typeof g.process==='undefined'){g.process={env:{}};}if(typeof g.process.env==='undefined'){g.process.env={};}})();`,
        }}
      />
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </Head>
      <QueryClientProvider client={queryClient}>
        <Hydrate state={pageProps.dehydratedState}>
          <AleoWalletProvider
            wallets={wallets}
            decryptPermission={DecryptPermission.AutoDecrypt}
            network={Network.TESTNET}
            autoConnect={true}
          >
            <WalletModalProvider>
              <ThemeProvider attribute="data-theme" enableSystem={false} defaultTheme="black">
                <TransactionProvider>
                  {getLayout(<Component {...pageProps} />)}
                </TransactionProvider>
              </ThemeProvider>
            </WalletModalProvider>
          </AleoWalletProvider>
        </Hydrate>
        {process.env.NODE_ENV === 'development' && (
          <ReactQueryDevtools initialIsOpen={false} position="bottom-right" />
        )}
      </QueryClientProvider>
    </>
  );
}

export default CustomApp;
