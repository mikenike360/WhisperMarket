# Aleo Prediction Market

A decentralized prediction market application built on the Aleo blockchain. Users can create markets, buy positions, and redeem winnings based on market outcomes.

## Features

- Create prediction markets with custom questions and parameters
- Buy YES or NO positions using automated market maker (AMM) pricing
- View market statistics including current prices, pool size, and fees
- Redeem positions after market resolution
- Portfolio view to track your positions across all markets
- Automatic market discovery from on-chain data

## Tech Stack

- Frontend: Next.js 15, React 19, TypeScript, Tailwind CSS
- Blockchain: Aleo (Leo smart contracts)
- Wallet: Aleo Wallet Adapter (supports Leo, Puzzle, Fox, Soter, Shield wallets)
- State Management: React Query

## Prerequisites

- Node.js 18+ and Yarn
- Aleo CLI (Leo) installed and configured
- An Aleo wallet (Leo Wallet or compatible)

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   yarn install
   ```

3. Configure environment variables:
   - Copy `.env.example` to `.env` and fill in your values
   - Configure RPC endpoint and program details

4. Build the Leo program:
   ```bash
   yarn program
   ```

## Development

Start the development server:
```bash
yarn dev
```

The application will be available at `http://localhost:3000`

## Available Scripts

- `yarn dev` - Start development server
- `yarn build` - Build for production
- `yarn start` - Start production server
- `yarn program` - Build and copy Leo program
- `yarn lint` - Run ESLint
- `yarn ts` - Type check without emitting files

## Project Structure

```
├── program/          # Leo smart contract
│   └── src/
│       └── main.leo
├── src/
│   ├── components/   # React components
│   │   ├── aleo/     # Aleo RPC and blockchain interactions
│   │   ├── market/   # Market-specific components
│   │   └── ui/       # Reusable UI components
│   ├── pages/        # Next.js pages
│   ├── layouts/      # Page layouts
│   ├── hooks/        # Custom React hooks
│   ├── utils/        # Utility functions
│   └── types/        # TypeScript type definitions
└── public/           # Static assets
```

## Usage

1. Connect your Aleo wallet
2. Browse available markets on the markets page
3. Click on a market to view details and place trades
4. Create new markets by clicking "Create Market"
5. View your portfolio to see all positions

## Smart Contract

The Leo program implements a prediction market with:
- Market initialization with configurable parameters
- AMM-based pricing for YES/NO positions
- Position buying and selling
- Market resolution and position redemption
- Fee collection

## License

MIT
