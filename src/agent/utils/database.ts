/**
 * Database utilities for Comet agent
 */

import { Pool, PoolClient } from 'pg';
import { logger } from './logger';

// PostgreSQL connection pool
let pool: Pool | null = null;

// Initialize database connection pool
export function initializeDatabase(): Pool {
  if (pool !== null) {
    return pool;
  }

  try {
    pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      database: process.env.POSTGRES_DB || 'comet',
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // How long a client is allowed to remain idle
      connectionTimeoutMillis: 5000, // How long to wait for a connection
    });

    // Handle connection errors
    pool.on('error', (err) => {
      logger.error('Unexpected database error:', err);
    });

    logger.info('Database connection pool initialized');
    return pool;
  } catch (error) {
    logger.error('Failed to initialize database pool:', error);
    throw new Error(`Database initialization failed: ${error.message}`);
  }
}

// Get a client from the pool
export async function getClient(): Promise<PoolClient> {
  if (pool === null) {
    initializeDatabase();
  }
  
  try {
    return await pool.connect();
  } catch (error) {
    logger.error('Failed to connect to database:', error);
    throw new Error(`Database connection failed: ${error.message}`);
  }
}

// Register an agent in the database
export async function registerAgent(
  poolAddress: string,
  walletAddress: string,
  strategy: string,
  binRange: number,
  autoRebalance: boolean
): Promise<number> {
  const client = await getClient();
  
  try {
    // Check if agent already exists
    const checkResult = await client.query(
      'SELECT id FROM agents WHERE pool_address = $1',
      [poolAddress]
    );
    
    if (checkResult.rows.length > 0) {
      // Update existing agent
      const updateResult = await client.query(
        `UPDATE agents 
        SET wallet_address = $1, strategy = $2, bin_range = $3, auto_rebalance = $4, status = 'running', updated_at = NOW()
        WHERE pool_address = $5
        RETURNING id`,
        [walletAddress, strategy, binRange, autoRebalance, poolAddress]
      );
      
      return updateResult.rows[0].id;
    } else {
      // Insert new agent
      const insertResult = await client.query(
        `INSERT INTO agents 
        (pool_address, wallet_address, status, strategy, bin_range, auto_rebalance)
        VALUES ($1, $2, 'running', $3, $4, $5)
        RETURNING id`,
        [poolAddress, walletAddress, strategy, binRange, autoRebalance]
      );
      
      return insertResult.rows[0].id;
    }
  } catch (error) {
    logger.error('Database error while registering agent:', error);
    throw new Error(`Failed to register agent: ${error.message}`);
  } finally {
    client.release();
  }
}

// Update agent status
export async function updateAgentStatus(
  poolAddress: string,
  status: string
): Promise<void> {
  const client = await getClient();
  
  try {
    await client.query(
      `UPDATE agents 
      SET status = $1, updated_at = NOW()
      WHERE pool_address = $2`,
      [status, poolAddress]
    );
  } catch (error) {
    logger.error('Database error while updating agent status:', error);
    throw new Error(`Failed to update agent status: ${error.message}`);
  } finally {
    client.release();
  }
}

