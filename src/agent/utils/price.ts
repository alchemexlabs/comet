/**
 * Price utilities for the Comet agent
 */

import axios from 'axios';
import { PublicKey } from '@solana/web3.js';
import { logger } from './logger';
import { retry } from './helpers';
import { rateLimiter } from './rate-limiter';

// Birdeye API base URL
const BIRDEYE_API_URL = process.env.BIRDEYE_API_URL || 'https://public-api.birdeye.so';
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';

/**
 * Get token price from Birdeye API
 * 
 * @param tokenMint - Token mint address
 * @param fallbackPrice - Optional fallback price if API call fails
 * @returns Token price in USD
 */
export async function getPriceFromBirdeye(
  tokenMint: string | PublicKey,
  fallbackPrice?: number
): Promise<number> {
  try {
    // Validate the mint address
    if (!tokenMint) {
      throw new Error('Token mint address is required');
    }
    
    const mintAddress = tokenMint instanceof PublicKey ? tokenMint.toString() : tokenMint;
    
    // Validate mint address format
    try {
      new PublicKey(mintAddress);
    } catch (e) {
      throw new Error(`Invalid token mint address format: ${mintAddress}`);
    }
    
    // Check if API key is available
    if (!BIRDEYE_API_KEY) {
      logger.warn('Birdeye API key not found. Set BIRDEYE_API_KEY environment variable for price data.');
      if (fallbackPrice !== undefined) {
        logger.info(`Using fallback price for ${mintAddress}: ${fallbackPrice}`);
        return fallbackPrice;
      }
      throw new Error('Birdeye API key not configured');
    }
    
    // Make request to Birdeye API with rate limiting, retries and timeout
    const response = await rateLimiter.limit('birdeye:api', () => 
      retry(
        () => axios.get(
          `${BIRDEYE_API_URL}/public/price?address=${mintAddress}`,
          {
            headers: {
              'x-api-key': BIRDEYE_API_KEY,
            },
            timeout: 5000, // 5 second timeout
          }
        ),
        3, // 3 retries
        1000, // 1 second initial delay
        (error, attempt) => {
          logger.warn(`Birdeye API request attempt ${attempt} failed: ${error.message}`);
        }
      )
    );
    
    // Extract price from response with validation
    if (!response.data || typeof response.data !== 'object') {
      throw new Error('Invalid response from Birdeye API');
    }
    
    const price = response.data?.data?.value;
    
    // Validate price
    if (price === undefined || price === null || isNaN(price)) {
      if (fallbackPrice !== undefined) {
        logger.warn(`Invalid price from Birdeye for ${mintAddress}, using fallback: ${fallbackPrice}`);
        return fallbackPrice;
      }
      throw new Error(`Invalid price data for token ${mintAddress}`);
    }
    
    logger.debug(`Birdeye price for ${mintAddress}: ${price}`);
    return price;
  } catch (error) {
    logger.error(`Failed to get price from Birdeye: ${error.message}`);
    
    // Use fallback price if provided
    if (fallbackPrice !== undefined) {
      logger.info(`Using fallback price after error: ${fallbackPrice}`);
      return fallbackPrice;
    }
    
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
    
    // Make request to Birdeye API with rate limiting
    const response = await rateLimiter.limit('birdeye:api', () => 
      retry(() => axios.get(
        `${BIRDEYE_API_URL}/defi/multiple_price?list_address=${addresses}`,
        {
          headers: {
            'x-api-key': BIRDEYE_API_KEY,
          },
          timeout: 5000, // 5 second timeout
        }
      ))
    );
    
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