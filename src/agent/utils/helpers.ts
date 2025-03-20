/**
 * Helper utilities for the Comet agent
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { StrategyType } from '../../dlmm/types';
import bs58 from 'bs58';

/**
 * Load a wallet from a private key
 * @param privateKeyString - Private key as string (base58 or JSON)
 * @returns Keypair
 */
export function loadWalletFromKey(privateKeyString: string): Keypair {
  try {
    // Try parsing as JSON first
    try {
      const secretKey = JSON.parse(privateKeyString);
      return Keypair.fromSecretKey(
        typeof secretKey === 'string' 
          ? new Uint8Array(JSON.parse(secretKey)) 
          : new Uint8Array(secretKey)
      );
    } catch (e) {
      // If not JSON, try base58
      const decoded = bs58.decode(privateKeyString);
      return Keypair.fromSecretKey(decoded);
    }
  } catch (error) {
    throw new Error(`Failed to load wallet: ${error.message}`);
  }
}

/**
 * Sleep for a specified number of milliseconds
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the sleep period
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 * @param fn - Function to retry
 * @param maxRetries - Maximum number of retries
 * @param initialDelay - Initial delay in milliseconds
 * @param onRetry - Optional callback that runs before each retry with current attempt number
 * @returns Promise of the function result
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelay = 1000,
  onRetry?: (error: Error, attempt: number) => void
): Promise<T> {
  let retries = 0;
  let lastError: Error;
  
  while (true) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (retries >= maxRetries) {
        // Add context to the error about retry attempts
        const enrichedError = new Error(
          `Operation failed after ${retries + 1} attempts. Last error: ${lastError.message}`
        );
        enrichedError.stack = lastError.stack;
        enrichedError.cause = lastError;
        throw enrichedError;
      }
      
      retries++;
      const delay = initialDelay * Math.pow(2, retries - 1);
      
      // Add jitter to prevent thundering herd problems
      const jitteredDelay = delay * (0.8 + Math.random() * 0.4);
      
      // Call the onRetry callback if provided
      if (onRetry) {
        try {
          onRetry(lastError, retries);
        } catch (callbackError) {
          // Don't let callback errors affect the retry logic
          console.error('Error in retry callback:', callbackError);
        }
      }
      
      await sleep(jitteredDelay);
    }
  }
}

/**
 * Check if a value is within a percentage range of another value
 * @param value - The value to check
 * @param reference - The reference value
 * @param percentage - The percentage range
 * @returns True if the value is within the percentage range
 */
export function isWithinPercentage(
  value: number | string | BN,
  reference: number | string | BN,
  percentage: number
): boolean {
  const valueNum = new BN(value.toString()).toNumber();
  const refNum = new BN(reference.toString()).toNumber();
  const diff = Math.abs(valueNum - refNum);
  const percent = (diff / refNum) * 100;
  return percent <= percentage;
}

/**
 * Format a number to a specified number of decimal places
 * @param value - The value to format
 * @param decimals - The number of decimal places
 * @returns Formatted string
 */
export function formatNumber(value: number | string | BN, decimals = 6): string {
  const valueNum = typeof value === 'number' 
    ? value 
    : new BN(value.toString()).toNumber();
  return valueNum.toFixed(decimals);
}

/**
 * Convert a strategy string to StrategyType enum
 * @param strategy - Strategy string
 * @returns StrategyType
 */
export function parseStrategy(strategy: string): StrategyType {
  switch (strategy.toUpperCase()) {
    case 'BID_ASK':
    case 'BIDASK':
      return StrategyType.BidAsk;
    case 'CURVE':
      return StrategyType.Curve;
    case 'SPOT':
    default:
      return StrategyType.Spot;
  }
}

/**
 * Parse environment variables into a typed config object
 * @returns Parsed environment variables
 */
export function parseEnvConfig(): any {
  return {
    // Connection
    rpcUrl: process.env.RPC_URL || 'https://api.helius.xyz/v0/solanaqt',
    walletKey: process.env.COMET_WALLET_KEY || '',
    
    // Pool
    poolAddress: process.env.COMET_POOL_ADDRESS || '',
    
    // Strategy
    strategy: process.env.COMET_STRATEGY || 'Spot',
    binRange: parseInt(process.env.COMET_BIN_RANGE || '10'),
    
    // Rebalancing
    autoRebalance: process.env.COMET_AUTO_REBALANCE === 'true',
    minRebalanceInterval: parseInt(process.env.COMET_MIN_REBALANCE_INTERVAL || '3600000'),
    priceDeviationThreshold: parseFloat(process.env.COMET_PRICE_DEVIATION_THRESHOLD || '1.0'),
    
    // Fee collection
    feeCollectionInterval: parseInt(process.env.COMET_FEE_COLLECTION_INTERVAL || '86400000'),
    
    // General settings
    pollingInterval: parseInt(process.env.COMET_POLLING_INTERVAL || '60000'),
    maxRetries: parseInt(process.env.COMET_MAX_RETRIES || '3'),
    retryDelay: parseInt(process.env.COMET_RETRY_DELAY || '1000'),
    
    // Claude AI integration
    claude: {
      apiKey: process.env.CLAUDE_API_KEY || '',
      model: process.env.CLAUDE_MODEL || 'claude-3-sonnet-20240229',
      temperature: parseFloat(process.env.CLAUDE_TEMPERATURE || '0.1'),
      maxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS || '1024'),
      enabled: process.env.CLAUDE_ENABLED === 'true',
      riskProfile: process.env.CLAUDE_RISK_PROFILE || 'moderate'
    },
    
    // Logging
    logLevel: process.env.COMET_LOG_LEVEL || 'info',
  };
}