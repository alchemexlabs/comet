/**
 * Micro Portfolio Strategy implementation for Comet agent
 * 
 * This strategy is designed to grow a small portfolio ($100 USDC + 1 SOL)
 * through intelligent liquidity provision on Meteora DLMM pools.
 */

import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { DLMM } from '../../dlmm';
import { StrategyType } from '../../dlmm/types';
import { Comet } from '../index';
import { MicroPortfolioStrategy, MicroPortfolioConfig } from '../utils/strategies/micro-portfolio';
import { logger } from '../utils/logger';

// Default token addresses
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Implementation of the Micro Portfolio strategy for the Comet agent
 */
export class MicroPortfolioAgent {
  private agent: Comet;
  private strategy: MicroPortfolioStrategy;
  private config: MicroPortfolioConfig;
  private lastFeesCollected: number = 0;
  private lastRebalanceCheck: number = 0;
  private isActive: boolean = false;
  
  constructor(agent: Comet, config: Partial<MicroPortfolioConfig> = {}) {
    this.agent = agent;
    
    // Configure the strategy with sensible defaults
    this.config = {
      initialCapital: {
        usdc: config.initialCapital?.usdc || 100_000_000, // $100 USDC (100 million native units)
        sol: config.initialCapital?.sol || 1_000_000_000,  // 1 SOL (1 billion native units)
      },
      riskTolerance: config.riskTolerance || 'medium',
      usdcMint: config.usdcMint || USDC_MINT,
      solMint: config.solMint || SOL_MINT,
      maxAllocationPerPool: config.maxAllocationPerPool || 50,
      rebalanceThreshold: config.rebalanceThreshold || 5, // 5% price change triggers rebalance
      compoundInterval: config.compoundInterval || 24 * 60 * 60 * 1000, // 24 hours
      weekendSafetyEnabled: config.weekendSafetyEnabled !== undefined ? config.weekendSafetyEnabled : true,
      claude: {
        enabled: config.claude?.enabled || false,
        apiKey: config.claude?.apiKey || '',
        model: config.claude?.model || 'claude-3-sonnet-20240229'
      }
    };
    
    // Initialize the strategy
    this.strategy = new MicroPortfolioStrategy(this.config);
    
    logger.info('MicroPortfolio agent initialized');
  }
  
  /**
   * Start the strategy
   */
  async start(): Promise<void> {
    if (this.isActive) {
      logger.warn('MicroPortfolio strategy is already active');
      return;
    }
    
    this.isActive = true;
    logger.info('Starting MicroPortfolio strategy');
    
    // Initial portfolio value update
    await this.strategy.updatePortfolioValue();
    
    // Initial setup of pools
    await this.setupInitialPools();
    
    // Start periodic tasks
    this.startPeriodicTasks();
  }
  
  /**
   * Stop the strategy
   */
  async stop(): Promise<void> {
    if (!this.isActive) {
      logger.warn('MicroPortfolio strategy is not active');
      return;
    }
    
    this.isActive = false;
    logger.info('Stopping MicroPortfolio strategy');
    
    // Additional cleanup can be added here if needed
  }
  
  /**
   * Setup initial liquidity pools based on strategy recommendations
   */
  private async setupInitialPools(): Promise<void> {
    try {
      // Get recommended allocations
      const allocations = await this.strategy.getRecommendedAllocations();
      
      for (const allocation of allocations) {
        logger.info(`Setting up pool for ${allocation.tokenA.symbol}/${allocation.tokenB.symbol}`);
        
        try {
          // Find or create the DLMM pool
          const pool = await this.findOrCreatePool(
            new PublicKey(allocation.tokenA.mint),
            new PublicKey(allocation.tokenB.mint),
            allocation.binStep,
            allocation.baseFee
          );
          
          if (!pool) {
            logger.error(`Failed to find or create pool for ${allocation.tokenA.symbol}/${allocation.tokenB.symbol}`);
            continue;
          }
          
          // Add liquidity to the pool
          await this.addLiquidityToPool(
            pool,
            allocation.tokenA.amount,
            allocation.tokenB.amount,
            allocation.strategy,
            allocation.maxBinRange
          );
          
          // Update strategy with the new allocation
          this.strategy.updateAllocations(
            pool.lbPair.publicKey.toString(),
            allocation.tokenA.mint,
            allocation.tokenA.amount,
            allocation.tokenA.symbol,
            allocation.tokenB.mint,
            allocation.tokenB.amount,
            allocation.tokenB.symbol,
            allocation.strategy,
            allocation.binStep,
            allocation.baseFee,
            allocation.maxBinRange
          );
          
          logger.info(`Successfully set up pool for ${allocation.tokenA.symbol}/${allocation.tokenB.symbol}`);
        } catch (error) {
          logger.error(`Error setting up pool for ${allocation.tokenA.symbol}/${allocation.tokenB.symbol}:`, error);
        }
      }
    } catch (error) {
      logger.error('Error setting up initial pools:', error);
    }
  }
  
