import React from 'react';

interface MarketHeaderProps {
  title: string;
  description: string;
  status: number; // 0=open, 1=resolved, 2=paused
}

export const MarketHeader: React.FC<MarketHeaderProps> = ({
  title,
  description,
  status,
}) => {
  const statusText = {
    0: 'Open',
    1: 'Resolved',
    2: 'Paused',
  }[status] || 'Unknown';

  const statusColor = {
    0: 'badge-success',
    1: 'badge-info',
    2: 'badge-warning',
  }[status] || 'badge-neutral';

  return (
    <div className="card bg-base-100 shadow-xl mb-6">
      <div className="card-body">
        <div className="flex items-center justify-between mb-2">
          <h2 className="card-title text-3xl">{title}</h2>
          <span className={`badge ${statusColor} badge-lg`}>{statusText}</span>
        </div>
        <p className="text-base-content/70">{description}</p>
      </div>
    </div>
  );
};
