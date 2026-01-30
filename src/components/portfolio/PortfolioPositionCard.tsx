import React, { useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { UserPosition, MarketState, MarketMetadata } from '@/types';
import { redeemPrivate } from '@/components/aleo/rpc';
import { toCredits } from '@/utils/credits';

interface PortfolioPositionCardProps {
  marketId: string;
  position: UserPosition;
  marketState: MarketState | null;
  metadata?: MarketMetadata;
  positionRecord: any; // Raw record for redemption
  onRedeem?: () => void;
}

export const PortfolioPositionCard: React.FC<PortfolioPositionCardProps> = ({
  marketId,
  position,
  marketState,
  metadata,
  positionRecord,
  onRedeem,
}) => {
  const walletHook = useWallet();
  const { publicKey, wallet } = walletHook as any;
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);

  const truncatedId = `${marketId.slice(0, 8)}...${marketId.slice(-8)}`;
  const totalCollateral = position.collateralAvailable + position.collateralCommitted;

  const copyMarketId = () => {
    navigator.clipboard.writeText(marketId);
  };

  const getStatusBadge = () => {
    if (!marketState) {
      return <span className="badge badge-ghost">Unknown</span>;
    }

    switch (marketState.status) {
      case 0: // Open
        return <span className="badge badge-success">Open</span>;
      case 1: // Resolved
        return (
          <span className="badge badge-info">
            Resolved: {marketState.outcome ? 'YES' : 'NO'}
          </span>
        );
      case 2: // Paused
        return <span className="badge badge-warning">Paused</span>;
      default:
        return <span className="badge badge-ghost">Unknown</span>;
    }
  };

  const calculatePotentialPayout = (): number => {
    if (!marketState || marketState.status !== 1 || marketState.outcome === null) {
      return 0;
    }

    const { outcome } = marketState;
    // 1:1 redemption model: each winning token = 1 collateral unit
    if (outcome === true && position.yesShares > 0) {
      return position.yesShares;
    } else if (outcome === false && position.noShares > 0) {
      return position.noShares;
    }
    return 0;
  };

  const handleRedeem = async () => {
    if (!publicKey || !wallet) {
      setRedeemError('Please connect your wallet');
      return;
    }

    if (!marketState || marketState.status !== 1 || marketState.outcome === null) {
      setRedeemError('Market is not resolved yet');
      return;
    }

    if (position.payoutClaimed) {
      setRedeemError('You have already redeemed');
      return;
    }

    const hasWinningShares =
      (marketState.outcome === true && position.yesShares > 0) ||
      (marketState.outcome === false && position.noShares > 0);

    if (!hasWinningShares) {
      setRedeemError('You have no winning shares to redeem');
      return;
    }

    if (!positionRecord) {
      setRedeemError('Position record not found');
      return;
    }

    setRedeemLoading(true);
    setRedeemError(null);

    try {
      const txId = await redeemPrivate(
        wallet,
        publicKey || (walletHook as any).address,
        marketId,
        positionRecord,
        marketState.outcome
      );
      onRedeem?.();
      alert(`Redeem transaction submitted: ${txId}`);
    } catch (err: any) {
      setRedeemError(err.message || 'Failed to redeem shares');
    } finally {
      setRedeemLoading(false);
    }
  };

  const potentialPayout = calculatePotentialPayout();
  const hasWinningShares =
    marketState?.status === 1 &&
    marketState.outcome !== null &&
    ((marketState.outcome === true && position.yesShares > 0) ||
     (marketState.outcome === false && position.noShares > 0));

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h3 className="card-title text-lg mb-2">
              {metadata?.title || `Market ${truncatedId}`}
            </h3>
            <div className="flex items-center gap-2">
              <code className="text-xs bg-base-200 px-2 py-1 rounded">
                {truncatedId}
              </code>
              <button
                className="btn btn-xs btn-ghost"
                onClick={copyMarketId}
                title="Copy full market ID"
              >
                📋
              </button>
            </div>
          </div>
          {getStatusBadge()}
        </div>

        {metadata?.description && (
          <p className="text-sm text-base-content/70 mb-4 line-clamp-2">
            {metadata.description}
          </p>
        )}

        {/* Position Stats */}
        <div className="stats stats-vertical shadow w-full mb-4">
          <div className="stat py-2">
            <div className="stat-title text-xs">YES Shares</div>
            <div className="stat-value text-lg text-success">
              {toCredits(position.yesShares).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
            </div>
            <div className="stat-desc text-xs">credits</div>
          </div>
          <div className="stat py-2">
            <div className="stat-title text-xs">NO Shares</div>
            <div className="stat-value text-lg text-error">
              {toCredits(position.noShares).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
            </div>
            <div className="stat-desc text-xs">credits</div>
          </div>
          <div className="stat py-2">
            <div className="stat-title text-xs">Total Collateral</div>
            <div className="stat-value text-lg text-primary">
              {toCredits(totalCollateral).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
            </div>
            <div className="stat-desc text-xs">credits</div>
          </div>
        </div>

        {/* Potential Payout */}
        {marketState?.status === 1 && potentialPayout > 0 && !position.payoutClaimed && (
          <div className="alert alert-info mb-4">
            <span>
              Potential payout: <strong>{toCredits(potentialPayout).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} credits</strong>
            </span>
          </div>
        )}

        {/* Redeem Error */}
        {redeemError && (
          <div className="alert alert-error mb-4">
            <span className="text-xs">{redeemError}</span>
          </div>
        )}

        {/* Actions */}
        <div className="card-actions justify-end">
          {marketState?.status === 1 && hasWinningShares && !position.payoutClaimed && (
            <button
              className="btn btn-success btn-sm"
              onClick={handleRedeem}
              disabled={redeemLoading}
            >
              {redeemLoading ? (
                <span className="loading loading-spinner loading-xs"></span>
              ) : (
                'Redeem'
              )}
            </button>
          )}
          {position.payoutClaimed && (
            <div className="badge badge-success">Redeemed</div>
          )}
          <Link
            href={`/market?marketId=${marketId}`}
            className="btn btn-primary btn-sm"
          >
            View Market
          </Link>
        </div>

        {!marketState && (
          <div className="text-xs text-base-content/60 mt-2">
            Market state unavailable
          </div>
        )}
      </div>
    </div>
  );
};
