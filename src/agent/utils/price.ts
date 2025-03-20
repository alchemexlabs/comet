/**
 * Price utilities for the Comet agent
 */

import axios from 'axios';
import { PublicKey } from '@solana/web3.js';
import { logger } from './logger';
import { retry } from './helpers';
import { rateLimiter } from './rate-limiter';

// API URLs and keys
const BIRDEYE_API_URL = process.env.BIRDEYE_API_URL || 'https://public-api.birdeye.so';
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';
const JUPITER_API_URL = process.env.JUPITER_API_URL || 'https://price.jup.ag/v4';

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
 * Get token market data from Birdeye API (Starter Plan)
 * 
 * @param tokenMint - Token mint address
 * @returns Detailed token market data
 */
export async function getTokenMarketData(
  tokenMint: string | PublicKey
): Promise<any> {
  try {
    // Validate the mint address
    if (!tokenMint) {
      throw new Error('Token mint address is required');
    }
    
    const mintAddress = tokenMint instanceof PublicKey ? tokenMint.toString() : tokenMint;
    
    // Make request to Birdeye API with rate limiting
    const response = await rateLimiter.limit('birdeye:api', () => 
      retry(() => axios.get(
        `${BIRDEYE_API_URL}/tokens/token_data/market_info?address=${mintAddress}`,
        {
          headers: {
            'x-api-key': BIRDEYE_API_KEY,
          },
          timeout: 5000, // 5 second timeout
        }
      ))
    );
    
    return response.data?.data || {};
  } catch (error) {
    logger.error(`Failed to get token market data: ${error.message}`);
    throw new Error(`Failed to get token market data: ${error.message}`);
  }
}

/**
 * Get token information from Birdeye API (Starter Plan)
 * 
 * @param tokenMint - Token mint address
 * @returns Detailed token information
 */
export async function getTokenInfo(
  tokenMint: string | PublicKey
): Promise<any> {
  try {
    // Validate the mint address
    if (!tokenMint) {
      throw new Error('Token mint address is required');
    }
    
    const mintAddress = tokenMint instanceof PublicKey ? tokenMint.toString() : tokenMint;
    
    // Make request to Birdeye API with rate limiting
    const response = await rateLimiter.limit('birdeye:api', () => 
      retry(() => axios.get(
        `${BIRDEYE_API_URL}/tokens/token_info?address=${mintAddress}`,
        {
          headers: {
            'x-api-key': BIRDEYE_API_KEY,
          },
          timeout: 5000, // 5 second timeout
        }
      ))
    );
    
    return response.data?.data || {};
  } catch (error) {
    logger.error(`Failed to get token info: ${error.message}`);
    throw new Error(`Failed to get token info: ${error.message}`);
  }
}

/**
 * Get OHLCV data for a specific token (Starter Plan)
 * 
 * @param tokenMint - Token mint address 
 * @param timeframe - Timeframe for OHLCV data (e.g., '1H', '4H', '1D')
 * @param limit - Number of candles to return
 * @returns Array of OHLCV candles
 */
export async function getTokenOHLCV(
  tokenMint: string | PublicKey,
  timeframe: string = '1H',
  limit: number = 24
): Promise<any[]> {
  try {
    // Validate the mint address
    if (!tokenMint) {
      throw new Error('Token mint address is required');
    }
    
    const mintAddress = tokenMint instanceof PublicKey ? tokenMint.toString() : tokenMint;
    
    // Make request to Birdeye API with rate limiting
    const response = await rateLimiter.limit('birdeye:api', () => 
      retry(() => axios.get(
        `${BIRDEYE_API_URL}/sdk/ohlcv?address=${mintAddress}&type=token&timeframe=${timeframe}&limit=${limit}`,
        {
          headers: {
            'x-api-key': BIRDEYE_API_KEY,
          },
          timeout: 5000, // 5 second timeout
        }
      ))
    );
    
    return response.data?.data || [];
  } catch (error) {
    logger.error(`Failed to get token OHLCV data: ${error.message}`);
    throw new Error(`Failed to get token OHLCV data: ${error.message}`);
  }
}

/**
 * Get OHLCV data for a specific token pair (Starter Plan)
 * 
 * @param baseTokenMint - Base token mint address
 * @param quoteTokenMint - Quote token mint address
 * @param timeframe - Timeframe for OHLCV data (e.g., '1H', '4H', '1D')
 * @param limit - Number of candles to return
 * @returns Array of OHLCV candles
 */