// Register a pool in the database
export async function registerPool(
  address: string,
  tokenXAddress: string,
  tokenYAddress: string,
  binStep: number,
  activeBinId: number,
  feeBps: number,
  tokenXSymbol?: string,
  tokenYSymbol?: string
): Promise<number> {
  const client = await getClient();
  
  try {
    // Check if pool already exists
    const checkResult = await client.query(
      'SELECT id FROM pools WHERE address = $1',
      [address]
    );
    
    if (checkResult.rows.length > 0) {
      // Update existing pool
      const updateResult = await client.query(
        `UPDATE pools 
        SET token_x_address = $1, token_y_address = $2, bin_step = $3, 
        active_bin_id = $4, fee_bps = $5, token_x_symbol = $6, token_y_symbol = $7, updated_at = NOW()
        WHERE address = $8
        RETURNING id`,
        [tokenXAddress, tokenYAddress, binStep, activeBinId, feeBps, tokenXSymbol, tokenYSymbol, address]
      );
      
      return updateResult.rows[0].id;
    } else {
      // Insert new pool
      const insertResult = await client.query(
        `INSERT INTO pools 
        (address, token_x_address, token_y_address, bin_step, active_bin_id, fee_bps, token_x_symbol, token_y_symbol)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
        [address, tokenXAddress, tokenYAddress, binStep, activeBinId, feeBps, tokenXSymbol, tokenYSymbol]
      );
      
      return insertResult.rows[0].id;
    }
  } catch (error) {
    logger.error('Database error while registering pool:', error);
    throw new Error(`Failed to register pool: ${error.message}`);
  } finally {
    client.release();
  }
}

// Record pool metrics
export async function recordPoolMetrics(
  poolAddress: string,
  activeBinId: number,
  currentPrice: number,
  tokenXPriceUsd: number,
  tokenYPriceUsd: number,
  liquidityX: string,
  liquidityY: string,
  tvlUsd?: number,
  volume24h?: number,
  fees24h?: number
): Promise<void> {
  const client = await getClient();
  
  try {
    await client.query(
      `INSERT INTO pool_metrics 
      (time, pool_address, active_bin_id, current_price, token_x_price_usd, token_y_price_usd, 
      liquidity_x, liquidity_y, total_value_locked_usd, volume_24h, fees_24h)
      VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [poolAddress, activeBinId, currentPrice, tokenXPriceUsd, tokenYPriceUsd, 
       liquidityX, liquidityY, tvlUsd, volume24h, fees24h]
    );
  } catch (error) {
    logger.error('Database error while recording pool metrics:', error);
    throw new Error(`Failed to record pool metrics: ${error.message}`);
  } finally {
    client.release();
  }
}

// Record rebalance event
export async function recordRebalanceEvent(
  agentId: number,
  poolAddress: string,
  oldActiveBin: number,
  newActiveBin: number,
  oldPrice: number,
  newPrice: number,
  transactionHash?: string,
  success: boolean = true,
  errorMessage?: string
): Promise<void> {
  const client = await getClient();
  
  try {
    await client.query(
      `INSERT INTO rebalance_events 
      (time, agent_id, pool_address, old_active_bin, new_active_bin, old_price, new_price, 
      transaction_hash, success, error_message)
      VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [agentId, poolAddress, oldActiveBin, newActiveBin, oldPrice, newPrice, 
       transactionHash, success, errorMessage]
    );
  } catch (error) {
    logger.error('Database error while recording rebalance event:', error);
    // Don't throw here, as this is a non-critical operation
    // Just log the error and continue
  } finally {
    client.release();
  }
}

// Record fee collection event
export async function recordFeeCollectionEvent(
  agentId: number,
  poolAddress: string,
  positionAddress: string,
  amountX: string,
  amountY: string,
  amountXUsd?: number,
  amountYUsd?: number,
  transactionHash?: string,
  success: boolean = true,
  errorMessage?: string
): Promise<void> {
  const client = await getClient();
  
  try {
    await client.query(
      `INSERT INTO fee_collection_events 
      (time, agent_id, pool_address, position_address, amount_x, amount_y, 
      amount_x_usd, amount_y_usd, transaction_hash, success, error_message)
      VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [agentId, poolAddress, positionAddress, amountX, amountY, 
       amountXUsd, amountYUsd, transactionHash, success, errorMessage]
    );
  } catch (error) {
    logger.error('Database error while recording fee collection event:', error);
    // Don't throw here, as this is a non-critical operation
    // Just log the error and continue
  } finally {
    client.release();
  }
}

// Get agent performance metrics
export async function getAgentPerformance(
  agentId: number,
  startTime: Date,
  endTime: Date
): Promise<any> {
  const client = await getClient();
  
  try {
    // Get the agent's pool address
    const agentResult = await client.query(
      'SELECT pool_address FROM agents WHERE id = $1',
      [agentId]
    );
    
    if (agentResult.rows.length === 0) {
      throw new Error(`Agent with ID ${agentId} not found`);
    }
    
    const poolAddress = agentResult.rows[0].pool_address;
    
    // Get performance metrics
    const metricsResult = await client.query(
      `WITH time_buckets AS (
        SELECT time_bucket('1 hour', time) as bucket,
               first(current_price, time) as open_price,
               max(current_price) as high_price,
               min(current_price) as low_price,
               last(current_price, time) as close_price,
               sum(fees_24h) / count(*) as avg_fees
        FROM pool_metrics
        WHERE pool_address = $1 AND time BETWEEN $2 AND $3
        GROUP BY bucket
        ORDER BY bucket
      ),
      rebalances AS (
        SELECT COUNT(*) as total_rebalances,
               COUNT(*) FILTER (WHERE success = true) as successful_rebalances
        FROM rebalance_events
        WHERE agent_id = $2 AND time BETWEEN $3 AND $4
      ),
      fee_collections AS (
        SELECT COUNT(*) as total_collections,
               SUM(amount_x_usd + amount_y_usd) as total_fees_collected_usd
        FROM fee_collection_events
        WHERE agent_id = $2 AND time BETWEEN $3 AND $4 AND success = true
      )
      SELECT jsonb_build_object(
        'price_data', jsonb_agg(
          jsonb_build_object(
            'time', bucket,
            'open', open_price,
            'high', high_price,
            'low', low_price,
            'close', close_price,
            'fees', avg_fees
          )
        ),
        'rebalances', (SELECT jsonb_build_object(
          'total', total_rebalances,
          'successful', successful_rebalances,
          'success_rate', CASE WHEN total_rebalances > 0 THEN successful_rebalances::float / total_rebalances ELSE 0 END
        ) FROM rebalances),
        'fee_collections', (SELECT jsonb_build_object(
          'total', total_collections,
          'total_usd', total_fees_collected_usd
        ) FROM fee_collections)
      ) as performance
      FROM time_buckets`,
      [poolAddress, startTime, endTime, agentId, startTime, endTime]
    );
    
    if (metricsResult.rows.length === 0) {
      return {
        price_data: [],
        rebalances: { total: 0, successful: 0, success_rate: 0 },
        fee_collections: { total: 0, total_usd: 0 }
      };
    }
    
    return metricsResult.rows[0].performance;
  } catch (error) {
    logger.error('Database error while fetching agent performance:', error);
    throw new Error(`Failed to fetch agent performance: ${error.message}`);
  } finally {
    client.release();
  }
}

// Shutdown database connection pool
export async function shutdownDatabase(): Promise<void> {
  if (pool !== null) {
    try {
      await pool.end();
      logger.info('Database connection pool closed');
    } catch (error) {
      logger.error('Error closing database connection pool:', error);
    } finally {
      pool = null;
    }
  }
}