  /**
   * Start periodic tasks for the strategy
   */
  private startPeriodicTasks(): void {
    // Check for rebalance opportunities every 5 minutes
    setInterval(async () => {
      if (!this.isActive) return;
      
      try {
        const now = Date.now();
        
        // Update portfolio value
        await this.strategy.updatePortfolioValue();
        
        // Check if rebalance is needed (only if it's been at least 5 minutes since last check)
        if (now - this.lastRebalanceCheck >= 5 * 60 * 1000) {
          this.lastRebalanceCheck = now;
          
          const shouldRebalance = await this.strategy.shouldRebalance();
          if (shouldRebalance) {
            logger.info('Rebalance needed, executing rebalance operation');
            await this.rebalancePools();
          }
        }
        
        // Check if it's time to collect and compound fees
        if (now - this.lastFeesCollected >= this.config.compoundInterval) {
          this.lastFeesCollected = now;
          
          logger.info('Collecting and compounding fees');
          await this.collectAndCompoundFees();
        }
      } catch (error) {
        logger.error('Error in periodic tasks:', error);
      }
    }, 60 * 1000); // Run checks every minute
  }
  
  /**
   * Find an existing pool or create a new one
   */
  private async findOrCreatePool(
    tokenXMint: PublicKey,
    tokenYMint: PublicKey,
    binStep: number,
    feePercentage: number
  ): Promise<DLMM | null> {
    try {
      // Configure agent to use this token pair
      this.agent.setStrategy(StrategyType.Spot); // Default strategy for pool creation
      
      logger.info(`Creating new DLMM pool: ${tokenXMint.toString()} / ${tokenYMint.toString()}`);
      logger.info(`Bin step: ${binStep}, Fee percentage: ${feePercentage/100}%`);
      
      // Create the pool using the agent's built-in method
      const poolAddress = await this.agent.createPoolWithParameters(
        tokenXMint,
        tokenYMint,
        binStep,
        8388608, // Default active ID
        feePercentage
      );
      
      // Initialize the pool object
      this.agent.setPoolAddress(poolAddress);
      const pool = await this.agent.getPool();
      
      if (!pool) {
        throw new Error('Failed to get pool after creation');
      }
      
      logger.info(`Successfully created pool: ${poolAddress.toString()}`);
      return pool;
    } catch (error) {
      logger.error('Error finding or creating pool:', error);
      return null;
    }
  }
  
  /**
   * Add liquidity to a pool with the specified parameters
   */
  private async addLiquidityToPool(
    pool: DLMM,
    amountX: BN,
    amountY: BN,
    strategyType: StrategyType,
    binRange: number
  ): Promise<void> {
    try {
      logger.info(`Adding liquidity to pool: ${pool.lbPair.publicKey.toString()}`);
      logger.info(`X: ${amountX.toString()}, Y: ${amountY.toString()}, Strategy: ${strategyType}, Bin range: ${binRange}`);
      
      // Configure agent for this pool and strategy
      this.agent.setPoolAddress(pool.lbPair.publicKey);
      this.agent.setStrategy(strategyType);
      this.agent.setBinRange(binRange);
      
      // Get active bin
      const activeBin = await pool.getActiveBin();
      logger.info(`Active bin: ${activeBin.binId}, Price: ${activeBin.price}`);
      
      // Calculate bin range
      const minBinId = activeBin.binId - binRange;
      const maxBinId = activeBin.binId + binRange;
      
      logger.info(`Using bin range: ${minBinId} to ${maxBinId}`);
      
      // Execute the transaction to add liquidity
      const txSignature = await this.agent.addLiquidity(amountX, amountY);
      logger.info(`Added liquidity successfully: ${txSignature}`);
      
    } catch (error) {
      logger.error('Error adding liquidity to pool:', error);
    }
  }
  
