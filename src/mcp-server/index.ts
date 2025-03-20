/**
 * MCP (Model Context Protocol) Server for Comet
 * 
 * This server allows Claude to access additional context for making better decisions
 * without consuming context tokens. It provides market data, portfolio information,
 * and other relevant data.
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

// Create Hono app
const app = new Hono();

// Add middleware
app.use('*', logger());
app.use('*', cors());

// Market data cache
const marketDataCache: Record<string, any> = {};
let portfolioCache: Record<string, any> = {};
let poolsCache: Record<string, any> = {};

// Routes
app.get('/', (c) => {
  return c.json({ status: 'ok', service: 'Comet MCP Server' });
});

/**
 * Endpoint to get market data for a specific token pair
 */
app.get('/api/market/:tokenX/:tokenY', (c) => {
  const { tokenX, tokenY } = c.req.param();
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
  const { tokenX, tokenY } = c.req.param();
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
  const { address } = c.req.param();
  
  if (poolsCache && poolsCache.pools) {
    const pool = poolsCache.pools.find((p: any) => p.address === address);
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
    timestamp: Date.now()
  });
});

// Get port from environment or use default
const PORT = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT) : 3003;

// Start the server
serve({
  fetch: app.fetch,
  port: PORT
});

console.log(`MCP Server running on port ${PORT}`);