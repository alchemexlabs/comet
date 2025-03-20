/**
 * Micro Portfolio Strategy for Comet Agent
 * 
 * This strategy is optimized for growing a small portfolio ($100 USDC + 1 SOL)
 * through intelligent liquidity provision in Meteora DLMM pools.
 */

import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { StrategyType } from '../../../dlmm/types';
import { logger } from '../logger';
import { getPriceFromBirdeye } from '../price';
import { ClaudeService } from '../claude';

// Strategy configuration interface
export interface MicroPortfolioConfig {
  initialCapital: {
    usdc: number;  // Amount in USDC (in native units, e.g., 100 USDC = 100_000_000)
    sol: number;   // Amount in SOL (in native units, e.g., 1 SOL = 1_000_000_000)
  };
  riskTolerance: 'low' | 'medium' | 'high';
  usdcMint: string;
  solMint: string;
  maxAllocationPerPool: number; // Max percentage of portfolio to allocate to a single pool (0-100)
  rebalanceThreshold: number;   // Percentage price change that triggers rebalance (0-100)
  compoundInterval: number;     // Time in ms between compounding fees
  weekendSafetyEnabled: boolean; // Whether to enable weekend safety mode
  claude: {
    enabled: boolean;
    apiKey: string;
    model: string;
  };
}

// Pool allocation interface
interface PoolAllocation {
  tokenA: {
    mint: string;
    symbol: string;
    amount: BN;
  };
  tokenB: {
    mint: string;
    symbol: string;
    amount: BN;
  };
  strategy: StrategyType;
  binStep: number;
  baseFee: number;
  maxBinRange: number;
}

// Market data interface for analysis
interface TokenMarketData {
  symbol: string;
  mint: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  topHoldersPercentage?: number;
  volatility?: number;
}

/**
 * Micro Portfolio Strategy Manager
 */
export class MicroPortfolioStrategy {
  private config: MicroPortfolioConfig;
  private claudeService: ClaudeService | null = null;
  private currentAllocations: Map<string, PoolAllocation> = new Map();
  private portfolio = {
    usdc: new BN(0),
    sol: new BN(0),
    totalValueUsd: 0,
    lastUpdated: 0
  };
  private isWeekend: boolean = false;
  private tokenData: Map<string, TokenMarketData> = new Map();
  
  constructor(config: MicroPortfolioConfig) {
    this.config = config;
    
    // Initialize portfolio with starting capital
    this.portfolio.usdc = new BN(config.initialCapital.usdc);
    this.portfolio.sol = new BN(config.initialCapital.sol);
    
    // Initialize Claude service if enabled
    if (config.claude?.enabled && config.claude.apiKey) {
      this.claudeService = new ClaudeService({
        apiKey: config.claude.apiKey,
        model: config.claude.model || 'claude-3-sonnet-20240229'
      });
      logger.info('Claude AI enabled for MicroPortfolio strategy');
    }
    
    // Check if current day is weekend
    this.updateWeekendStatus();
    
    // Log initialization
    logger.info(`MicroPortfolio strategy initialized with ${config.initialCapital.usdc / 1e6} USDC and ${config.initialCapital.sol / 1e9} SOL`);
    logger.info(`Risk tolerance: ${config.riskTolerance}, Max allocation per pool: ${config.maxAllocationPerPool}%`);
  }
  
