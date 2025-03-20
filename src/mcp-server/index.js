/**
 * MCP (Model Context Protocol) Server for Comet
 * 
 * This server allows Claude to access additional context for making better decisions
 * without consuming context tokens. It provides market data, portfolio information,
 * and other relevant data.
 */

const express = require('express');
const app = express();
const PORT = process.env.MCP_PORT || 3003;

// Middleware
app.use(express.json());

// Market data cache
let marketDataCache = {};
let portfolioCache = {};
let poolsCache = {};

// Routes
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Comet MCP Server' });
});

/**
 * Endpoint to get market data for a specific token pair
 */
app.get('/api/market/:tokenX/:tokenY', (req, res) => {
  const { tokenX, tokenY } = req.params;
  const pairKey = `${tokenX}/${tokenY}`;
  
  // Return cached data or empty structure
  res.json(marketDataCache[pairKey] || {
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
app.post('/api/market/:tokenX/:tokenY', (req, res) => {
  const { tokenX, tokenY } = req.params;
  const pairKey = `${tokenX}/${tokenY}`;
  const data = req.body;
  
  marketDataCache[pairKey] = {
    ...data,
    timestamp: Date.now()
  };
  
  res.json({ success: true, message: `Market data updated for ${pairKey}` });
});

/**
 * Endpoint to get portfolio data
 */
app.get('/api/portfolio', (req, res) => {
  res.json(portfolioCache || {
    positions: [],
    totalValue: 0,
    timestamp: Date.now(),
    message: "No portfolio data available"
  });
});

/**
 * Endpoint to update portfolio data
 */
app.post('/api/portfolio', (req, res) => {
  const data = req.body;
  
  portfolioCache = {
    ...data,
    timestamp: Date.now()
  };
  
  res.json({ success: true, message: "Portfolio data updated" });
});

/**
 * Endpoint to get pools data
 */
app.get('/api/pools', (req, res) => {
  res.json(poolsCache || {
    pools: [],
    timestamp: Date.now(),
    message: "No pools data available"
  });
});

/**
 * Endpoint to update pools data
 */
app.post('/api/pools', (req, res) => {
  const data = req.body;
  
  poolsCache = {
    ...data,
    timestamp: Date.now()
  };
  
  res.json({ success: true, message: "Pools data updated" });
});

/**
 * Endpoint to get a specific pool's data
 */
app.get('/api/pools/:address', (req, res) => {
  const { address } = req.params;
  
  if (poolsCache && poolsCache.pools) {
    const pool = poolsCache.pools.find(p => p.address === address);
    if (pool) {
      return res.json(pool);
    }
  }
  
  res.json({
    address,
    timestamp: Date.now(),
    message: "No data available for this pool"
  });
});

/**
 * Get all available data for Claude context
 */
app.get('/api/claude-context', (req, res) => {
  res.json({
    market: marketDataCache,
    portfolio: portfolioCache,
    pools: poolsCache,
    timestamp: Date.now()
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`MCP Server running on port ${PORT}`);
});