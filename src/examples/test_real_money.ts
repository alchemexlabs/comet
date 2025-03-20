/**
 * Test setup for real money testing with minimal funds
 * 
 * This example demonstrates how to set up a test wallet with safety limits
 * and run the MicroPortfolio strategy with real money.
 */

import { Comet } from '../agent';
import { MicroPortfolioAgent } from '../agent/strategies/micro-portfolio';
import { TestWallet } from '../agent/utils/test-wallet';
import { SafetyManager } from '../agent/utils/safety';
import { Connection, clusterApiUrl } from '@solana/web3.js';
import { logger } from '../agent/utils/logger';

async function main() {
  try {
    // Configure environment from .env file or environment variables
    const rpcUrl = process.env.RPC_URL || clusterApiUrl('mainnet-beta');
    const useHeliusApiKey = process.env.HELIUS_API_KEY || '';
    const useBirdeyeApiKey = process.env.BIRDEYE_API_KEY || '';
    const initialUsdcAmount = 5_000_000; // $5 USDC = 5M native units
    const initialSolAmount = 50_000_000; // 0.05 SOL = 50M native units
    
    // Create test wallet with safety limits
    const testWallet = new TestWallet({
      maxValueUsd: 10, // Maximum $10 USD in wallet
      keyPath: './.test-wallet.json'
    });
    
    // Initialize Comet agent with test wallet
    const comet = new Comet({
      wallet: testWallet.getKeypair(),
      connection: new Connection(rpcUrl),
      heliusApiKey: useHeliusApiKey,
      birdeyeApiKey: useBirdeyeApiKey
    });
    
    // Set up safety manager
    const initialValueUsd = (initialUsdcAmount / 1e6) + ((initialSolAmount / 1e9) * 100); // Assuming SOL = $100
    const safetyManager = new SafetyManager(initialValueUsd, {
      stopLossPercentage: 5, // 5% stop loss
      maxDrawdownPercentage: 10, // 10% max drawdown
      minimumValueUsd: initialValueUsd * 0.95, // 95% of initial value
      enableNotifications: true,
      notificationEmail: 'test@example.com'
    });
    
    // Initialize MicroPortfolio strategy
    const microPortfolio = new MicroPortfolioAgent(comet, {
      initialCapital: {
        usdc: initialUsdcAmount,
        sol: initialSolAmount,
      },
      riskTolerance: 'low', // Start with low risk for test
      weekendSafetyEnabled: true,
      maxAllocationPerPool: 25, // Max 25% of portfolio in any pool
      rebalanceThreshold: 2, // Rebalance on 2% price change
      compoundInterval: 4 * 60 * 60 * 1000, // 4 hours
    });
    
    // Start regular value monitoring
    startSafetyMonitoring(microPortfolio, safetyManager);
    
    // Start the strategy
    await microPortfolio.start();
    
    // Run for a fixed period to test
    setTimeout(async () => {
      logger.info('Test period completed, stopping strategy');
      await microPortfolio.stop();
      
      // Print final report
      const safetyReport = safetyManager.getSafetyReport();
      logger.info('Safety report:', safetyReport);
      
      // Exit process
      process.exit(0);
    }, 60 * 60 * 1000); // Run for 1 hour
    
  } catch (error) {
    logger.error('Error in real money test:', error);
    process.exit(1);
  }
}

/**
 * Start periodic safety monitoring
 */
function startSafetyMonitoring(
  strategy: MicroPortfolioAgent,
  safetyManager: SafetyManager
): void {
  // Update portfolio value every 5 minutes
  const interval = setInterval(async () => {
    try {
      // Update portfolio value
      await strategy.updatePortfolioValue();
      
      // TODO: Get actual portfolio value from strategy
      // For now, using a placeholder value that decreases slightly over time
      const portfolioValue = 10 - (Date.now() % 1000) / 10000;
      
      // Update safety manager
      safetyManager.updateValue(portfolioValue);
      
      // Check if stop loss was triggered
      if (safetyManager.isStopLossTriggered()) {
        logger.warn('Stop loss triggered, stopping strategy');
        clearInterval(interval);
        await strategy.stop();
      }
      
      // Check if emergency shutdown was triggered
      if (safetyManager.isEmergencyShutdownTriggered()) {
        logger.error('Emergency shutdown triggered, stopping all operations');
        clearInterval(interval);
        await strategy.stop();
        process.exit(1);
      }
    } catch (error) {
      logger.error('Error in safety monitoring:', error);
    }
  }, 5 * 60 * 1000); // Check every 5 minutes
}

// Run the example if this file is executed directly
if (require.main === module) {
  main();
}

export default main;