  /**
   * Rebalance pools based on strategy recommendations
   */
  private async rebalancePools(): Promise<void> {
    try {
      logger.info('Rebalancing pools based on strategy recommendations');
      
      // Get new recommended allocations
      const newAllocations = await this.strategy.getRecommendedAllocations();
      
      // Get current allocations from the strategy
      const currentPools = [...this.strategy.getCurrentAllocations().values()];
      
      // For each current pool, check if it's still recommended
      for (const currentPool of currentPools) {
        const poolAddress = currentPool.poolAddress;
        const isStillRecommended = newAllocations.some(allocation => 
          allocation.tokenA.mint === currentPool.tokenA.mint && 
          allocation.tokenB.mint === currentPool.tokenB.mint);
          
        if (!isStillRecommended) {
          // Remove liquidity from this pool
          logger.info(`Removing liquidity from pool ${poolAddress} (${currentPool.tokenA.symbol}/${currentPool.tokenB.symbol})`);
          
          try {
            this.agent.setPoolAddress(new PublicKey(poolAddress));
            await this.agent.removeLiquidity(currentPool.positionId);
            this.strategy.removeAllocation(poolAddress);
            logger.info(`Successfully removed liquidity from pool ${poolAddress}`);
          } catch (error) {
            logger.error(`Error removing liquidity from pool ${poolAddress}:`, error);
          }
        }
      }
      
      // For each new allocation, add or adjust liquidity
      for (const allocation of newAllocations) {
        const existingPool = currentPools.find(pool => 
          pool.tokenA.mint === allocation.tokenA.mint && 
          pool.tokenB.mint === allocation.tokenB.mint);
          
        if (existingPool) {
          // Adjust existing position if needed
          logger.info(`Adjusting liquidity in ${allocation.tokenA.symbol}/${allocation.tokenB.symbol} pool`);
          logger.info(`Strategy: ${allocation.strategy}, Bin range: ${allocation.maxBinRange}`);
          
          try {
            this.agent.setPoolAddress(new PublicKey(existingPool.poolAddress));
            this.agent.setStrategy(allocation.strategy);
            this.agent.setBinRange(allocation.maxBinRange);
            
            // Check if rebalance is needed based on price movement
            if (await this.agent.shouldRebalance()) {
              await this.agent.rebalance();
              logger.info(`Successfully rebalanced position in ${existingPool.poolAddress}`);
            } else {
              logger.info(`No rebalance needed for ${existingPool.poolAddress}`);
            }
          } catch (error) {
            logger.error(`Error adjusting position in pool ${existingPool.poolAddress}:`, error);
          }
        } else {
          // Create new pool and position
          logger.info(`Creating new position for ${allocation.tokenA.symbol}/${allocation.tokenB.symbol}`);
          
          try {
            // Create the pool if it doesn't exist
            const pool = await this.findOrCreatePool(
              new PublicKey(allocation.tokenA.mint),
              new PublicKey(allocation.tokenB.mint),
              allocation.binStep,
              allocation.baseFee
            );
            
            if (pool) {
              // Add liquidity
              await this.addLiquidityToPool(
                pool,
                allocation.tokenA.amount,
                allocation.tokenB.amount,
                allocation.strategy,
                allocation.maxBinRange
              );
              
              // Update allocations
              this.strategy.updateAllocations(
                pool.lbPair.publicKey.toString(),
                allocation.tokenA.mint,
                allocation.tokenA.amount,
                allocation.tokenA.symbol,
                allocation.tokenB.mint,
                allocation.tokenB.amount,
                allocation.tokenB.symbol,
                allocation.strategy,
                allocation.binStep,
                allocation.baseFee,
                allocation.maxBinRange
              );
            }
          } catch (error) {
            logger.error(`Error creating new position for ${allocation.tokenA.symbol}/${allocation.tokenB.symbol}:`, error);
          }
        }
      }
      
      // Update last rebalance check time
      this.lastRebalanceCheck = Date.now();
      
    } catch (error) {
      logger.error('Error rebalancing pools:', error);
    }
  }
  
  /**
   * Collect and compound fees from all pools
   */
  private async collectAndCompoundFees(): Promise<void> {
    try {
      logger.info('Collecting fees from all pools');
      
      // Get current allocations from the strategy
      const currentPools = [...this.strategy.getCurrentAllocations().values()];
      
      let totalFeesCollectedValueUsd = 0;
      
      // Iterate through all current pools
      for (const poolData of currentPools) {
        try {
          const poolAddress = poolData.poolAddress;
          logger.info(`Collecting fees from pool ${poolAddress} (${poolData.tokenA.symbol}/${poolData.tokenB.symbol})`);
          
          // Set the pool in the agent
          this.agent.setPoolAddress(new PublicKey(poolAddress));
          
          // Collect fees
          const result = await this.agent.collectFees();
          
          if (result?.feeAmountX && result?.feeAmountY) {
            // Process the collected fees
            this.strategy.processFees(
              poolAddress,
              result.feeAmountX,
              result.feeAmountY,
              poolData.tokenA.mint,
              poolData.tokenB.mint
            );
            
            // Calculate value in USD
            // (simplified, in a real implementation would use actual token prices)
            const feeValueUsd = 0; // Placeholder
            totalFeesCollectedValueUsd += feeValueUsd;
            
            logger.info(`Collected fees from pool ${poolAddress}: ${result.feeAmountX.toString()} ${poolData.tokenA.symbol}, ${result.feeAmountY.toString()} ${poolData.tokenB.symbol}`);
          }
        } catch (error) {
          logger.error(`Error collecting fees from pool ${poolData.poolAddress}:`, error);
        }
      }
      
      // Update the last fees collected time
      this.lastFeesCollected = Date.now();
      
      // Reinvest the collected fees if enough value was collected
      if (totalFeesCollectedValueUsd > 1) { // If more than $1 in fees
        logger.info(`Reinvesting collected fees worth $${totalFeesCollectedValueUsd.toFixed(2)}`);
        await this.rebalancePools(); // Rebalance to reinvest
      }
      
    } catch (error) {
      logger.error('Error collecting and compounding fees:', error);
    }
  }
  
}

export default MicroPortfolioAgent;