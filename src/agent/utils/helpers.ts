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
 * @returns Promise of the function result
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelay = 1000
): Promise<T> {
  let retries = 0;
  
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (retries >= maxRetries) {
        throw error;
      }
      
      retries++;
      const delay = initialDelay * Math.pow(2, retries - 1);
      await sleep(delay);
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
    rpcUrl: process.env.RPC_URL || 'https://api.helius.xyz/v0/solanaqt',
    walletKey: process.env.COMET_WALLET_KEY || '',
    poolAddress: process.env.COMET_POOL_ADDRESS || '',
    strategy: process.env.COMET_STRATEGY || 'Spot',
    binRange: parseInt(process.env.COMET_BIN_RANGE || '10'),
    autoRebalance: process.env.COMET_AUTO_REBALANCE === 'true',
    minRebalanceInterval: parseInt(process.env.COMET_MIN_REBALANCE_INTERVAL || '3600000'),
    priceDeviationThreshold: parseFloat(process.env.COMET_PRICE_DEVIATION_THRESHOLD || '1.0'),
    feeCollectionInterval: parseInt(process.env.COMET_FEE_COLLECTION_INTERVAL || '86400000'),
    pollingInterval: parseInt(process.env.COMET_POLLING_INTERVAL || '60000'),
    maxRetries: parseInt(process.env.COMET_MAX_RETRIES || '3'),
    retryDelay: parseInt(process.env.COMET_RETRY_DELAY || '1000'),
    logLevel: process.env.COMET_LOG_LEVEL || 'info',
  };
}