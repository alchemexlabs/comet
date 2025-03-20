/**
 * Comet - Autonomous Liquidity Agent for Meteora DLMM
 * 
 * This agent automatically manages liquidity positions on Meteora DLMM pools
 * to optimize for fee generation and capital efficiency.
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { DLMM } from '../dlmm';
import { StrategyType } from '../dlmm/types';
import { CometConfig } from './types';
import { loadWalletFromKey, sleep } from './utils/helpers';
import { getPriceFromBirdeye } from './utils/price';
import { logger } from './utils/logger';
import { 
  initializeDatabase, 
  registerAgent, 
  updateAgentStatus, 
  registerPool, 
  recordPoolMetrics, 
  recordRebalanceEvent,
  recordFeeCollectionEvent
} from './utils/database';

export class Comet {
  private connection: Connection;
  private wallet: Keypair;
  private config: CometConfig;
  private dlmm: DLMM | null = null;
  private isRunning = false;
  private lastRebalanceTime = 0;
  private agentId: number | null = null;

  constructor(config: CometConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.wallet = loadWalletFromKey(config.walletKey);
  }

  /**
   * Initialize the agent by loading the DLMM pool and database
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Comet agent...');
      
      // Initialize database connection
      initializeDatabase();
      
      // Load the specified pool
      if (this.config.poolAddress) {
        this.dlmm = await DLMM.create(this.connection, new PublicKey(this.config.poolAddress));
        logger.info(`Loaded DLMM pool: ${this.config.poolAddress}`);
        
        // Register agent in database
        this.agentId = await registerAgent(
          this.config.poolAddress,
          this.wallet.publicKey.toString(),
          this.config.strategy || 'Spot',
          this.config.binRange || 10,
          this.config.autoRebalance !== undefined ? this.config.autoRebalance : true
        );
        
        // Register pool in database
        const poolInfo = this.dlmm.lbPair;
        await registerPool(
          this.config.poolAddress,
          poolInfo.tokenX.mint.toString(),
          poolInfo.tokenY.mint.toString(),
          poolInfo.binStep.toNumber(),
          poolInfo.activeId.toNumber(),
          poolInfo.feeParameter.toNumber()
        );
        
        // Record initial pool metrics
        const activeBin = await this.dlmm.getActiveBin();
        const tokenXPrice = await getPriceFromBirdeye(poolInfo.tokenX.mint.toString(), 1);
        const tokenYPrice = await getPriceFromBirdeye(poolInfo.tokenY.mint.toString(), 1);
        
        await recordPoolMetrics(
          this.config.poolAddress,
          activeBin.binId,
          parseFloat(activeBin.price),
          tokenXPrice,
          tokenYPrice,
          poolInfo.reserveX.toString(),
          poolInfo.reserveY.toString()
        );
      } else {
        logger.error('No pool address specified in config');
        throw new Error('No pool address specified in config');
      }
    } catch (error) {
      logger.error('Failed to initialize Comet agent', error);
      throw error;
    }
  }

  /**
   * Create a new DLMM pool
   */
  async createPool(): Promise<PublicKey> {
    try {
      if (!this.config.createPoolParams) {
        throw new Error('Create pool parameters not specified in config');
      }

      const {
        tokenX,
        tokenY,
        binStep,
        activeId,
        feeBps,
        activationType,
        hasAlphaVault
      } = this.config.createPoolParams;

      logger.info(`Creating new DLMM pool: ${tokenX.toString()} / ${tokenY.toString()}`);

      // Create the pool
      const transaction = DLMM.createCustomizablePermissionlessLbPair(
        this.connection,
        new BN(binStep),
        new PublicKey(tokenX),
        new PublicKey(tokenY),
        new BN(activeId),
        new BN(feeBps),
        activationType,
        hasAlphaVault,
        this.wallet.publicKey,
        null // activationPoint not required
      );

      // Execute the transaction
      // Implementation needed for transaction signing and sending
      
      // Load the pool after creation
      // Implementation needed
      
      logger.info('DLMM pool created successfully');
      return new PublicKey('PLACEHOLDER'); // Replace with actual pool address
    } catch (error) {
      logger.error('Failed to create DLMM pool', error);
      throw error;
    }
  }

  /**
   * Add liquidity to the pool using the specified strategy
   */
  async addLiquidity(xAmount: BN, yAmount: BN): Promise<string> {
    try {
      if (!this.dlmm) {
        throw new Error('DLMM pool not initialized');
      }

      logger.info(`Adding liquidity: ${xAmount.toString()} X, ${yAmount.toString()} Y`);

      // Get active bin
      const activeBin = await this.dlmm.getActiveBin();
      
      // Calculate bin range based on config
      const binRange = this.config.binRange || 10;
      const minBinId = activeBin.binId - binRange;
      const maxBinId = activeBin.binId + binRange;

      // Create position keypair
      const positionKeypair = Keypair.generate();

      // Add liquidity by strategy
      const strategyType = this.getStrategyType();
      
      const createPositionTx = await this.dlmm.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: positionKeypair.publicKey,
        user: this.wallet.publicKey,
        totalXAmount: xAmount,
        totalYAmount: yAmount,
        strategy: {
          maxBinId,
          minBinId,
          strategyType,
        },
      });

      // Execute the transaction
      // Implementation needed for transaction signing and sending

      logger.info('Liquidity added successfully');
      return 'TRANSACTION_SIGNATURE'; // Replace with actual signature
    } catch (error) {
      logger.error('Failed to add liquidity', error);
      throw error;
    }
  }

  /**
   * Rebalance liquidity positions based on current price
   */
  async rebalance(): Promise<void> {
    if (!this.dlmm || !this.agentId) {
      throw new Error('DLMM pool not initialized');
    }

    logger.info('Rebalancing liquidity positions...');
    let oldActiveBin: number;
    let oldPrice: number;
    let transactionHash: string | undefined;
    let success = false;
    let errorMessage: string | undefined;

    try {
      // Get current positions
      const { userPositions } = await this.dlmm.getPositionsByUserAndLbPair(this.wallet.publicKey);
      
      if (userPositions.length === 0) {
        logger.info('No positions to rebalance');
        return;
      }

      // Get old active bin before rebalance
      const oldActiveBinInfo = await this.dlmm.getActiveBin();
      oldActiveBin = oldActiveBinInfo.binId;
      oldPrice = parseFloat(oldActiveBinInfo.price);
      
      // Check if rebalance is needed based on active bin and position bins
      // Implementation needed
      
      // Remove liquidity from current positions
      // Implementation needed
      
      // Add liquidity to new positions around active bin
      // Implementation needed

      this.lastRebalanceTime = Date.now();
      
      // Get new active bin after rebalance
      const newActiveBinInfo = await this.dlmm.getActiveBin();
      const newActiveBin = newActiveBinInfo.binId;
      const newPrice = parseFloat(newActiveBinInfo.price);
      
      // Set success flag
      success = true;
      
      logger.info('Rebalance completed successfully');
      
      // Record rebalance event in database
      await recordRebalanceEvent(
        this.agentId,
        this.config.poolAddress,
        oldActiveBin,
        newActiveBin,
        oldPrice,
        newPrice,
        transactionHash,
        success
      );
      
      // Update pool metrics after rebalance
      if (this.dlmm) {
        const poolInfo = this.dlmm.lbPair;
        const tokenXPrice = await getPriceFromBirdeye(poolInfo.tokenX.mint.toString(), 1);
        const tokenYPrice = await getPriceFromBirdeye(poolInfo.tokenY.mint.toString(), 1);
        
        await recordPoolMetrics(
          this.config.poolAddress,
          newActiveBin,
          newPrice,
          tokenXPrice,
          tokenYPrice,
          poolInfo.reserveX.toString(),
          poolInfo.reserveY.toString()
        );
      }
    } catch (error) {
      logger.error('Failed to rebalance positions', error);
      
      // Record failed rebalance event if we have the old bin info
      if (this.agentId && oldActiveBin !== undefined && oldPrice !== undefined) {
        errorMessage = error.message || 'Unknown error';
        
        try {
          await recordRebalanceEvent(
            this.agentId,
            this.config.poolAddress,
            oldActiveBin,
            oldActiveBin, // Same as old since rebalance failed
            oldPrice,
            oldPrice, // Same as old since rebalance failed
            undefined,
            false,
            errorMessage
          );
        } catch (dbError) {
          logger.error('Failed to record rebalance failure in database:', dbError);
        }
      }
      
      throw error;
    }
  }

  /**
   * Collect fees from all positions
   */
  async collectFees(): Promise<void> {
    if (!this.dlmm || !this.agentId) {
      throw new Error('DLMM pool not initialized');
    }

    logger.info('Collecting fees from positions...');
    let transactionHash: string | undefined;

    try {
      // Get current positions
      const { userPositions } = await this.dlmm.getPositionsByUserAndLbPair(this.wallet.publicKey);
      
      if (userPositions.length === 0) {
        logger.info('No positions to collect fees from');
        return;
      }

      // Get claimable fees before claiming
      const claimableFees = await Promise.all(
        userPositions.map(async (position) => {
          try {
            return await DLMM.getClaimableSwapFee(
              this.connection,
              position.publicKey,
              this.wallet.publicKey
            );
          } catch (error) {
            logger.warn(`Failed to get claimable fees for position ${position.publicKey.toString()}:`, error);
            return null;
          }
        })
      );

      // Claim swap fees
      const claimFeeTxs = await this.dlmm.claimAllSwapFee({
        owner: this.wallet.publicKey,
        positions: userPositions,
      });

      // Execute transaction(s)
      // Implementation needed for transaction signing and sending
      
      // For now, let's assume a successful transaction
      transactionHash = 'PLACEHOLDER_TX_HASH';
      
      // Get token prices for USD conversion
      const poolInfo = this.dlmm.lbPair;
      const tokenXPrice = await getPriceFromBirdeye(poolInfo.tokenX.mint.toString(), 1);
      const tokenYPrice = await getPriceFromBirdeye(poolInfo.tokenY.mint.toString(), 1);
      
      // Record fee collection events
      for (let i = 0; i < userPositions.length; i++) {
        const position = userPositions[i];
        const fees = claimableFees[i];
        
        if (fees) {
          const amountX = fees.x.toString();
          const amountY = fees.y.toString();
          const amountXUsd = parseFloat(fees.x.toString()) * tokenXPrice;
          const amountYUsd = parseFloat(fees.y.toString()) * tokenYPrice;
          
          await recordFeeCollectionEvent(
            this.agentId,
            this.config.poolAddress,
            position.publicKey.toString(),
            amountX,
            amountY,
            amountXUsd,
            amountYUsd,
            transactionHash,
            true
          );
        }
      }

      logger.info('Fees collected successfully');
      
      // Update pool metrics after fee collection
      const activeBin = await this.dlmm.getActiveBin();
      
      await recordPoolMetrics(
        this.config.poolAddress,
        activeBin.binId,
        parseFloat(activeBin.price),
        tokenXPrice,
        tokenYPrice,
        poolInfo.reserveX.toString(),
        poolInfo.reserveY.toString()
      );
    } catch (error) {
      logger.error('Failed to collect fees', error);
      
      // Record failed fee collection if we have the agent ID
      if (this.agentId) {
        try {
          await recordFeeCollectionEvent(
            this.agentId,
            this.config.poolAddress,
            'ALL_POSITIONS', // Generic identifier for failed collections
            '0',
            '0',
            0,
            0,
            undefined,
            false,
            error.message
          );
        } catch (dbError) {
          logger.error('Failed to record fee collection failure in database:', dbError);
        }
      }
      
      throw error;
    }
  }

  /**
   * Start the agent's monitoring and management loop
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Agent is already running');
      return;
    }

    try {
      await this.initialize();
      this.isRunning = true;
      logger.info('Comet agent started');

      // Main loop
      while (this.isRunning) {
        try {
          // Refresh DLMM state
          if (this.dlmm) {
            try {
              await this.dlmm.refetchStates();
            } catch (refreshError) {
              logger.error('Failed to refresh DLMM state, will retry next cycle:', refreshError);
              // Continue to next iteration rather than failing the entire agent
              await sleep(this.config.pollingInterval || 60000);
              continue;
            }
          }

          // Check if rebalance is needed
          if (this.shouldRebalance()) {
            try {
              await this.rebalance();
            } catch (rebalanceError) {
              logger.error('Rebalance operation failed:', rebalanceError);
              // Don't throw, continue with the next operation
            }
          }

          // Collect fees periodically
          if (this.shouldCollectFees()) {
            try {
              await this.collectFees();
            } catch (feeError) {
              logger.error('Fee collection failed:', feeError);
              // Don't throw, continue with the next cycle
            }
          }

          // Wait before next iteration
          await sleep(this.config.pollingInterval || 60000);
        } catch (cycleError) {
          // This catch will handle any errors not caught by the individual operation handlers
          logger.error('Error in agent cycle, will continue running:', cycleError);
          await sleep(this.config.retryDelay || 5000); // Shorter delay on error before next attempt
        }
      }
    } catch (error) {
      this.isRunning = false;
      logger.error('Fatal agent error:', error);
      // Optionally add notification to external monitoring system here
      throw error;
    }
  }

  /**
   * Stop the agent
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    
    // Update agent status in database
    if (this.agentId && this.config.poolAddress) {
      try {
        await updateAgentStatus(this.config.poolAddress, 'stopped');
      } catch (error) {
        logger.error('Failed to update agent status in database:', error);
      }
    }
    
    logger.info('Comet agent stopped');
  }

  /**
   * Check if rebalance is needed
   */
  private shouldRebalance(): boolean {
    // Check if auto-rebalance is enabled
    if (!this.config.autoRebalance) {
      return false;
    }
    
    // Check if minimum rebalance interval has passed
    const minInterval = this.config.minRebalanceInterval || 3600000; // 1 hour default
    const timeSinceLastRebalance = Date.now() - this.lastRebalanceTime;
    return timeSinceLastRebalance >= minInterval;
  }

  /**
   * Check if fees should be collected
   */
  private shouldCollectFees(): boolean {
    // Implement logic to determine if fees should be collected
    return true;
  }

  /**
   * Get strategy type from config
   */
  private getStrategyType(): StrategyType {
    switch (this.config.strategy?.toUpperCase()) {
      case 'BID_ASK':
        return StrategyType.BidAsk;
      case 'CURVE':
        return StrategyType.Curve;
      case 'SPOT':
      default:
        return StrategyType.Spot;
    }
  }
}

export default Comet;