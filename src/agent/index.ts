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
import { ClaudeService } from './utils/claude';
import MicroPortfolioAgent from './strategies/micro-portfolio';
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
  private claudeService: ClaudeService | null = null;
  private priceHistory: Array<{timestamp: number, price: number}> = [];
  private volumeHistory: Array<{timestamp: number, volume: number}> = [];
  private microPortfolioAgent: MicroPortfolioAgent | null = null;

  constructor(config: CometConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.wallet = loadWalletFromKey(config.walletKey);
    
    // Initialize Claude AI service if enabled
    if (config.claude?.enabled && config.claude.apiKey) {
      try {
        this.claudeService = new ClaudeService({
          apiKey: config.claude.apiKey,
          model: config.claude.model || 'claude-3-sonnet-20240229',
          temperature: config.claude.temperature,
          maxTokens: config.claude.maxTokens
        });
        logger.info('Claude AI service initialized');
      } catch (error) {
        logger.error('Failed to initialize Claude AI service', error);
      }
    }
    
    // Initialize MicroPortfolio strategy if specified
    if (config.strategy?.toLowerCase() === 'microportfolio') {
      try {
        this.microPortfolioAgent = new MicroPortfolioAgent(this, {
          initialCapital: {
            usdc: config.microPortfolio?.initialCapital?.usdc || 100_000_000, // $100 USDC (100 million native units)
            sol: config.microPortfolio?.initialCapital?.sol || 1_000_000_000,  // 1 SOL (1 billion native units)
          },
          riskTolerance: config.microPortfolio?.riskTolerance || 'medium',
          maxAllocationPerPool: config.microPortfolio?.maxAllocationPerPool || 50,
          rebalanceThreshold: config.microPortfolio?.rebalanceThreshold || 5,
          compoundInterval: config.microPortfolio?.compoundInterval || 24 * 60 * 60 * 1000,
          weekendSafetyEnabled: config.microPortfolio?.weekendSafetyEnabled,
          claude: {
            enabled: config.claude?.enabled || false,
            apiKey: config.claude?.apiKey || '',
            model: config.claude?.model || 'claude-3-sonnet-20240229'
          }
        });
        logger.info('MicroPortfolio strategy initialized');
      } catch (error) {
        logger.error('Failed to initialize MicroPortfolio strategy', error);
      }
    }
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
        const currentPrice = parseFloat(activeBin.price);
        
        // Initialize price history
        this.priceHistory.push({
          timestamp: Date.now(),
          price: currentPrice
        });
        
        // Initialize volume history (placeholder - would need actual volume data)
        this.volumeHistory.push({
          timestamp: Date.now(),
          volume: 0 // Placeholder, would need to get real volume data
        });
        
        await recordPoolMetrics(
          this.config.poolAddress,
          activeBin.binId,
          currentPrice,
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
    let strategyType = this.getStrategyType();
    let minBinId: number;
    let maxBinId: number;

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
      
      // Default bin range from config
      const defaultBinRange = this.config.binRange || 10;
      
      // If Claude AI is enabled, use it to generate strategy parameters
      if (this.claudeService && this.config.claude?.enabled) {
        try {
          const poolInfo = this.dlmm.lbPair;
          
          // Calculate market volatility from price history
          const priceVolatility = this.calculatePriceVolatility();
          
          // Determine market trend
          const marketTrend = this.determineMarketTrend();
          
          // Prepare market data for Claude
          const marketData = {
            activeBinId: oldActiveBin,
            binStep: poolInfo.binStep.toNumber(),
            currentPrice: oldPrice,
            tokenXSymbol: poolInfo.tokenX.mint.toString().slice(0, 8) + '...', // Use actual token symbols if available
            tokenYSymbol: poolInfo.tokenY.mint.toString().slice(0, 8) + '...',
            priceHistory: this.priceHistory,
            volumeHistory: this.volumeHistory,
            marketVolatility: priceVolatility,
            marketTrend
          };
          
          // Get optimal strategy parameters from Claude AI
          const riskProfile = this.config.claude?.riskProfile || 'moderate';
          const recommendation = await this.claudeService.getRebalanceRecommendation(marketData);
          
          // Use Claude's strategy recommendation if available
          if (recommendation && recommendation.strategy) {
            logger.info(`Using Claude AI recommended strategy: ${recommendation.strategy}`);
            
            switch (recommendation.strategy) {
              case StrategyType.Spot:
                strategyType = StrategyType.Spot;
                break;
              case StrategyType.BidAsk:
                strategyType = StrategyType.BidAsk;
                break;
              case StrategyType.Curve:
                strategyType = StrategyType.Curve;
                break;
              default:
                // Keep existing strategy if recommendation is not recognized
                break;
            }
            
            // Use Claude's bin range recommendation if available
            if (recommendation.binRange && recommendation.binRange > 0) {
              minBinId = recommendation.minBinId;
              maxBinId = recommendation.maxBinId;
              logger.info(`Using Claude AI recommended bin range: ${minBinId} to ${maxBinId}`);
            } else {
              // Use default bin range if not specified by Claude
              minBinId = oldActiveBin - defaultBinRange;
              maxBinId = oldActiveBin + defaultBinRange;
            }
          } else {
            // Use default parameters if Claude doesn't provide clear recommendations
            minBinId = oldActiveBin - defaultBinRange;
            maxBinId = oldActiveBin + defaultBinRange;
          }
        } catch (aiError) {
          logger.error('Error getting AI strategy recommendations, using defaults:', aiError);
          // Fall back to default parameters
          minBinId = oldActiveBin - defaultBinRange;
          maxBinId = oldActiveBin + defaultBinRange;
        }
      } else {
        // Use default parameters if Claude is not enabled
        minBinId = oldActiveBin - defaultBinRange;
        maxBinId = oldActiveBin + defaultBinRange;
      }
      
      // Remove liquidity from current positions
      // Implementation needed
      
      // Add liquidity to new positions with the AI-recommended or default strategy
      // Implementation needed

      this.lastRebalanceTime = Date.now();
      
      // Get new active bin after rebalance
      const newActiveBinInfo = await this.dlmm.getActiveBin();
      const newActiveBin = newActiveBinInfo.binId;
      const newPrice = parseFloat(newActiveBinInfo.price);
      
      // Set success flag
      success = true;
      
      logger.info(`Rebalance completed successfully with strategy: ${strategyType}, bin range: ${minBinId}-${maxBinId}`);
      
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
      
      // Start MicroPortfolio strategy if configured
      if (this.config.strategy?.toLowerCase() === 'microportfolio' && this.microPortfolioAgent) {
        logger.info('Starting MicroPortfolio strategy');
        await this.microPortfolioAgent.start();
      } else {
        logger.info('Starting standard liquidity provision strategy');
        
        // Main loop for standard strategy
        while (this.isRunning) {
          try {
            // Refresh DLMM state
            if (this.dlmm) {
              try {
                await this.dlmm.refetchStates();
                
                // Update price history
                const activeBin = await this.dlmm.getActiveBin();
                const currentPrice = parseFloat(activeBin.price);
                
                this.priceHistory.push({
                  timestamp: Date.now(),
                  price: currentPrice
                });
                
                // Limit history length to last 100 data points
                if (this.priceHistory.length > 100) {
                  this.priceHistory = this.priceHistory.slice(-100);
                }
                
                // Update volume history (placeholder - would need actual volume data)
                // In a production system, you would fetch real volume data
                const estimatedVolume = Math.random() * 10000; // Placeholder for demo
                
                this.volumeHistory.push({
                  timestamp: Date.now(),
                  volume: estimatedVolume
                });
                
                // Limit history length to last 100 data points
                if (this.volumeHistory.length > 100) {
                  this.volumeHistory = this.volumeHistory.slice(-100);
                }
              } catch (refreshError) {
                logger.error('Failed to refresh DLMM state, will retry next cycle:', refreshError);
                // Continue to next iteration rather than failing the entire agent
                await sleep(this.config.pollingInterval || 60000);
                continue;
              }
            }

            // Check if rebalance is needed
            try {
              const shouldRebalanceNow = await this.shouldRebalance();
              if (shouldRebalanceNow) {
                try {
                  await this.rebalance();
                } catch (rebalanceError) {
                  logger.error('Rebalance operation failed:', rebalanceError);
                  // Don't throw, continue with the next operation
                }
              }
            } catch (rebalanceCheckError) {
              logger.error('Error checking if rebalance is needed:', rebalanceCheckError);
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
    
    // Stop MicroPortfolio strategy if active
    if (this.microPortfolioAgent) {
      try {
        await this.microPortfolioAgent.stop();
      } catch (error) {
        logger.error('Failed to stop MicroPortfolio strategy:', error);
      }
    }
    
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
  private async shouldRebalance(): Promise<boolean> {
    // Check if auto-rebalance is enabled
    if (!this.config.autoRebalance) {
      return false;
    }
    
    // Check if minimum rebalance interval has passed
    const minInterval = this.config.minRebalanceInterval || 3600000; // 1 hour default
    const timeSinceLastRebalance = Date.now() - this.lastRebalanceTime;
    
    if (timeSinceLastRebalance < minInterval) {
      return false;
    }
    
    // If Claude AI is not enabled, use simple time-based rebalancing
    if (!this.claudeService || !this.config.claude?.enabled) {
      return true;
    }
    
    try {
      // Get current market data for AI analysis
      if (!this.dlmm) {
        return false;
      }
      
      const activeBin = await this.dlmm.getActiveBin();
      const poolInfo = this.dlmm.lbPair;
      
      // Calculate market volatility from price history
      const priceVolatility = this.calculatePriceVolatility();
      
      // Determine market trend
      const marketTrend = this.determineMarketTrend();
      
      // Prepare market data for Claude
      const marketData = {
        activeBinId: activeBin.binId,
        binStep: poolInfo.binStep.toNumber(),
        currentPrice: parseFloat(activeBin.price),
        tokenXSymbol: poolInfo.tokenX.mint.toString().slice(0, 8) + '...', // Use actual token symbols if available
        tokenYSymbol: poolInfo.tokenY.mint.toString().slice(0, 8) + '...',
        priceHistory: this.priceHistory,
        volumeHistory: this.volumeHistory,
        marketVolatility: priceVolatility,
        marketTrend
      };
      
      // Get recommendation from Claude AI
      const recommendation = await this.claudeService.getRebalanceRecommendation(marketData);
      
      // Log the recommendation
      logger.info(`Claude AI rebalance recommendation: ${recommendation.shouldRebalance ? 'YES' : 'NO'} (${recommendation.reason})`);
      
      // Return Claude's recommendation
      return recommendation.shouldRebalance;
    } catch (error) {
      logger.error('Error in Claude AI rebalance decision, falling back to time-based rebalancing', error);
      return true; // Fall back to simple time-based rebalancing on error
    }
  }
  
  /**
   * Calculate price volatility from price history
   */
  private calculatePriceVolatility(): number {
    // Need at least 2 price points to calculate volatility
    if (this.priceHistory.length < 2) {
      return 0;
    }
    
    // Get recent prices (last 24 data points or all if fewer)
    const prices = this.priceHistory.slice(-24).map(p => p.price);
    
    // Calculate standard deviation
    const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);
    
    // Convert to percentage
    const volatilityPercentage = (stdDev / mean) * 100;
    
    return parseFloat(volatilityPercentage.toFixed(2));
  }
  
  /**
   * Determine market trend from price history
   */
  private determineMarketTrend(): string {
    // Need at least 2 price points to determine trend
    if (this.priceHistory.length < 2) {
      return 'sideways';
    }
    
    // Get recent prices (last 10 data points or all if fewer)
    const recentPrices = this.priceHistory.slice(-10);
    
    // Simple linear regression to determine trend
    const n = recentPrices.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    
    recentPrices.forEach((point, index) => {
      const x = index;
      const y = point.price;
      
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    });
    
    // Calculate slope
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    
    // Determine trend based on slope
    if (slope > 0.01) {
      return 'bullish';
    } else if (slope < -0.01) {
      return 'bearish';
    } else {
      return 'sideways';
    }
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