export async function getPairOHLCV(
  baseTokenMint: string | PublicKey,
  quoteTokenMint: string | PublicKey,
  timeframe: string = '1H',
  limit: number = 24
): Promise<any[]> {
  try {
    // Validate the mint addresses
    if (!baseTokenMint || !quoteTokenMint) {
      throw new Error('Base and quote token mint addresses are required');
    }
    
    const baseAddress = baseTokenMint instanceof PublicKey ? baseTokenMint.toString() : baseTokenMint;
    const quoteAddress = quoteTokenMint instanceof PublicKey ? quoteTokenMint.toString() : quoteTokenMint;
    
    // Make request to Birdeye API with rate limiting
    const response = await rateLimiter.limit('birdeye:api', () => 
      retry(() => axios.get(
        `${BIRDEYE_API_URL}/sdk/ohlcv?base_address=${baseAddress}&quote_address=${quoteAddress}&type=base_quote&timeframe=${timeframe}&limit=${limit}`,
        {
          headers: {
            'x-api-key': BIRDEYE_API_KEY,
          },
          timeout: 5000, // 5 second timeout
        }
      ))
    );
    
    return response.data?.data || [];
  } catch (error) {
    logger.error(`Failed to get pair OHLCV data: ${error.message}`);
    throw new Error(`Failed to get pair OHLCV data: ${error.message}`);
  }
}

/**
 * Get recent trades for a specific token (Starter Plan)
 * 
 * @param tokenMint - Token mint address
 * @param limit - Number of trades to return (max 100)
 * @returns Array of recent trades
 */
export async function getTokenTrades(
  tokenMint: string | PublicKey,
  limit: number = 20
): Promise<any[]> {
  try {
    // Validate the mint address
    if (!tokenMint) {
      throw new Error('Token mint address is required');
    }
    
    const mintAddress = tokenMint instanceof PublicKey ? tokenMint.toString() : tokenMint;
    
    // Make request to Birdeye API with rate limiting
    const response = await rateLimiter.limit('birdeye:api', () => 
      retry(() => axios.get(
        `${BIRDEYE_API_URL}/sdk/trades?address=${mintAddress}&type=token&limit=${Math.min(limit, 100)}`,
        {
          headers: {
            'x-api-key': BIRDEYE_API_KEY,
          },
          timeout: 5000, // 5 second timeout
        }
      ))
    );
    
    return response.data?.data || [];
  } catch (error) {
    logger.error(`Failed to get token trades: ${error.message}`);
    throw new Error(`Failed to get token trades: ${error.message}`);
  }
}

/**
 * Get recent trades for a specific token pair (Starter Plan)
 * 
 * @param baseTokenMint - Base token mint address
 * @param quoteTokenMint - Quote token mint address
 * @param limit - Number of trades to return (max 100)
 * @returns Array of recent trades
 */
export async function getPairTrades(
  baseTokenMint: string | PublicKey,
  quoteTokenMint: string | PublicKey,
  limit: number = 20
): Promise<any[]> {
  try {
    // Validate the mint addresses
    if (!baseTokenMint || !quoteTokenMint) {
      throw new Error('Base and quote token mint addresses are required');
    }
    
    const baseAddress = baseTokenMint instanceof PublicKey ? baseTokenMint.toString() : baseTokenMint;
    const quoteAddress = quoteTokenMint instanceof PublicKey ? quoteTokenMint.toString() : quoteTokenMint;
    
    // Make request to Birdeye API with rate limiting
    const response = await rateLimiter.limit('birdeye:api', () => 
      retry(() => axios.get(
        `${BIRDEYE_API_URL}/sdk/trades?base_address=${baseAddress}&quote_address=${quoteAddress}&type=base_quote&limit=${Math.min(limit, 100)}`,
        {
          headers: {
            'x-api-key': BIRDEYE_API_KEY,
          },
          timeout: 5000, // 5 second timeout
        }
      ))
    );
    
    return response.data?.data || [];
  } catch (error) {
    logger.error(`Failed to get pair trades: ${error.message}`);
    throw new Error(`Failed to get pair trades: ${error.message}`);
  }
}

/**
 * Get wallet portfolio from Birdeye API (Starter Plan)
 * 
 * @param walletAddress - Wallet address
 * @returns Wallet portfolio data
 */
