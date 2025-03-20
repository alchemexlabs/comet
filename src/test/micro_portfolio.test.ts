import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { MicroPortfolioStrategy, MicroPortfolioConfig } from '../agent/utils/strategies/micro-portfolio';
import { StrategyType } from '../dlmm/types';
import { ClaudeService } from '../agent/utils/claude';

// Mock implementations
jest.mock('../agent/utils/claude');
jest.mock('../agent/utils/price', () => ({
  getPriceFromBirdeye: jest.fn().mockImplementation((mint) => {
    if (mint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') {
      return Promise.resolve(1.0); // USDC
    } else if (mint === 'So11111111111111111111111111111111111111112') {
      return Promise.resolve(150.0); // SOL
    } else {
      return Promise.resolve(2.0); // Default for any other token
    }
  }),
}));
jest.mock('../agent/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('MicroPortfolio Strategy', () => {
  let strategy: MicroPortfolioStrategy;
  let config: MicroPortfolioConfig;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Default configuration
    config = {
      initialCapital: {
        usdc: 100_000_000, // $100 USDC (100 million native units)
        sol: 1_000_000_000,  // 1 SOL (1 billion native units)
      },
      riskTolerance: 'medium',
      usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      solMint: 'So11111111111111111111111111111111111111112',
      maxAllocationPerPool: 50,
      rebalanceThreshold: 5, // 5% price change triggers rebalance
      compoundInterval: 24 * 60 * 60 * 1000, // 24 hours
      weekendSafetyEnabled: true,
      claude: {
        enabled: false,
        apiKey: '',
        model: 'claude-3-sonnet-20240229'
      }
    };
    
    // Initialize strategy
    strategy = new MicroPortfolioStrategy(config);
  });
  
  it('should initialize with correct portfolio value', async () => {
    // Update portfolio value
    await strategy.updatePortfolioValue();
    
    // Portfolio should be $100 USDC + $150 SOL = $250
    expect((strategy as any).portfolio.totalValueUsd).toBeCloseTo(250, 1);
  });
  
  it('should provide basic allocations based on risk tolerance', async () => {
    // Get allocations for medium risk
    const allocations = await strategy.getRecommendedAllocations();
    
    // Should have at least the SOL/USDC allocation
    expect(allocations.length).toBeGreaterThanOrEqual(1);
    
    // Check SOL/USDC allocation
    const solUsdcAlloc = allocations[0];
    expect(solUsdcAlloc.tokenA.mint).toBe(config.solMint);
    expect(solUsdcAlloc.tokenB.mint).toBe(config.usdcMint);
    
    // Medium risk should allocate 60% of each token
    expect(solUsdcAlloc.tokenA.amount.toString()).toBe(
      new BN(config.initialCapital.sol).muln(60).divn(100).toString()
    );
    expect(solUsdcAlloc.tokenB.amount.toString()).toBe(
      new BN(config.initialCapital.usdc).muln(60).divn(100).toString()
    );
  });
  
  it('should adjust allocations based on risk tolerance', async () => {
    // Test high risk tolerance
    const highRiskStrategy = new MicroPortfolioStrategy({
      ...config,
      riskTolerance: 'high'
    });
    
    const highRiskAllocations = await highRiskStrategy.getRecommendedAllocations();
    
    // High risk should allocate 40% to SOL/USDC
    expect(highRiskAllocations[0].tokenA.amount.toString()).toBe(
      new BN(config.initialCapital.sol).muln(40).divn(100).toString()
    );
    
    // Test low risk tolerance
    const lowRiskStrategy = new MicroPortfolioStrategy({
      ...config,
      riskTolerance: 'low'
    });
    
    const lowRiskAllocations = await lowRiskStrategy.getRecommendedAllocations();
    
    // Low risk should allocate 80% to SOL/USDC
    expect(lowRiskAllocations[0].tokenA.amount.toString()).toBe(
      new BN(config.initialCapital.sol).muln(80).divn(100).toString()
    );
  });
  
  it('should enable weekend safety mode on weekends', async () => {
    // Mock Date.now to return a Sunday (day 0)
    const realDate = Date;
    global.Date = class extends Date {
      getDay() {
        return 0; // Sunday
      }
    } as any;
    
    // Force update weekend status
    (strategy as any).updateWeekendStatus();
    
    // Get allocations with weekend safety enabled
    const weekendAllocations = await strategy.getRecommendedAllocations();
    
    // Weekend safety should allocate 80% to SOL/USDC regardless of risk
    expect(weekendAllocations[0].tokenA.amount.toString()).toBe(
      new BN(config.initialCapital.sol).muln(80).divn(100).toString()
    );
    
    // Restore Date
    global.Date = realDate;
  });
  
  it('should disable weekend safety mode when configured', async () => {
    // Mock Date.now to return a Sunday (day 0)
    const realDate = Date;
    global.Date = class extends Date {
      getDay() {
        return 0; // Sunday
      }
    } as any;
    
    // Create strategy with weekend safety disabled
    const noSafetyStrategy = new MicroPortfolioStrategy({
      ...config,
      weekendSafetyEnabled: false
    });
    
    // Get allocations with weekend safety disabled
    const allocations = await noSafetyStrategy.getRecommendedAllocations();
    
    // Should use normal allocation strategy (60% for medium risk)
    expect(allocations[0].tokenA.amount.toString()).toBe(
      new BN(config.initialCapital.sol).muln(60).divn(100).toString()
    );
    
    // Restore Date
    global.Date = realDate;
  });
  
  it('should correctly determine when rebalance is needed', async () => {
    // Mock current allocations
    (strategy as any).currentAllocations.set('poolAddress', {
      tokenA: {
        mint: config.solMint,
        symbol: 'SOL',
        amount: new BN(config.initialCapital.sol).muln(60).divn(100)
      },
      tokenB: {
        mint: config.usdcMint,
        symbol: 'USDC',
        amount: new BN(config.initialCapital.usdc).muln(60).divn(100)
      },
      strategy: StrategyType.Spot,
      binStep: 10,
      baseFee: 1,
      maxBinRange: 10
    });
    
    // Mock token data with old prices
    (strategy as any).tokenData.set(config.solMint, {
      symbol: 'SOL',
      mint: config.solMint,
      price: 150.0,
      priceChange24h: 0,
      volume24h: 0
    });
    
    // No price change = no rebalance
    expect(await strategy.shouldRebalance()).toBe(false);
    
    // Modify token data to simulate price change above threshold
    (strategy as any).tokenData.set(config.solMint, {
      symbol: 'SOL',
      mint: config.solMint,
      price: 140.0, // 6.7% change from 150
      priceChange24h: -6.7,
      volume24h: 0
    });
    
    // Price change above threshold = rebalance needed
    expect(await strategy.shouldRebalance()).toBe(true);
  });
  
  it('should correctly update allocations', () => {
    const poolAddress = 'poolAddress';
    const tokenAMint = config.solMint;
    const tokenAAmount = new BN(500_000_000); // 0.5 SOL
    const tokenASymbol = 'SOL';
    const tokenBMint = config.usdcMint;
    const tokenBAmount = new BN(50_000_000); // $50 USDC
    const tokenBSymbol = 'USDC';
    
    // Update allocations
    strategy.updateAllocations(
      poolAddress,
      tokenAMint,
      tokenAAmount,
      tokenASymbol,
      tokenBMint,
      tokenBAmount,
      tokenBSymbol,
      StrategyType.Spot,
      10,
      1,
      10
    );
    
    // Check that allocation was added
    expect((strategy as any).currentAllocations.has(poolAddress)).toBe(true);
    
    // Check that portfolio amounts were reduced
    expect((strategy as any).portfolio.sol.toString()).toBe(
      new BN(config.initialCapital.sol).sub(tokenAAmount).toString()
    );
    expect((strategy as any).portfolio.usdc.toString()).toBe(
      new BN(config.initialCapital.usdc).sub(tokenBAmount).toString()
    );
  });
  
  it('should correctly process fees', () => {
    const initialUsdcAmount = (strategy as any).portfolio.usdc;
    const initialSolAmount = (strategy as any).portfolio.sol;
    
    const feeAmountA = new BN(1_000_000); // 0.001 SOL
    const feeAmountB = new BN(2_000_000); // $2 USDC
    
    // Process fees
    strategy.processFees(
      'poolAddress',
      feeAmountA,
      feeAmountB,
      config.solMint,
      config.usdcMint
    );
    
    // Check that portfolio amounts were increased
    expect((strategy as any).portfolio.sol.toString()).toBe(
      initialSolAmount.add(feeAmountA).toString()
    );
    expect((strategy as any).portfolio.usdc.toString()).toBe(
      initialUsdcAmount.add(feeAmountB).toString()
    );
  });
  
  it('should integrate with Claude AI when enabled', async () => {
    // Mock Claude service
    const mockClaudeService = {
      generateStrategyParameters: jest.fn().mockResolvedValue({
        binRange: 15,
        minBinId: 985,
        maxBinId: 1015,
        weights: Array(31).fill(1), // 31 weights for bins 985-1015
      }),
    };
    
    // Create strategy with Claude enabled
    const claudeStrategy = new MicroPortfolioStrategy({
      ...config,
      claude: {
        enabled: true,
        apiKey: 'mock-api-key',
        model: 'claude-3-sonnet-20240229'
      }
    });
    
    // Inject mocked Claude service
    (claudeStrategy as any).claudeService = mockClaudeService;
    
    // Mock the getClaudeRecommendedAllocations method to call through
    const originalMethod = (claudeStrategy as any).getClaudeRecommendedAllocations;
    (claudeStrategy as any).getClaudeRecommendedAllocations = jest.fn().mockImplementation(async () => {
      // Just return basic allocations for simplicity
      return (claudeStrategy as any).getBasicAllocations();
    });
    
    // Get allocations with Claude enabled
    const allocations = await claudeStrategy.getRecommendedAllocations();
    
    // Verify that Claude method was called
    expect((claudeStrategy as any).getClaudeRecommendedAllocations).toHaveBeenCalled();
    
    // Reset the mock
    (claudeStrategy as any).getClaudeRecommendedAllocations = originalMethod;
  });
});