  /**
   * Update portfolio value based on current token prices
   */
  async updatePortfolioValue(): Promise<void> {
    try {
      // Get current token prices
      const usdcPrice = 1.0; // USDC is pegged to USD
      const solPrice = await getPriceFromBirdeye(this.config.solMint, 1);
      
      // Calculate portfolio value
      const usdcValueUsd = Number(this.portfolio.usdc.toString()) / 1e6 * usdcPrice;
      const solValueUsd = Number(this.portfolio.sol.toString()) / 1e9 * solPrice;
      
      // Add value of allocated tokens in pools
      let poolsValueUsd = 0;
      for (const [_, allocation] of this.currentAllocations) {
        const tokenAPrice = await this.getTokenPrice(allocation.tokenA.mint);
        const tokenBPrice = await this.getTokenPrice(allocation.tokenB.mint);
        
        const tokenAValueUsd = Number(allocation.tokenA.amount.toString()) * tokenAPrice;
        const tokenBValueUsd = Number(allocation.tokenB.amount.toString()) * tokenBPrice;
        
        poolsValueUsd += tokenAValueUsd + tokenBValueUsd;
      }
      
      // Update portfolio total value
      this.portfolio.totalValueUsd = usdcValueUsd + solValueUsd + poolsValueUsd;
      this.portfolio.lastUpdated = Date.now();
      
      logger.info(`Portfolio value updated: $${this.portfolio.totalValueUsd.toFixed(2)}`);
      logger.info(`USDC: ${usdcValueUsd.toFixed(2)}, SOL: ${solValueUsd.toFixed(2)}, Pools: ${poolsValueUsd.toFixed(2)}`);
    } catch (error) {
      logger.error('Failed to update portfolio value:', error);
    }
  }
  
  /**
   * Get recommended pool allocations based on current market conditions
   */
  async getRecommendedAllocations(): Promise<PoolAllocation[]> {
    // Update weekend status
    this.updateWeekendStatus();
    
    // If it's weekend and weekend safety is enabled, recommend SOL/USDC only
    if (this.isWeekend && this.config.weekendSafetyEnabled) {
      logger.info('Weekend safety mode enabled, recommending SOL/USDC allocation only');
      return this.getWeekendSafeAllocations();
    }
    
    // If Claude AI is enabled, use it for recommendations
    if (this.claudeService) {
      try {
        return await this.getClaudeRecommendedAllocations();
      } catch (error) {
        logger.error('Claude AI allocation recommendation failed, using fallback:', error);
        return this.getFallbackAllocations();
      }
    }
    
    // Otherwise use basic allocation strategy based on risk tolerance
    return this.getBasicAllocations();
  }
  
  /**
   * Get weekend-safe allocations (SOL/USDC only)
   */
  private getWeekendSafeAllocations(): PoolAllocation[] {
    // Calculate amounts to allocate based on available portfolio
    const usdcAmount = this.portfolio.usdc.muln(80).divn(100); // 80% of available USDC
    const solAmount = this.portfolio.sol.muln(80).divn(100);   // 80% of available SOL
    
    // Create allocation for SOL/USDC
    return [{
      tokenA: {
        mint: this.config.solMint,
        symbol: 'SOL',
        amount: solAmount
      },
      tokenB: {
        mint: this.config.usdcMint,
        symbol: 'USDC',
        amount: usdcAmount
      },
      strategy: StrategyType.Spot,
      binStep: 10,
      baseFee: 1, // 0.01%
      maxBinRange: 10
    }];
  }
  
  /**
   * Get basic allocations based on risk tolerance without AI
   */
  private getBasicAllocations(): PoolAllocation[] {
    const allocations: PoolAllocation[] = [];
    
    // SOL/USDC allocation is always included as the base pair
    const solUsdcAllocation: PoolAllocation = {
      tokenA: {
        mint: this.config.solMint,
        symbol: 'SOL',
        amount: new BN(0) // Will be calculated below
      },
      tokenB: {
        mint: this.config.usdcMint,
        symbol: 'USDC',
        amount: new BN(0) // Will be calculated below
      },
      strategy: StrategyType.Spot,
      binStep: 10,
      baseFee: 1, // 0.01%
      maxBinRange: 10
    };
    
    // Allocate amounts based on risk tolerance
    switch (this.config.riskTolerance) {
      case 'low':
        // Low risk: 80% SOL/USDC, 20% reserved
        solUsdcAllocation.tokenA.amount = this.portfolio.sol.muln(80).divn(100);
        solUsdcAllocation.tokenB.amount = this.portfolio.usdc.muln(80).divn(100);
        break;
        
      case 'medium':
        // Medium risk: 60% SOL/USDC, 40% for other opportunities
        solUsdcAllocation.tokenA.amount = this.portfolio.sol.muln(60).divn(100);
        solUsdcAllocation.tokenB.amount = this.portfolio.usdc.muln(60).divn(100);
        
        // TODO: Add logic to find and allocate to a medium-risk token pair
        break;
        
      case 'high':
        // High risk: 40% SOL/USDC, 60% for other opportunities
        solUsdcAllocation.tokenA.amount = this.portfolio.sol.muln(40).divn(100);
        solUsdcAllocation.tokenB.amount = this.portfolio.usdc.muln(40).divn(100);
        
        // TODO: Add logic to find and allocate to higher-risk token pairs
        break;
    }
    
    // Add SOL/USDC allocation
    allocations.push(solUsdcAllocation);
    
    return allocations;
  }
  
