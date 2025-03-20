/**
 * MCP (Model Context Protocol) Server for Comet
 * 
 * This server allows Claude to access additional context for making better decisions
 * without consuming context tokens. It provides market data, portfolio information,
 * and other relevant data.
 * 
 * Hono implementation with Birdeye Starter Plan integration.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { serve } from '@hono/node-server';
import { 
  getTokenInfo, 
  getTokenMarketData, 
  getTokenOHLCV, 
  getPairOHLCV,
  getTokenTrades,
  getPairTrades,
  getWalletPortfolio,
  getWalletHistoricalTrades,
  getTokenTopHolders,
  getBestPrice
} from '../agent/utils/price';
import { PublicKey } from '@solana/web3.js';
import { rateLimiter } from '../agent/utils/rate-limiter';

// Types
interface TokenPairData {
  tokenX: string;
  tokenY: string;
  price: number | null;
  volume24h: number | null;
  priceHistory: Array<{ timestamp: number; price: number }>;
  volatility: number | null;
  trend: string | null;
  timestamp: number;
  message?: string;
}

interface PortfolioData {
  walletAddress?: string;
  positions: Array<any>;
  totalValue: number;
  timestamp: number;
  message?: string;
}

interface PoolData {
  address: string;
  tokenX: string;
  tokenY: string;
  liquidity: number;
  activeBin: number;
  binStep: number;
  feeTier: number;
  positions: Array<any>;
  timestamp: number;
  message?: string;
}

interface PoolsData {
  pools: Array<PoolData>;
  timestamp: number;
  message?: string;
}

// Cache data
let marketDataCache: Record<string, TokenPairData> = {};
let portfolioCache: PortfolioData = {
  positions: [],
  totalValue: 0,
  timestamp: Date.now()
};
let poolsCache: PoolsData = {
  pools: [],
  timestamp: Date.now()
};
let tokenInfoCache: Record<string, any> = {};
let tokenOHLCVCache: Record<string, any[]> = {};
let tokenTradesCache: Record<string, any[]> = {};

// Create Hono app
const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', prettyJSON());
app.use('*', cors());

// Root route
app.get('/', (c) => {
  return c.json({ 
    status: 'ok', 
    service: 'Comet MCP Server',
    version: '1.0.0',
    features: [
      'Market data',
      'Portfolio information',
      'Pool analytics',
      'Birdeye Starter Plan integration'
    ]
  });
});

/**
 * Endpoint to get market data for a specific token pair
 */
app.get('/api/market/:tokenX/:tokenY', (c) => {
  const tokenX = c.req.param('tokenX');
  const tokenY = c.req.param('tokenY');
  const pairKey = `${tokenX}/${tokenY}`;
  
  // Return cached data or empty structure
  return c.json(marketDataCache[pairKey] || {
    tokenX,
    tokenY,
    price: null,
    volume24h: null,
    priceHistory: [],
    volatility: null,
    trend: null,
    timestamp: Date.now(),
    message: "No data available for this pair"
  });
});

/**
 * Endpoint to update market data
 */
app.post('/api/market/:tokenX/:tokenY', async (c) => {
  const tokenX = c.req.param('tokenX');
  const tokenY = c.req.param('tokenY');
  const pairKey = `${tokenX}/${tokenY}`;
  const data = await c.req.json();
  
  marketDataCache[pairKey] = {
    ...data,
    timestamp: Date.now()
  };
  
  return c.json({ success: true, message: `Market data updated for ${pairKey}` });
});

/**
 * Endpoint to get portfolio data
 */
app.get('/api/portfolio', (c) => {
  return c.json(portfolioCache || {
    positions: [],
    totalValue: 0,
    timestamp: Date.now(),
    message: "No portfolio data available"
  });
});

/**
 * Endpoint to update portfolio data
 */
app.post('/api/portfolio', async (c) => {
  const data = await c.req.json();
  
  portfolioCache = {
    ...data,
    timestamp: Date.now()
  };
  
  return c.json({ success: true, message: "Portfolio data updated" });
});

/**
 * Endpoint to get pools data
 */
app.get('/api/pools', (c) => {
  return c.json(poolsCache || {
    pools: [],
    timestamp: Date.now(),
    message: "No pools data available"
  });
});

/**
 * Endpoint to update pools data
 */
app.post('/api/pools', async (c) => {
  const data = await c.req.json();
  
  poolsCache = {
    ...data,
    timestamp: Date.now()
  };
  
  return c.json({ success: true, message: "Pools data updated" });
});

/**
 * Endpoint to get a specific pool's data
 */
app.get('/api/pools/:address', (c) => {
  const address = c.req.param('address');
  
  if (poolsCache && poolsCache.pools) {
    const pool = poolsCache.pools.find(p => p.address === address);
    if (pool) {
      return c.json(pool);
    }
  }
  
  return c.json({
    address,
    timestamp: Date.now(),
    message: "No data available for this pool"
  });
});

