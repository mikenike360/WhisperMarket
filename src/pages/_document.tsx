import Document, {
  DocumentContext,
  Head,
  Html,
  Main,
  NextScript,
} from 'next/document';

class CustomDocument extends Document {
  static async getInitialProps(ctx: DocumentContext) {
    return Document.getInitialProps(ctx);
  }
  
  render() {
    return (
      <Html lang="en-US" dir="ltr">
        <Head>
          {/* Must be first: polyfill process.env for production client (yarn start / Vercel) */}
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){var g=typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:this;if(typeof g.process==='undefined'){g.process={env:{}};}if(typeof g.process.env==='undefined'){g.process.env={};}})();`,
            }}
          />
          {/* Load fonts, etc. */}
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link
            href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&display=swap"
            rel="stylesheet"
          />

          {/* 
            Inline script to read localStorage and set data-theme immediately.
          */}
          <script
            dangerouslySetInnerHTML={{
              __html: `
                (function() {
                  try {
                    var storedTheme = localStorage.getItem('theme');
                    if (storedTheme) {
                      document.documentElement.setAttribute('data-theme', storedTheme);
                    } else {
                      // If no theme is stored, default to "wireframe":
                      document.documentElement.setAttribute('data-theme', 'wireframe');
                    }
                  } catch (e) {
                    // On error, fall back to "luxury":
                    document.documentElement.setAttribute('data-theme', 'luxury');
                  }
                })();
              `,
            }}
          />
        </Head>
        <body>
          {/* Run before Main/NextScript so process exists before any bundle runs */}
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){var g=typeof globalThis!=='undefined'?globalThis:typeof window!=='undefined'?window:this;if(typeof g.process==='undefined'){g.process={env:{}};}if(typeof g.process.env==='undefined'){g.process.env={};}})();`,
            }}
          />
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default CustomDocument;
