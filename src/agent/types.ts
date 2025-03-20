/**
 * Type definitions for the Comet agent
 */

import { PublicKey } from '@solana/web3.js';
import { ActivationType } from '../dlmm/types';

/**
 * Configuration for the Comet agent
 */
export interface CometConfig {
  // Connection
  rpcUrl: string;
  walletKey: string;
  
  // Pool
  poolAddress?: string;
  
  // Strategy
  strategy?: string; // 'Spot', 'BidAsk', 'Curve'
  binRange?: number; // Number of bins to each side of active bin
  
  // Rebalancing
  autoRebalance?: boolean;
  minRebalanceInterval?: number; // Minimum time between rebalances in ms
  priceDeviationThreshold?: number; // % price change that triggers rebalance
  
  // Fee collection
  feeCollectionInterval?: number; // Time between fee collections in ms
  
  // General settings
  pollingInterval?: number; // Time between agent update cycles in ms
  maxRetries?: number; // Max number of retries for failed operations
  retryDelay?: number; // Delay between retries in ms
  
  // Optional parameters for creating a new pool
  createPoolParams?: {
    tokenX: PublicKey | string;
    tokenY: PublicKey | string;
    binStep: number;
    activeId: number;
    feeBps: number;
    activationType: ActivationType;
    hasAlphaVault: boolean;
  };
  
  // Claude AI integration
  claude?: {
    apiKey: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    enabled: boolean;
    riskProfile?: 'conservative' | 'moderate' | 'aggressive';
  };
  
  // Logging
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Pool statistics
 */
export interface PoolStats {
  tokenXBalance: string;
  tokenYBalance: string;
  activeBinId: number;
  currentPrice: string;
  feesCollectedX: string;
  feesCollectedY: string;
  apr: string;
  lastUpdated: number;
}

/**
 * Rebalance history item
 */
export interface RebalanceEvent {
  timestamp: number;
  oldActiveBin: number;
  newActiveBin: number;
  oldPrice: string;
  newPrice: string;
  gasUsed: string;
  transactionHash: string;
}

/**
 * Fee collection event
 */
export interface FeeCollectionEvent {
  timestamp: number;
  amountX: string;
  amountY: string;
  transactionHash: string;
}

/**
 * Agent status
 */
export enum AgentStatus {
  Initializing = 'initializing',
  Running = 'running',
  Stopped = 'stopped',
  Error = 'error'
}

/**
 * Agent state
 */
export interface AgentState {
  status: AgentStatus;
  poolAddress?: string;
  poolStats?: PoolStats;
  lastRebalance?: RebalanceEvent;
  lastFeeCollection?: FeeCollectionEvent;
  rebalanceCount: number;
  feeCollectionCount: number;
  totalFeesCollectedX: string;
  totalFeesCollectedY: string;
  uptime: number;
  startTime: number;
  errors: string[];
}