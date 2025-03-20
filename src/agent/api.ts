/**
 * API endpoints for the Comet agent
 * Exposes agent functionality through a Hono server
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { validator } from 'hono/validator';
import { logger } from './utils/logger';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { StrategyType } from '../dlmm/types';
import { Comet } from './index';
import { CometConfig, AgentStatus } from './types';
import { parseEnvConfig, retry } from './utils/helpers';

// Create Hono app
const app = new Hono();

// Apply CORS middleware
app.use('/*', cors());

// Store agent instances
const agents = new Map<string, Comet>();

// Parse environment config
const envConfig = parseEnvConfig();

// Helper to get agent by pool address or create new one
async function getOrCreateAgent(poolAddress: string): Promise<Comet> {
  if (!poolAddress || !PublicKey.isOnCurve(poolAddress)) {
    throw new Error(`Invalid pool address: ${poolAddress}`);
  }

  if (agents.has(poolAddress)) {
    return agents.get(poolAddress);
  }
  
  const config: CometConfig = {
    ...envConfig,
    poolAddress
  };
  
  try {
    const agent = new Comet(config);
    await retry(
      async () => agent.initialize(),
      envConfig.maxRetries,
      envConfig.retryDelay,
      (error, attempt) => {
        logger.warn(`Attempt ${attempt} to initialize agent for pool ${poolAddress} failed: ${error.message}`);
      }
    );
    
    agents.set(poolAddress, agent);
    return agent;
  } catch (error) {
    logger.error(`Failed to initialize agent for pool ${poolAddress}:`, error);
    throw new Error(`Failed to initialize agent: ${error.message}`);
  }
}

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: 'Comet Agent API',
    version: '1.0.0',
    status: 'running'
  });
});

// Validate start agent request
const startAgentValidator = validator('json', (value, c) => {
  const errors = [];
  
  if (!value.poolAddress) {
    errors.push('Pool address is required');
  } else {
    try {
      // Verify it's a valid public key
      new PublicKey(value.poolAddress);
    } catch (e) {
      errors.push('Invalid pool address format');
    }
  }
  
  if (value.strategy && !['Spot', 'BidAsk', 'Curve'].includes(value.strategy)) {
    errors.push('Strategy must be one of: Spot, BidAsk, Curve');
  }
  
  if (value.binRange && (typeof value.binRange !== 'number' || value.binRange <= 0)) {
    errors.push('Bin range must be a positive number');
  }
  
  if (value.autoRebalance !== undefined && typeof value.autoRebalance !== 'boolean') {
    errors.push('Auto rebalance must be a boolean');
  }
  
  if (errors.length > 0) {
    return [null, errors];
  }
  
  return [value, null];
});

// Start agent
app.post('/agents/start', startAgentValidator, async (c) => {
  try {
    const validatedData = c.req.valid('json');
    const { poolAddress, strategy, binRange, autoRebalance } = validatedData;
    
    // Check if agent is already running
    if (agents.has(poolAddress)) {
      return c.json({ 
        status: 'warning',
        message: `Agent for pool ${poolAddress} is already running` 
      }, 200);
    }
    
    const config: CometConfig = {
      ...envConfig,
      poolAddress,
      strategy: strategy || envConfig.strategy,
      binRange: binRange || envConfig.binRange,
      autoRebalance: autoRebalance !== undefined ? autoRebalance : envConfig.autoRebalance
    };
    
    const agent = new Comet(config);
    
    try {
      // Initialize agent first to ensure pool is valid before starting
      await agent.initialize();
      agents.set(poolAddress, agent);
      
      // Start agent in background
      agent.start().catch((err) => {
        logger.error(`Agent error for pool ${poolAddress}:`, err);
        // Remove failed agent from the registry
        agents.delete(poolAddress);
      });
      
      return c.json({
        status: 'success',
        message: `Agent started for pool ${poolAddress}`,
        config: {
          poolAddress,
          strategy: config.strategy,
          binRange: config.binRange,
          autoRebalance: config.autoRebalance
        }
      });
    } catch (initError) {
      logger.error(`Failed to initialize agent for pool ${poolAddress}:`, initError);
      return c.json({ 
        status: 'error',
        error: `Failed to initialize agent: ${initError.message}`,
        details: initError.stack
      }, 400);
    }
  } catch (error) {
    if (Array.isArray(error)) {
      // Validation errors
      return c.json({ 
        status: 'error',
        error: 'Validation failed',
        details: error 
      }, 400);
    }
    
    logger.error('Failed to start agent:', error);
    return c.json({ 
      status: 'error',
      error: `Server error: ${error.message}` 
    }, 500);
  }
});

// Stop agent
app.post('/agents/stop', async (c) => {
  try {
    const body = await c.req.json();
    const { poolAddress } = body;
    
    if (!poolAddress) {
      return c.json({ error: 'Pool address is required' }, 400);
    }
    
    const agent = agents.get(poolAddress);
    if (!agent) {
      return c.json({ error: `No agent found for pool ${poolAddress}` }, 404);
    }
    
    agent.stop();
    agents.delete(poolAddress);
    
    return c.json({
      status: 'success',
      message: `Agent stopped for pool ${poolAddress}`
    });
  } catch (error) {
    logger.error('Failed to stop agent:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Get agent status
app.get('/agents/:poolAddress/status', async (c) => {
  try {
    const poolAddress = c.req.param('poolAddress');
    const agent = agents.get(poolAddress);
    
    if (!agent) {
      return c.json({
        poolAddress,
        status: AgentStatus.Stopped
      });
    }
    
    // In a real implementation, you would get more detailed status from the agent
    return c.json({
      poolAddress,
      status: AgentStatus.Running,
      // Additional status details would be fetched from agent
    });
  } catch (error) {
    logger.error('Failed to get agent status:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Create pool
app.post('/pools/create', async (c) => {
  try {
    const body = await c.req.json();
    const {
      tokenX,
      tokenY,
      binStep,
      activeId,
      feeBps,
      activationType,
      hasAlphaVault
    } = body;
    
    // Validate required parameters
    if (!tokenX || !tokenY || !binStep || !activeId || !feeBps) {
      return c.json({ error: 'Missing required parameters' }, 400);
    }
    
    const config: CometConfig = {
      ...envConfig,
      createPoolParams: {
        tokenX: new PublicKey(tokenX),
        tokenY: new PublicKey(tokenY),
        binStep: parseInt(binStep),
        activeId: parseInt(activeId),
        feeBps: parseInt(feeBps),
        activationType: activationType || 1,
        hasAlphaVault: hasAlphaVault || false
      }
    };
    
    const agent = new Comet(config);
    const poolAddress = await agent.createPool();
    
    return c.json({
      status: 'success',
      message: 'Pool created successfully',
      poolAddress: poolAddress.toString()
    });
  } catch (error) {
    logger.error('Failed to create pool:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Add liquidity
app.post('/pools/:poolAddress/add-liquidity', async (c) => {
  try {
    const poolAddress = c.req.param('poolAddress');
    const body = await c.req.json();
    const { amountX, amountY, strategy, binRange } = body;
    
    // Validate required parameters
    if (!amountX || !amountY) {
      return c.json({ error: 'Missing required parameters' }, 400);
    }
    
    const agent = await getOrCreateAgent(poolAddress);
    
    // Override agent config if provided
    if (strategy) {
      // In a real implementation, you would update the agent's config
    }
    
    if (binRange) {
      // In a real implementation, you would update the agent's config
    }
    
    const xAmount = new BN(amountX);
    const yAmount = new BN(amountY);
    
    const txSignature = await agent.addLiquidity(xAmount, yAmount);
    
    return c.json({
      status: 'success',
      message: 'Liquidity added successfully',
      transaction: txSignature
    });
  } catch (error) {
    logger.error('Failed to add liquidity:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Rebalance
app.post('/pools/:poolAddress/rebalance', async (c) => {
  try {
    const poolAddress = c.req.param('poolAddress');
    const agent = await getOrCreateAgent(poolAddress);
    
    await agent.rebalance();
    
    return c.json({
      status: 'success',
      message: 'Positions rebalanced successfully'
    });
  } catch (error) {
    logger.error('Failed to rebalance positions:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Collect fees
app.post('/pools/:poolAddress/collect-fees', async (c) => {
  try {
    const poolAddress = c.req.param('poolAddress');
    const agent = await getOrCreateAgent(poolAddress);
    
    await agent.collectFees();
    
    return c.json({
      status: 'success',
      message: 'Fees collected successfully'
    });
  } catch (error) {
    logger.error('Failed to collect fees:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Export the app
export default app;