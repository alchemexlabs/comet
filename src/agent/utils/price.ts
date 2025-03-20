/**
 * Price utilities for the Comet agent
 */

import axios from 'axios';
import { PublicKey } from '@solana/web3.js';
import { logger } from './logger';
import { retry } from './helpers';

// Birdeye API base URL
const BIRDEYE_API_URL = process.env.BIRDEYE_API_URL || 'https://public-api.birdeye.so';
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';

/**
 * Get token price from Birdeye API
 * 
 * @param tokenMint - Token mint address
 * @returns Token price in USD
 */
export async function getPriceFromBirdeye(tokenMint: string | PublicKey): Promise<number> {
  try {
    const mintAddress = tokenMint instanceof PublicKey ? tokenMint.toString() : tokenMint;
    
    // Make request to Birdeye API
    const response = await retry(() => axios.get(
      `${BIRDEYE_API_URL}/public/price?address=${mintAddress}`,
      {
        headers: {
          'x-api-key': BIRDEYE_API_KEY,
        },
      }
    ));
    
    // Extract and return price
    const price = response.data?.data?.value || 0;
    logger.debug(`Birdeye price for ${mintAddress}: ${price}`);
    return price;
  } catch (error) {
    logger.error(`Failed to get price from Birdeye: ${error.message}`);
    throw new Error(`Failed to get price: ${error.message}`);
  }
}

/**
 * Get multiple token prices from Birdeye API
 * 
 * @param tokenMints - Array of token mint addresses
 * @returns Map of token address to price
 */
export async function getMultipleTokenPrices(
  tokenMints: (string | PublicKey)[]
): Promise<Map<string, number>> {
  try {
    const addresses = tokenMints.map(mint => 
      mint instanceof PublicKey ? mint.toString() : mint
    ).join(',');
    
    // Make request to Birdeye API
    const response = await retry(() => axios.get(
      `${BIRDEYE_API_URL}/defi/multiple_price?list_address=${addresses}`,
      {
        headers: {
          'x-api-key': BIRDEYE_API_KEY,
        },
      }
    ));
    
    // Process response
    const priceMap = new Map<string, number>();
    const data = response.data?.data || {};
    
    for (const [address, info] of Object.entries(data)) {
      priceMap.set(address, info.value || 0);
    }
    
    return priceMap;
  } catch (error) {
    logger.error(`Failed to get multiple prices: ${error.message}`);
    throw new Error(`Failed to get multiple prices: ${error.message}`);
  }
}

/**
 * Calculate price impact for a given amount and pool
 * 
 * @param inputAmount - Amount of tokens to swap
 * @param poolLiquidity - Pool liquidity depth
 * @returns Estimated price impact percentage
 */
export function calculatePriceImpact(
  inputAmount: number,
  poolLiquidity: number
): number {
  if (poolLiquidity <= 0) return 100;
  
  // Simple price impact calculation (for illustration)
  // In production, you would use a more sophisticated calculation
  // based on the specific AMM curve
  const impact = (inputAmount / poolLiquidity) * 100;
  return Math.min(impact, 100);
}

/**
 * Check if current price is far from target price and rebalance is needed
 * 
 * @param currentPrice - Current token price
 * @param targetPrice - Target price (usually active bin price)
 * @param threshold - Threshold percentage for rebalance
 * @returns Boolean indicating if rebalance is needed
 */
export function isRebalanceNeeded(
  currentPrice: number,
  targetPrice: number,
  threshold: number = 1.0
): boolean {
  if (currentPrice <= 0 || targetPrice <= 0) return false;
  
  const priceDiff = Math.abs(currentPrice - targetPrice);
  const percentageDiff = (priceDiff / targetPrice) * 100;
  
  return percentageDiff > threshold;
}