  /**
   * Get allocations recommended by Claude AI
   */
  private async getClaudeRecommendedAllocations(): Promise<PoolAllocation[]> {
    if (!this.claudeService) {
      throw new Error('Claude service not initialized');
    }
    
    // Get market data for tokens of interest
    const marketData = await this.getMarketDataForAnalysis();
    
    // Prepare prompt context for Claude
    const prompt = this.buildAllocationPrompt(marketData);
    
    // Request recommendation from Claude
    const response = await this.claudeService.generateStrategyParameters(
      StrategyType.Spot, // Default strategy type, Claude will recommend changes
      {
        activeBinId: 0,
        binStep: 10,
        currentPrice: 0,
        tokenXSymbol: 'PORTFOLIO',
        tokenYSymbol: 'STRATEGY',
        priceHistory: [],
        volumeHistory: [],
        marketVolatility: 0,
        marketTrend: 'analyzing'
      },
      this.config.riskTolerance
    );
    
    // TODO: Parse Claude's response and convert to PoolAllocation objects
    // For now, return basic allocations
    return this.getBasicAllocations();
  }
  
  /**
   * Build prompt for Claude to recommend allocations
   */
  private buildAllocationPrompt(marketData: TokenMarketData[]): string {
    return `
I need recommendations for allocating a small portfolio in Meteora DLMM pools.

## Current Portfolio
- USDC: ${Number(this.portfolio.usdc.toString()) / 1e6} (${this.portfolio.usdc.toString()} native units)
- SOL: ${Number(this.portfolio.sol.toString()) / 1e9} (${this.portfolio.sol.toString()} native units)
- Total Value: $${this.portfolio.totalValueUsd.toFixed(2)}
- Risk Tolerance: ${this.config.riskTolerance}
- Weekend Mode: ${this.isWeekend ? 'Active' : 'Inactive'}

## Market Data
${marketData.map(token => `
- ${token.symbol} (${token.mint})
  - Price: $${token.price.toFixed(6)}
  - 24h Change: ${token.priceChange24h.toFixed(2)}%
  - 24h Volume: $${token.volume24h.toFixed(2)}
  - Top Holders %: ${token.topHoldersPercentage || 'Unknown'}
  - Volatility: ${token.volatility || 'Unknown'}
`).join('')}

Based on this information, please recommend optimal allocations for DLMM pools that maximize fee generation while respecting:
1. Maximum allocation per pool: ${this.config.maxAllocationPerPool}% of portfolio
2. Risk tolerance profile: ${this.config.riskTolerance}
3. Weekend safety mode: ${this.config.weekendSafetyEnabled ? 'Enabled' : 'Disabled'}

For each pool recommendation, specify:
- Token pair
- Amount of each token to allocate
- Strategy (Spot, BidAsk, Curve)
- Bin step size
- Base fee percentage
- Maximum bin range
`;
  }
  
  /**
   * Get fallback allocations when AI recommendations fail
   */
  private getFallbackAllocations(): PoolAllocation[] {
    logger.warn('Using fallback allocations strategy');
    return this.getBasicAllocations();
  }
  