/**
 * Get all available data for Claude context
 */
app.get('/api/claude-context', (c) => {
  return c.json({
    market: marketDataCache,
    portfolio: portfolioCache,
    pools: poolsCache,
    tokens: tokenInfoCache,
    ohlcv: tokenOHLCVCache,
    trades: tokenTradesCache,
    timestamp: Date.now()
  });
});

// Birdeye Starter Plan API endpoints
/**
 * Get token information
 */
app.get('/api/token/:address', async (c) => {
  try {
    const address = c.req.param('address');
    
    // Check cache first
    if (tokenInfoCache[address] && tokenInfoCache[address].timestamp > Date.now() - 3600000) {
      return c.json(tokenInfoCache[address]);
    }
    
    // Rate limit request to Birdeye
    await rateLimiter.limit('mcp:api', async () => {
      const tokenInfo = await getTokenInfo(address);
      const tokenMarket = await getTokenMarketData(address);
      
      // Combine data
      const combinedData = {
        ...tokenInfo,
        market: tokenMarket,
        timestamp: Date.now()
      };
      
      // Update cache
      tokenInfoCache[address] = combinedData;
      
      return combinedData;
    });
    
    return c.json(tokenInfoCache[address]);
  } catch (error) {
    return c.json({ 
      error: true, 
      message: error.message || 'Failed to get token information',
      timestamp: Date.now()
    }, 500);
  }
});

/**
 * Get token OHLCV data
 */
app.get('/api/token/:address/ohlcv', async (c) => {
  try {
    const address = c.req.param('address');
    const timeframe = c.req.query('timeframe') || '1H';
    const limit = parseInt(c.req.query('limit') || '24', 10);
    const cacheKey = `${address}_${timeframe}_${limit}`;
    
    // Check cache first
    if (tokenOHLCVCache[cacheKey] && tokenOHLCVCache[cacheKey].timestamp > Date.now() - 3600000) {
      return c.json(tokenOHLCVCache[cacheKey]);
    }
    
    // Rate limit request to Birdeye
    await rateLimiter.limit('mcp:api', async () => {
      const ohlcvData = await getTokenOHLCV(address, timeframe, limit);
      
      // Update cache
      tokenOHLCVCache[cacheKey] = {
        data: ohlcvData,
        timeframe,
        limit,
        timestamp: Date.now()
      };
      
      return ohlcvData;
    });
    
    return c.json(tokenOHLCVCache[cacheKey]);
  } catch (error) {
    return c.json({ 
      error: true, 
      message: error.message || 'Failed to get token OHLCV data',
      timestamp: Date.now()
    }, 500);
  }
});

/**
 * Get token trades
 */
app.get('/api/token/:address/trades', async (c) => {
  try {
    const address = c.req.param('address');
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const cacheKey = `${address}_${limit}`;
    
    // Check cache first
    if (tokenTradesCache[cacheKey] && tokenTradesCache[cacheKey].timestamp > Date.now() - 300000) { // 5 minute cache
      return c.json(tokenTradesCache[cacheKey]);
    }
    
    // Rate limit request to Birdeye
    await rateLimiter.limit('mcp:api', async () => {
      const tradesData = await getTokenTrades(address, limit);
      
      // Update cache
      tokenTradesCache[cacheKey] = {
        data: tradesData,
        limit,
        timestamp: Date.now()
      };
      
      return tradesData;
    });
    
    return c.json(tokenTradesCache[cacheKey]);
  } catch (error) {
    return c.json({ 
      error: true, 
      message: error.message || 'Failed to get token trades',
      timestamp: Date.now()
    }, 500);
  }
});

/**
 * Get token pair data
 */
app.get('/api/pair/:baseAddress/:quoteAddress', async (c) => {
  try {
    const baseAddress = c.req.param('baseAddress');
    const quoteAddress = c.req.param('quoteAddress');
    const timeframe = c.req.query('timeframe') || '1H';
    const limit = parseInt(c.req.query('limit') || '24', 10);
    const cacheKey = `${baseAddress}_${quoteAddress}_${timeframe}_${limit}`;
    
    // Rate limit request to Birdeye
    await rateLimiter.limit('mcp:api', async () => {
      // Get OHLCV data for the pair
      const ohlcvData = await getPairOHLCV(baseAddress, quoteAddress, timeframe, limit);
      
      // Get recent trades for the pair
      const tradesData = await getPairTrades(baseAddress, quoteAddress, 20);
      
      // Get current price
      const price = await getBestPrice(baseAddress);
      
      // Combine data
      const pairData = {
        base: baseAddress,
        quote: quoteAddress,
        price,
        ohlcv: {
          timeframe,
          data: ohlcvData
        },
        trades: tradesData,
        timestamp: Date.now()
      };
      
      // Update cache in market data
      const pairKey = `${baseAddress}/${quoteAddress}`;
      marketDataCache[pairKey] = {
        tokenX: baseAddress,
        tokenY: quoteAddress,
        price,
        volume24h: calculateVolume(tradesData),
        priceHistory: extractPriceHistory(ohlcvData),
        volatility: calculateVolatility(ohlcvData),
        trend: determineTrend(ohlcvData),
        timestamp: Date.now()
      };
      
      return pairData;
    });
    
    const pairKey = `${baseAddress}/${quoteAddress}`;
    return c.json({
      ...marketDataCache[pairKey],
      ohlcv: tokenOHLCVCache[cacheKey],
      trades: tokenTradesCache[`${baseAddress}_${quoteAddress}_20`]
    });
  } catch (error) {
    return c.json({ 
      error: true, 
      message: error.message || 'Failed to get pair data',
      timestamp: Date.now()
    }, 500);
  }
});