export async function getWalletPortfolio(
  walletAddress: string | PublicKey
): Promise<any> {
  try {
    // Validate the wallet address
    if (!walletAddress) {
      throw new Error('Wallet address is required');
    }
    
    const address = walletAddress instanceof PublicKey ? walletAddress.toString() : walletAddress;
    
    // Make request to Birdeye API with rate limiting
    const response = await rateLimiter.limit('birdeye:api', () => 
      retry(() => axios.get(
        `${BIRDEYE_API_URL}/wallet/wallet_portfolio_info?address=${address}`,
        {
          headers: {
            'x-api-key': BIRDEYE_API_KEY,
          },
          timeout: 10000, // 10 second timeout for portfolio info
        }
      ))
    );
    
    return response.data?.data || {};
  } catch (error) {
    logger.error(`Failed to get wallet portfolio: ${error.message}`);
    throw new Error(`Failed to get wallet portfolio: ${error.message}`);
  }
}

/**
 * Get wallet historical trades from Birdeye API (Starter Plan)
 * 
 * @param walletAddress - Wallet address
 * @param limit - Number of trades to return (max 100)
 * @returns Wallet historical trades
 */
export async function getWalletHistoricalTrades(
  walletAddress: string | PublicKey,
  limit: number = 50
): Promise<any[]> {
  try {
    // Validate the wallet address
    if (!walletAddress) {
      throw new Error('Wallet address is required');
    }
    
    const address = walletAddress instanceof PublicKey ? walletAddress.toString() : walletAddress;
    
    // Make request to Birdeye API with rate limiting
    const response = await rateLimiter.limit('birdeye:api', () => 
      retry(() => axios.get(
        `${BIRDEYE_API_URL}/wallet/wallet_transaction?address=${address}&limit=${Math.min(limit, 100)}`,
        {
          headers: {
            'x-api-key': BIRDEYE_API_KEY,
          },
          timeout: 10000, // 10 second timeout for historical trades
        }
      ))
    );
    
    return response.data?.data || [];
  } catch (error) {
    logger.error(`Failed to get wallet historical trades: ${error.message}`);
    throw new Error(`Failed to get wallet historical trades: ${error.message}`);
  }
}

/**
 * Get token top holders from Birdeye API (Starter Plan)
 * 
 * @param tokenMint - Token mint address
 * @param limit - Number of holders to return (max 100)
 * @returns Top token holders data
 */
export async function getTokenTopHolders(
  tokenMint: string | PublicKey,
  limit: number = 20
): Promise<any[]> {
  try {
    // Validate the mint address
    if (!tokenMint) {
      throw new Error('Token mint address is required');
    }
    
    const mintAddress = tokenMint instanceof PublicKey ? tokenMint.toString() : tokenMint;
    
    // Make request to Birdeye API with rate limiting
    const response = await rateLimiter.limit('birdeye:api', () => 
      retry(() => axios.get(
        `${BIRDEYE_API_URL}/tokens/top_holder?address=${mintAddress}&limit=${Math.min(limit, 100)}`,
        {
          headers: {
            'x-api-key': BIRDEYE_API_KEY,
          },
          timeout: 5000, // 5 second timeout
        }
      ))
    );
    
    return response.data?.data || [];
  } catch (error) {
    logger.error(`Failed to get token top holders: ${error.message}`);
    throw new Error(`Failed to get token top holders: ${error.message}`);
  }
}

/**
 * Get newly listed tokens from Birdeye API (Starter Plan)
 * 
 * @param limit - Number of new tokens to return (max 100)
 * @param startTime - Optional start time in milliseconds
 * @param endTime - Optional end time in milliseconds
 * @returns Array of newly listed tokens
 */
export async function getNewlyListedTokens(
  limit: number = 20,
  startTime?: number,
  endTime?: number
): Promise<any[]> {
  try {
    // Build query parameters
    const params = new URLSearchParams();
    params.append('limit', Math.min(limit, 100).toString());
    
    if (startTime) {
      params.append('startTime', startTime.toString());
    }
    
    if (endTime) {
      params.append('endTime', endTime.toString());
    }
    
    // Make request to Birdeye API with rate limiting
    const response = await rateLimiter.limit('birdeye:api', () => 
      retry(() => axios.get(
        `${BIRDEYE_API_URL}/tokens/new_listing?${params.toString()}`,
        {
          headers: {
            'x-api-key': BIRDEYE_API_KEY,
          },
          timeout: 10000, // 10 second timeout for new listings
        }
      ))
    );
    
    return response.data?.data || [];
  } catch (error) {
    logger.error(`Failed to get newly listed tokens: ${error.message}`);
    throw new Error(`Failed to get newly listed tokens: ${error.message}`);
  }
}