  /**
   * Get market data for tokens of interest
   */
  private async getMarketDataForAnalysis(): Promise<TokenMarketData[]> {
    const tokenList: TokenMarketData[] = [];
    
    try {
      // Get data for SOL
      const solPrice = await getPriceFromBirdeye(this.config.solMint, 1);
      // In a real implementation, get more data from Birdeye API or other sources
      tokenList.push({
        symbol: 'SOL',
        mint: this.config.solMint,
        price: solPrice,
        priceChange24h: 0, // Placeholder
        volume24h: 0,      // Placeholder
      });
      
      // Get data for USDC
      tokenList.push({
        symbol: 'USDC',
        mint: this.config.usdcMint,
        price: 1.0,
        priceChange24h: 0,
        volume24h: 0,
      });
      
      // TODO: Add logic to fetch data for more tokens
      
    } catch (error) {
      logger.error('Failed to get market data for analysis:', error);
    }
    
    return tokenList;
  }
  
  /**
   * Check if current day is weekend and update status
   */
  private updateWeekendStatus(): void {
    const now = new Date();
    const day = now.getDay();
    this.isWeekend = day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
    
    if (this.isWeekend && this.config.weekendSafetyEnabled) {
      logger.info('Weekend detected, safety mode will be applied to allocations');
    }
  }
  
  /**
   * Get the price of a token (cached or from API)
   */
  private async getTokenPrice(mint: string): Promise<number> {
    try {
      // Check if we have cached data and if it's recent (within last 5 minutes)
      const cachedData = this.tokenData.get(mint);
      if (cachedData && (Date.now() - this.portfolio.lastUpdated < 5 * 60 * 1000)) {
        return cachedData.price;
      }
      
      // If not cached or data is stale, fetch from API
      if (mint === this.config.usdcMint) {
        return 1.0; // USDC is pegged to USD
      } else {
        const price = await getPriceFromBirdeye(mint, 1);
        
        // Update cache
        if (cachedData) {
          cachedData.price = price;
          this.tokenData.set(mint, cachedData);
        } else {
          this.tokenData.set(mint, {
            symbol: 'UNKNOWN', // Could be updated with a token registry lookup
            mint,
            price,
            priceChange24h: 0,
            volume24h: 0
          });
        }
        
        return price;
      }
    } catch (error) {
      logger.error(`Failed to get price for token ${mint}:`, error);
      return 0;
    }
  }
  
  /**
   * Check if rebalance is needed based on price changes
   */
  async shouldRebalance(): Promise<boolean> {
    try {
      // Always rebalance if weekend status has changed
      const wasWeekend = this.isWeekend;
      this.updateWeekendStatus();
      
      if (wasWeekend !== this.isWeekend) {
        logger.info(`Weekend status changed from ${wasWeekend} to ${this.isWeekend}, rebalance needed`);
        return true;
      }
      
      // Check price deviations for tokens in current allocations
      for (const [_, allocation] of this.currentAllocations) {
        const tokenAMint = allocation.tokenA.mint;
        const tokenBMint = allocation.tokenB.mint;
        
        // Get current prices
        const tokenAPrice = await this.getTokenPrice(tokenAMint);
        const tokenBPrice = await this.getTokenPrice(tokenBMint);
        
        // Check if we have previous price data
        const tokenAData = this.tokenData.get(tokenAMint);
        const tokenBData = this.tokenData.get(tokenBMint);
        
        if (tokenAData) {
          const priceChange = Math.abs((tokenAPrice - tokenAData.price) / tokenAData.price * 100);
          if (priceChange > this.config.rebalanceThreshold) {
            logger.info(`Token ${tokenAData.symbol} price changed by ${priceChange.toFixed(2)}%, rebalance needed`);
            return true;
          }
        }
        
        if (tokenBData) {
          const priceChange = Math.abs((tokenBPrice - tokenBData.price) / tokenBData.price * 100);
          if (priceChange > this.config.rebalanceThreshold) {
            logger.info(`Token ${tokenBData.symbol} price changed by ${priceChange.toFixed(2)}%, rebalance needed`);
            return true;
          }
        }
      }
      
      return false;
    } catch (error) {
      logger.error('Error checking if rebalance is needed:', error);
      return false;
    }
  }
  