/**
 * Get wallet portfolio data
 */
app.get('/api/wallet/:address/portfolio', async (c) => {
  try {
    const address = c.req.param('address');
    
    // Rate limit request to Birdeye
    await rateLimiter.limit('mcp:api', async () => {
      const portfolioData = await getWalletPortfolio(address);
      
      // Update cache
      portfolioCache = {
        walletAddress: address,
        positions: portfolioData.items || [],
        totalValue: portfolioData.totalValue || 0,
        timestamp: Date.now()
      };
      
      return portfolioData;
    });
    
    return c.json(portfolioCache);
  } catch (error) {
    return c.json({ 
      error: true, 
      message: error.message || 'Failed to get wallet portfolio',
      timestamp: Date.now()
    }, 500);
  }
});

/**
 * Get wallet historical trades
 */
app.get('/api/wallet/:address/trades', async (c) => {
  try {
    const address = c.req.param('address');
    const limit = parseInt(c.req.query('limit') || '50', 10);
    
    // Rate limit request to Birdeye
    const tradesData = await rateLimiter.limit('mcp:api', async () => {
      return await getWalletHistoricalTrades(address, limit);
    });
    
    return c.json({
      address,
      trades: tradesData,
      limit,
      timestamp: Date.now()
    });
  } catch (error) {
    return c.json({ 
      error: true, 
      message: error.message || 'Failed to get wallet historical trades',
      timestamp: Date.now()
    }, 500);
  }
});

/**
 * Get token top holders
 */
app.get('/api/token/:address/holders', async (c) => {
  try {
    const address = c.req.param('address');
    const limit = parseInt(c.req.query('limit') || '20', 10);
    
    // Rate limit request to Birdeye
    const holdersData = await rateLimiter.limit('mcp:api', async () => {
      return await getTokenTopHolders(address, limit);
    });
    
    return c.json({
      address,
      holders: holdersData,
      limit,
      timestamp: Date.now()
    });
  } catch (error) {
    return c.json({ 
      error: true, 
      message: error.message || 'Failed to get token top holders',
      timestamp: Date.now()
    }, 500);
  }
});

// Helper functions
function calculateVolume(trades: any[]): number {
  if (!trades || trades.length === 0) return 0;
  return trades.reduce((sum, trade) => sum + (trade.volume || 0), 0);
}

function extractPriceHistory(ohlcvData: any[]): Array<{ timestamp: number; price: number }> {
  if (!ohlcvData || ohlcvData.length === 0) return [];
  return ohlcvData.map(candle => ({
    timestamp: candle.timestamp || Date.now(),
    price: candle.close || 0
  }));
}

function calculateVolatility(ohlcvData: any[]): number {
  if (!ohlcvData || ohlcvData.length < 2) return 0;
  
  // Calculate standard deviation of returns
  const returns: number[] = [];
  for (let i = 1; i < ohlcvData.length; i++) {
    const prevClose = ohlcvData[i-1].close;
    const currClose = ohlcvData[i].close;
    if (prevClose && currClose) {
      returns.push((currClose - prevClose) / prevClose);
    }
  }
  
  if (returns.length === 0) return 0;
  
  // Calculate mean
  const mean = returns.reduce((sum, val) => sum + val, 0) / returns.length;
  
  // Calculate variance
  const variance = returns.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / returns.length;
  
  // Return standard deviation (volatility)
  return Math.sqrt(variance) * 100; // Expressed as percentage
}

function determineTrend(ohlcvData: any[]): string {
  if (!ohlcvData || ohlcvData.length < 5) return 'neutral';
  
  const recentCandles = ohlcvData.slice(-5);
  const firstClose = recentCandles[0].close;
  const lastClose = recentCandles[recentCandles.length - 1].close;
  
  if (!firstClose || !lastClose) return 'neutral';
  
  const percentChange = ((lastClose - firstClose) / firstClose) * 100;
  
  if (percentChange > 2) return 'bullish';
  if (percentChange < -2) return 'bearish';
  return 'neutral';
}

// Start the server
const PORT = process.env.MCP_PORT || 3003;
console.log(`MCP Server starting on port ${PORT}...`);

serve({
  fetch: app.fetch,
  port: Number(PORT)
});