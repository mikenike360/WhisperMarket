/** @type {import('next').NextConfig} */

const webpack = require('webpack');
const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  runtimeCaching: require('next-pwa/cache'),
});
require('dotenv').config();

const nextConfig = {
  env: {
    URL: process.env.URL,
    TWITTER: process.env.TWITTER,
    DISCORD: process.env.DISCORD,
    RPC_URL: process.env.RPC_URL,
  },
  reactStrictMode: true,
  ...(process.env.NODE_ENV === 'production' && {
    typescript: {
      ignoreBuildErrors: true,
    },
    eslint: {
      ignoreDuringBuilds: true,
    },
  }),
  webpack: (config, options) => {
    config.ignoreWarnings = [/Failed to parse source map/];
    const fallback = config.resolve.fallback || {};
    Object.assign(fallback, {
      stream: require.resolve('stream-browserify'),
      fs: require.resolve('browserify-fs'),
    });
    config.resolve.fallback = fallback;
    config.plugins = (config.plugins || []).concat([
      new webpack.ProvidePlugin({
        process: 'process/browser',
        Buffer: ['buffer', 'Buffer'],
      }),
    ]);
    const experiments = config.experiments || {};
    Object.assign(experiments, {
      asyncWebAssembly: true,
      syncWebAssembly: true,
      topLevelAwait: true,
    });
    config.experiments = experiments;
    
    const alias = config.resolve.alias || {};
    const path = require('path');
    Object.assign(alias, {
      react$: require.resolve('react'),
      // Fix @puzzlehq/sdk-core ESM resolution issue by using absolute path
      // Using process.cwd() instead of __dirname for Next.js compatibility
      '@puzzlehq/sdk-core': path.resolve(process.cwd(), 'node_modules/@puzzlehq/sdk-core/dist/src/index.js'),
    });
    config.resolve.alias = alias;
    
    // Fix module resolution for packages with ESM exports (like @puzzlehq/sdk-core)
    config.resolve.extensionAlias = {
      '.js': ['.js', '.ts', '.tsx'],
      '.jsx': ['.jsx', '.tsx'],
    };
    
    // Handle packages that use ESM exports but need to be resolved by webpack
    // This allows webpack to use the 'import' condition from package.json exports
    config.resolve.conditionNames = ['import', 'require', 'default', 'node'];
    
    // Allow webpack to resolve ESM packages that don't have proper exports.main
    // Prioritize 'module' and 'import' fields for ESM packages
    config.resolve.mainFields = ['module', 'main', 'exports'];
    
    // Handle nextjs bug with wasm static files
    patchWasmModuleImport(config, options.isServer);

    // In next.config.js, inside your webpack function:
    config.module.rules.push({
      test: /\.wasm$/,
      include: /node_modules[\\/]@demox-labs[\\/]aleo-sdk-web/,
      type: 'javascript/auto',
      loader: 'file-loader',
    });

    return config;
  },
};

function patchWasmModuleImport(config, isServer) {
  config.experiments = Object.assign(config.experiments || {}, {
      asyncWebAssembly: true,
  });

  config.optimization.moduleIds = 'named';

  config.module.rules.push({
      test: /\.wasm$/,
      type: 'webassembly/async',
  });

  // TODO: improve this function -> track https://github.com/vercel/next.js/issues/25852
  if (isServer) {
      config.output.webassemblyModuleFilename = './../static/wasm/[modulehash].wasm';
  } else {
      config.output.webassemblyModuleFilename = 'static/wasm/[modulehash].wasm';
  }
}

module.exports = withPWA(nextConfig);