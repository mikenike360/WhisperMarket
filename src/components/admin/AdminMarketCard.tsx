import React, { useState } from 'react';
import { MarketState, MarketMetadata } from '@/types';
import { toCredits } from '@/utils/credits';
import { formatPriceCents } from '@/utils/priceDisplay';

interface AdminMarketCardProps {
  marketId: string;
  marketState: MarketState | null;
  metadata?: MarketMetadata;
  onResolve?: (marketId: string, outcome: boolean) => Promise<void>;
  onPause?: (marketId: string) => Promise<void>;
  onUnpause?: (marketId: string) => Promise<void>;
  actionLoading?: boolean;
}

export const AdminMarketCard: React.FC<AdminMarketCardProps> = ({
  marketId,
  marketState,
  metadata,
  onResolve,
  onPause,
  onUnpause,
  actionLoading = false,
}) => {
  const [resolveOutcome, setResolveOutcome] = useState<boolean>(true);
  const [showResolveDialog, setShowResolveDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const truncatedId = `${marketId.slice(0, 8)}...${marketId.slice(-8)}`;

  const copyMarketId = () => {
    navigator.clipboard.writeText(marketId);
    // Could add a toast notification here
  };

  const handleResolveClick = async () => {
    if (!onResolve) return;
    setError(null);
    try {
      await onResolve(marketId, resolveOutcome);
      setShowResolveDialog(false);
    } catch (err: any) {
      setError(err.message || 'Failed to resolve market');
    }
  };

  const handlePauseClick = async () => {
    if (!onPause) return;
    setError(null);
    try {
      await onPause(marketId);
    } catch (err: any) {
      setError(err.message || 'Failed to pause market');
    }
  };

  const handleUnpauseClick = async () => {
    if (!onUnpause) return;
    setError(null);
    try {
      await onUnpause(marketId);
    } catch (err: any) {
      setError(err.message || 'Failed to unpause market');
    }
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

  return (
    <div className="card bg-base-100 shadow-xl rounded-xl border border-base-200">
      <div className="card-body">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="card-title text-lg">
              {metadata?.title || `Market ${truncatedId}`}
            </h3>
            <div className="flex items-center gap-2 mt-2">
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
          <p className="text-sm text-base-content mb-4">
            {metadata.description}
          </p>
        )}

        {marketState && (
          <div className="stats stats-vertical lg:stats-horizontal shadow w-full mb-4">
            <div className="stat">
              <div className="stat-title">YES Price</div>
              <div className="stat-value text-lg">{formatPriceCents(marketState.priceYes)}</div>
            </div>
            <div className="stat">
              <div className="stat-title">NO Price</div>
              <div className="stat-value text-lg">{formatPriceCents(10000 - marketState.priceYes)}</div>
            </div>
            <div className="stat">
              <div className="stat-title">YES Reserve</div>
              <div className="stat-value text-lg">
                {toCredits(marketState.yesReserve).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
              </div>
              <div className="stat-desc">credits</div>
            </div>
            <div className="stat">
              <div className="stat-title">NO Reserve</div>
              <div className="stat-value text-lg">
                {toCredits(marketState.noReserve).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
              </div>
              <div className="stat-desc">credits</div>
            </div>
          </div>
        )}

        {error && (
          <div className="alert alert-error mb-4">
            <span>{error}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="card-actions justify-end">
          {marketState?.status === 0 && (
            <>
              {/* Resolve Dialog */}
              {showResolveDialog ? (
                <div className="flex flex-col gap-2 w-full">
                  <select
                    className="select select-bordered w-full"
                    value={resolveOutcome ? 'true' : 'false'}
                    onChange={(e) => setResolveOutcome(e.target.value === 'true')}
                    disabled={actionLoading}
                  >
                    <option value="true">YES</option>
                    <option value="false">NO</option>
                  </select>
                  <div className="flex gap-2">
                    <button
                      className="btn btn-warning flex-1"
                      onClick={handleResolveClick}
                      disabled={actionLoading}
                    >
                      {actionLoading ? (
                        <span className="loading loading-spinner"></span>
                      ) : (
                        `Resolve as ${resolveOutcome ? 'YES' : 'NO'}`
                      )}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        setShowResolveDialog(false);
                        setError(null);
                      }}
                      disabled={actionLoading}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    className="btn btn-warning"
                    onClick={() => setShowResolveDialog(true)}
                    disabled={actionLoading}
                  >
                    Resolve
                  </button>
                  <button
                    className="btn btn-error"
                    onClick={handlePauseClick}
                    disabled={actionLoading}
                  >
                    {actionLoading ? (
                      <span className="loading loading-spinner"></span>
                    ) : (
                      'Pause'
                    )}
                  </button>
                </>
              )}
            </>
          )}

          {marketState?.status === 2 && (
            <button
              className="btn btn-success"
              onClick={handleUnpauseClick}
              disabled={actionLoading}
            >
              {actionLoading ? (
                <span className="loading loading-spinner"></span>
              ) : (
                'Unpause'
              )}
            </button>
          )}

          {marketState?.status === 1 && (
            <div className="text-sm text-base-content">
              Market resolved. No actions available.
            </div>
          )}

          {!marketState && (
            <div className="text-sm text-base-content">
              Loading market state...
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
