import React from 'react';

interface StatusBannerProps {
  status: number; // 0=open, 1=resolved, 2=paused
  outcome: boolean | null; // true=YES, false=NO, null if not resolved
}

export const StatusBanner: React.FC<StatusBannerProps> = ({
  status,
  outcome,
}) => {
  if (status === 1 && outcome !== null) {
    return (
      <div className={`alert ${outcome ? 'alert-success' : 'alert-error'} mb-6`}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="stroke-current shrink-0 h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span className="font-bold text-lg">
          Market Resolved: {outcome ? 'YES' : 'NO'} Wins!
        </span>
      </div>
    );
  }

  if (status === 2) {
    return (
      <div className="alert alert-warning mb-6">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="stroke-current shrink-0 h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <span className="font-bold">Market is currently paused</span>
      </div>
    );
  }

  return null;
};
