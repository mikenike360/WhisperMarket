'use client';

import React, { useState } from 'react';
import { BuyForm } from '@/components/market/BuyForm';
import { SellForm } from '@/components/market/SellForm';
import { MarketState, UserPosition } from '@/types';

interface BuySellTabsProps {
  marketId: string;
  marketState: MarketState;
  userPosition: UserPosition;
  userPositionRecord: any;
  globalBalance?: number;
  isPaused: boolean;
  onTransactionSubmitted?: (txId: string, label?: string) => void;
  requestRecords?: (programId: string, decrypt?: boolean) => Promise<any[]>;
}

export const BuySellTabs: React.FC<BuySellTabsProps> = (props) => {
  const [activeTab, setActiveTab] = useState<'buy' | 'sell'>('buy');
  const isOpen = props.marketState.status === 0;

  return (
    <div className="card bg-base-100 shadow-xl rounded-xl">
      <div className="card-body p-0">
        <div className="tabs tabs-boxed bg-base-200/60 p-2 gap-1 rounded-t-xl">
          <button
            type="button"
            className={`tab tab-sm flex-1 ${activeTab === 'buy' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('buy')}
          >
            Buy
          </button>
          <button
            type="button"
            className={`tab tab-sm flex-1 ${activeTab === 'sell' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('sell')}
          >
            Sell
          </button>
        </div>
        <div className="p-4">
          {activeTab === 'buy' && (
            <BuyForm
              marketId={props.marketId}
              marketState={props.marketState}
              userPosition={props.userPosition}
              userPositionRecord={props.userPositionRecord}
              globalBalance={props.globalBalance}
              isOpen={isOpen}
              isPaused={props.isPaused}
              onTransactionSubmitted={props.onTransactionSubmitted}
              requestRecords={props.requestRecords}
            />
          )}
          {activeTab === 'sell' && (
            <SellForm
              marketId={props.marketId}
              marketState={props.marketState}
              userPosition={props.userPosition}
              userPositionRecord={props.userPositionRecord}
              isOpen={isOpen}
              isPaused={props.isPaused}
              onTransactionSubmitted={props.onTransactionSubmitted}
              requestRecords={props.requestRecords}
            />
          )}
        </div>
      </div>
    </div>
  );
};