  /**
   * Update current allocations when a new pool is created
   */
  updateAllocations(
    poolAddress: string,
    tokenAMint: string,
    tokenAAmount: BN,
    tokenASymbol: string,
    tokenBMint: string,
    tokenBAmount: BN,
    tokenBSymbol: string,
    strategy: StrategyType,
    binStep: number,
    baseFee: number,
    maxBinRange: number
  ): void {
    this.currentAllocations.set(poolAddress, {
      tokenA: {
        mint: tokenAMint,
        amount: tokenAAmount,
        symbol: tokenASymbol
      },
      tokenB: {
        mint: tokenBMint,
        amount: tokenBAmount,
        symbol: tokenBSymbol
      },
      strategy,
      binStep,
      baseFee,
      maxBinRange
    });
    
    // Subtract allocated amounts from portfolio
    if (tokenAMint === this.config.usdcMint) {
      this.portfolio.usdc = this.portfolio.usdc.sub(tokenAAmount);
    } else if (tokenAMint === this.config.solMint) {
      this.portfolio.sol = this.portfolio.sol.sub(tokenAAmount);
    }
    
    if (tokenBMint === this.config.usdcMint) {
      this.portfolio.usdc = this.portfolio.usdc.sub(tokenBAmount);
    } else if (tokenBMint === this.config.solMint) {
      this.portfolio.sol = this.portfolio.sol.sub(tokenBAmount);
    }
    
    logger.info(`Updated allocations for pool ${poolAddress}: ${tokenASymbol}/${tokenBSymbol}`);
  }
  
  /**
   * Remove allocation when a pool is closed
   */
  removeAllocation(poolAddress: string): void {
    const allocation = this.currentAllocations.get(poolAddress);
    if (!allocation) {
      logger.warn(`No allocation found for pool ${poolAddress}`);
      return;
    }
    
    // Add tokens back to portfolio (assume we get back what we put in plus earnings)
    // In a real implementation, you would get the actual amounts from the pool
    if (allocation.tokenA.mint === this.config.usdcMint) {
      this.portfolio.usdc = this.portfolio.usdc.add(allocation.tokenA.amount);
    } else if (allocation.tokenA.mint === this.config.solMint) {
      this.portfolio.sol = this.portfolio.sol.add(allocation.tokenA.amount);
    }
    
    if (allocation.tokenB.mint === this.config.usdcMint) {
      this.portfolio.usdc = this.portfolio.usdc.add(allocation.tokenB.amount);
    } else if (allocation.tokenB.mint === this.config.solMint) {
      this.portfolio.sol = this.portfolio.sol.add(allocation.tokenB.amount);
    }
    
    // Remove allocation
    this.currentAllocations.delete(poolAddress);
    
    logger.info(`Removed allocation for pool ${poolAddress}`);
  }
  
  /**
   * Process collected fees and add them to portfolio
   */
  processFees(
    poolAddress: string,
    feeAmountA: BN,
    feeAmountB: BN,
    tokenAMint: string,
    tokenBMint: string
  ): void {
    // Add fees to portfolio
    if (tokenAMint === this.config.usdcMint) {
      this.portfolio.usdc = this.portfolio.usdc.add(feeAmountA);
    } else if (tokenAMint === this.config.solMint) {
      this.portfolio.sol = this.portfolio.sol.add(feeAmountA);
    }
    
    if (tokenBMint === this.config.usdcMint) {
      this.portfolio.usdc = this.portfolio.usdc.add(feeAmountB);
    } else if (tokenBMint === this.config.solMint) {
      this.portfolio.sol = this.portfolio.sol.add(feeAmountB);
    }
    
    logger.info(`Processed fees for pool ${poolAddress}: ${feeAmountA.toString()} token A, ${feeAmountB.toString()} token B`);
  }
}

export default MicroPortfolioStrategy;