/**
 * Rate limiter utility for API requests
 * 
 * This ensures that we don't exceed rate limits for external APIs
 * like Helius, Birdeye, etc.
 */

import { logger } from './logger';

/**
 * RateLimit configuration for an API endpoint or service
 */
interface RateLimitConfig {
  requests: number;       // Number of requests allowed
  period: number;         // Time period in milliseconds
  burst?: number;         // Allowed burst size (optional)
}

/**
 * Service rate limits (with environment variable overrides)
 */
export const API_RATE_LIMITS: Record<string, RateLimitConfig> = {
  // Helius API rate limits
  'helius:rpc': { 
    requests: parseInt(process.env.RATE_LIMIT_HELIUS_RPC || '50'), 
    period: 1000 
  },
  'helius:sendTransaction': { 
    requests: parseInt(process.env.RATE_LIMIT_HELIUS_SEND_TX || '5'), 
    period: 1000 
  },
  'helius:getProgramAccounts': { 
    requests: parseInt(process.env.RATE_LIMIT_HELIUS_PROGRAM_ACCTS || '25'), 
    period: 1000 
  },
  'helius:photon': { 
    requests: parseInt(process.env.RATE_LIMIT_HELIUS_PHOTON || '10'), 
    period: 1000 
  },
  'helius:api': { 
    requests: parseInt(process.env.RATE_LIMIT_HELIUS_API || '10'), 
    period: 1000 
  },
  'helius:priorityFee': { 
    requests: parseInt(process.env.RATE_LIMIT_HELIUS_PRIORITY_FEE || '10'), 
    period: 1000 
  },
  'helius:webhook': { 
    requests: parseInt(process.env.RATE_LIMIT_HELIUS_WEBHOOK || '2'), 
    period: 1000 
  },
  
  // Birdeye API rate limits
  'birdeye:api': { 
    requests: parseInt(process.env.RATE_LIMIT_BIRDEYE_API || '10'), 
    period: 1000 
  },
  
  // Claude AI API rate limits - to prevent excessive costs
  'claude:api': { 
    requests: parseInt(process.env.RATE_LIMIT_CLAUDE_API || '1'), 
    period: parseInt(process.env.RATE_LIMIT_CLAUDE_PERIOD || '10000')
  },
  
  // Default rate limiter for other services
  'default': { requests: 5, period: 1000 }
};

/**
 * Rate limiter class for handling API request rate limiting
 */
export class RateLimiter {
  private buckets: Map<string, { tokens: number, lastRefill: number }> = new Map();
  private config: Record<string, RateLimitConfig>;
  
  /**
   * Create a new rate limiter
   * @param config - Rate limit configuration for different services
   */
  constructor(config: Record<string, RateLimitConfig> = API_RATE_LIMITS) {
    this.config = config;
    
    // Initialize buckets
    Object.keys(config).forEach(key => {
      this.buckets.set(key, {
        tokens: config[key].requests,
        lastRefill: Date.now()
      });
    });
    
    logger.info('Rate limiter initialized');
    
    // Log configured rate limits at debug level
    Object.entries(config).forEach(([key, limit]) => {
      logger.debug(`Rate limit for ${key}: ${limit.requests} requests per ${limit.period}ms`);
    });
  }
  
  /**
   * Acquire a token from the rate limiter
   * @param key - The service key to rate limit
   * @returns Promise that resolves when a token is available
   */
  async acquire(key: string): Promise<void> {
    const limitKey = this.config[key] ? key : 'default';
    const limit = this.config[limitKey];
    
    if (!this.buckets.has(limitKey)) {
      this.buckets.set(limitKey, {
        tokens: limit.requests,
        lastRefill: Date.now()
      });
    }
    
    const bucket = this.buckets.get(limitKey)!;
    
    // Refill tokens based on time elapsed
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = Math.floor(elapsed / limit.period * limit.requests);
    
    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(limit.requests, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }
    
    // If no tokens available, wait for next refill
    if (bucket.tokens <= 0) {
      const timeToNextToken = Math.ceil(limit.period / limit.requests);
      logger.debug(`Rate limit reached for ${key}, waiting ${timeToNextToken}ms`);
      
      await new Promise(resolve => setTimeout(resolve, timeToNextToken));
      // Recursively try again after waiting
      return this.acquire(key);
    }
    
    // Consume a token
    bucket.tokens--;
    return Promise.resolve();
  }
  
  /**
   * Rate-limited function wrapper
   * @param key - The service key to rate limit
   * @param fn - The function to rate limit
   * @returns A rate-limited version of the function
   */
  async limit<T>(key: string, fn: () => Promise<T>): Promise<T> {
    await this.acquire(key);
    return fn();
  }
}

// Export singleton instance
export const rateLimiter = new RateLimiter();

export default rateLimiter;