/**
 * Analyze new token potential
 * 
 * Evaluates newly listed tokens based on multiple factors including:
 * - Initial liquidity
 * - Trading volume in first hour
 * - Holder growth rate
 * - Metadata completion and quality
 * - Social signals
 * - Distribution among holders
 * 
 * @param tokenMint - Token mint address
 * @returns Analysis results with potential score (0-100) and factors
 */
export async function analyzeNewTokenPotential(
  tokenMint: string | PublicKey
): Promise<{
  score: number;
  liquidity: number;
  volume: number;
  holderGrowth: number;
  metadataQuality: number;
  socialSignals: number;
  distribution: number;
  recommendation: string;
}> {
  try {
    const mintAddress = tokenMint instanceof PublicKey ? tokenMint.toString() : tokenMint;
    
    // Get token information
    const tokenInfo = await getTokenInfo(mintAddress);
    const marketData = await getTokenMarketData(mintAddress);
    
    // Get token holders
    const holders = await getTokenTopHolders(mintAddress, 10);
    
    // Get OHLCV data (1 hour candles for the last 6 hours if available)
    const ohlcvData = await getTokenOHLCV(mintAddress, '1H', 6);
    
    // Get recent trades
    const trades = await getTokenTrades(mintAddress, 50);
    
    // Calculate metrics
    
    // 1. Liquidity assessment (0-20 points)
    const liquidity = Math.min(
      20, 
      ((marketData.liquidity || 0) / 10000) * 20
    );
    
    // 2. Trading volume in first hours (0-25 points)
    let volume = 0;
    if (trades.length > 0) {
      const tradeVolume = trades.reduce((sum, trade) => sum + (trade.volume || 0), 0);
      volume = Math.min(25, (tradeVolume / 5000) * 25);
    }
    
    // 3. Holder growth and distribution (0-20 points)
    let holderGrowth = 0;
    let distribution = 0;
    
    if (holders.length > 0) {
      // More holders is better
      holderGrowth = Math.min(10, (holders.length / 50) * 10);
      
      // Calculate distribution - lower concentration is better
      const topHolderPercentage = holders[0]?.percentage || 0;
      distribution = Math.min(10, (1 - topHolderPercentage / 100) * 10);
    }
    
    // 4. Metadata quality (0-15 points)
    let metadataQuality = 0;
    if (tokenInfo) {
      // Check for name, symbol, description, website, etc.
      metadataQuality += tokenInfo.name ? 3 : 0;
      metadataQuality += tokenInfo.symbol ? 2 : 0;
      metadataQuality += tokenInfo.description ? 3 : 0;
      metadataQuality += tokenInfo.website ? 3 : 0;
      metadataQuality += tokenInfo.twitter ? 2 : 0;
      metadataQuality += tokenInfo.telegram ? 2 : 0;
    }
    metadataQuality = Math.min(15, metadataQuality);
    
    // 5. Social signals (0-20 points)
    let socialSignals = 0;
    // This would ideally check Twitter/Telegram activity
    // For now, use a placeholder based on metadata presence
    socialSignals = Math.min(20, metadataQuality * 1.33);
    
    // Calculate overall score (0-100)
    const score = liquidity + volume + holderGrowth + distribution + metadataQuality + socialSignals;
    
    // Generate recommendation
    let recommendation = 'neutral';
    if (score >= 80) {
      recommendation = 'high potential';
    } else if (score >= 60) {
      recommendation = 'moderate potential';
    } else if (score >= 40) {
      recommendation = 'monitor';
    } else {
      recommendation = 'low potential';
    }
    
    return {
      score,
      liquidity,
      volume,
      holderGrowth,
      metadataQuality,
      socialSignals,
      distribution,
      recommendation
    };
  } catch (error) {
    logger.error(`Failed to analyze new token potential: ${error.message}`);
    return {
      score: 0,
      liquidity: 0,
      volume: 0,
      holderGrowth: 0,
      metadataQuality: 0,
      socialSignals: 0,
      distribution: 0,
      recommendation: 'failed to analyze'
    };
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

/**
 * Get token price from Jupiter API
 * 
 * @param tokenMint - Token mint address
 * @param fallbackPrice - Optional fallback price if API call fails
 * @returns Token price in USD
 */
export async function getPriceFromJupiter(
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
    
    // Make request to Jupiter API with rate limiting and retries
    const response = await rateLimiter.limit('jupiter:api', () => 
      retry(
        () => axios.get(
          `${JUPITER_API_URL}/price?ids=${mintAddress}`,
          {
            timeout: 5000, // 5 second timeout
          }
        ),
        3, // 3 retries
        1000, // 1 second initial delay
        (error, attempt) => {
          logger.warn(`Jupiter API request attempt ${attempt} failed: ${error.message}`);
        }
      )
    );
    
    // Extract price from response with validation
    if (!response.data || typeof response.data !== 'object') {
      throw new Error('Invalid response from Jupiter API');
    }
    
    const price = response.data?.data?.[mintAddress]?.price;
    
    // Validate price
    if (price === undefined || price === null || isNaN(price)) {
      if (fallbackPrice !== undefined) {
        logger.warn(`Invalid price from Jupiter for ${mintAddress}, using fallback: ${fallbackPrice}`);
        return fallbackPrice;
      }
      throw new Error(`Invalid price data for token ${mintAddress}`);
    }
    
    logger.debug(`Jupiter price for ${mintAddress}: ${price}`);
    return price;
  } catch (error) {
    logger.error(`Failed to get price from Jupiter: ${error.message}`);
    
    // Use fallback price if provided
    if (fallbackPrice !== undefined) {
      logger.info(`Using fallback price after error: ${fallbackPrice}`);
      return fallbackPrice;
    }
    
    throw new Error(`Failed to get price: ${error.message}`);
  }
}

/**
 * Get multiple token prices from Jupiter API
 * 
 * @param tokenMints - Array of token mint addresses
 * @returns Map of token address to price
 */
export async function getMultipleTokenPricesFromJupiter(
  tokenMints: (string | PublicKey)[]
): Promise<Map<string, number>> {
  try {
    const addresses = tokenMints.map(mint => 
      mint instanceof PublicKey ? mint.toString() : mint
    ).join(',');
    
    // Make request to Jupiter API with rate limiting
    const response = await rateLimiter.limit('jupiter:api', () => 
      retry(() => axios.get(
        `${JUPITER_API_URL}/price?ids=${addresses}`,
        {
          timeout: 5000, // 5 second timeout
        }
      ))
    );
    
    // Process response
    const priceMap = new Map<string, number>();
    const data = response.data?.data || {};
    
    for (const [address, info] of Object.entries(data)) {
      priceMap.set(address, info.price || 0);
    }
    
    return priceMap;
  } catch (error) {
    logger.error(`Failed to get multiple prices from Jupiter: ${error.message}`);
    throw new Error(`Failed to get multiple prices from Jupiter: ${error.message}`);
  }
}

/**
 * Get the most accurate price by comparing Jupiter and Birdeye
 * Jupiter is preferred for accuracy since it's not high frequency
 * Falls back to Birdeye if Jupiter fails
 * 
 * @param tokenMint - Token mint address
 * @param fallbackPrice - Optional fallback price if both APIs fail
 * @returns Token price in USD
 */
export async function getBestPrice(
  tokenMint: string | PublicKey,
  fallbackPrice?: number
): Promise<number> {
  try {
    // Try Jupiter first as it's more accurate for our use case
    return await getPriceFromJupiter(tokenMint, undefined);
  } catch (jupiterError) {
    logger.warn(`Jupiter price fetch failed, falling back to Birdeye: ${jupiterError.message}`);
    
    try {
      // Fall back to Birdeye if Jupiter fails
      return await getPriceFromBirdeye(tokenMint, fallbackPrice);
    } catch (birdeyeError) {
      logger.error(`All price sources failed for ${tokenMint}`);
      
      if (fallbackPrice !== undefined) {
        logger.info(`Using fallback price: ${fallbackPrice}`);
        return fallbackPrice;
      }
      
      throw new Error(`Failed to get price from all sources for ${tokenMint}`);
    }
  }
}

/**
 * Get multiple token prices from the best available source
 * Jupiter is preferred for accuracy since it's not high frequency
 * Falls back to Birdeye if Jupiter fails
 * 
 * @param tokenMints - Array of token mint addresses
 * @returns Map of token address to price
 */
export async function getBestMultipleTokenPrices(
  tokenMints: (string | PublicKey)[]
): Promise<Map<string, number>> {
  try {
    // Try Jupiter first
    return await getMultipleTokenPricesFromJupiter(tokenMints);
  } catch (jupiterError) {
    logger.warn(`Jupiter multiple prices fetch failed, falling back to Birdeye: ${jupiterError.message}`);
    
    // Fall back to Birdeye
    return await getMultipleTokenPrices(tokenMints);
  }
}