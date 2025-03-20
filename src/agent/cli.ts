#!/usr/bin/env node

/**
 * Command-line interface for the Comet agent
 */

import { Command } from 'commander';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { ActivationType } from '../dlmm/types';
import { Comet } from './index';
import { CometConfig } from './types';
import { parseEnvConfig } from './utils/helpers';
import { logger } from './utils/logger';

// Create CLI program
const program = new Command();

// Set up program metadata
program
  .name('comet')
  .description('Comet - Autonomous Liquidity Agent for Meteora DLMM')
  .version('1.0.0');

// Initialize from environment variables
const envConfig = parseEnvConfig();

// Start command - start the agent
program
  .command('start')
  .description('Start the Comet agent')
  .option('-p, --pool <address>', 'Pool address to manage')
  .option('-s, --strategy <type>', 'Strategy type (Spot, BidAsk, Curve, MicroPortfolio)')
  .option('-r, --range <number>', 'Bin range around active bin')
  .option('-a, --auto-rebalance <boolean>', 'Enable auto rebalancing')
  .option('-i, --interval <ms>', 'Polling interval in milliseconds')
  .option('--claude-enabled <boolean>', 'Enable Claude AI integration')
  .option('--claude-risk <profile>', 'Claude AI risk profile (conservative, moderate, aggressive)')
  .option('--micro-risk <profile>', 'MicroPortfolio risk profile (low, medium, high)')
  .option('--micro-usdc <amount>', 'Initial USDC amount for MicroPortfolio (in USDC)')
  .option('--micro-sol <amount>', 'Initial SOL amount for MicroPortfolio (in SOL)')
  .option('--micro-weekend-safety <boolean>', 'Enable weekend safety mode for MicroPortfolio')
  .action(async (options) => {
    try {
      // Merge CLI options with environment config
      const config: CometConfig = {
        ...envConfig,
        poolAddress: options.pool || envConfig.poolAddress,
        strategy: options.strategy || envConfig.strategy,
        binRange: options.range ? parseInt(options.range) : envConfig.binRange,
        autoRebalance: options.autoRebalance !== undefined 
          ? options.autoRebalance === 'true' 
          : envConfig.autoRebalance,
        pollingInterval: options.interval 
          ? parseInt(options.interval) 
          : envConfig.pollingInterval,
        claude: {
          ...envConfig.claude,
          enabled: options.claudeEnabled !== undefined
            ? options.claudeEnabled === 'true'
            : envConfig.claude?.enabled,
          riskProfile: options.claudeRisk || envConfig.claude?.riskProfile
        },
        // MicroPortfolio strategy settings
        microPortfolio: {
          ...envConfig.microPortfolio,
          riskTolerance: options.microRisk || envConfig.microPortfolio?.riskTolerance,
          weekendSafetyEnabled: options.microWeekendSafety !== undefined
            ? options.microWeekendSafety === 'true'
            : envConfig.microPortfolio?.weekendSafetyEnabled,
          initialCapital: {
            usdc: options.microUsdc 
              ? parseFloat(options.microUsdc) * 1_000_000 // Convert to native units
              : envConfig.microPortfolio?.initialCapital?.usdc || 100_000_000,
            sol: options.microSol
              ? parseFloat(options.microSol) * 1_000_000_000 // Convert to native units
              : envConfig.microPortfolio?.initialCapital?.sol || 1_000_000_000
          }
        }
      };
      
      // Check required config
      if (!config.walletKey) {
        logger.error('Wallet key is required. Set COMET_WALLET_KEY environment variable.');
        process.exit(1);
      }
      
      if (!config.poolAddress) {
        logger.error('Pool address is required. Use --pool option or set COMET_POOL_ADDRESS environment variable.');
        process.exit(1);
      }
      
      // Initialize the agent
      const agent = new Comet(config);
      
      // Setup error handlers
      process.on('uncaughtException', (error) => {
        logger.error('Uncaught exception:', error);
        agent.stop();
        process.exit(1);
      });
      
      process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled rejection at:', promise, 'reason:', reason);
        // Don't exit immediately for unhandled rejections
      });
      
      // Setup graceful shutdown
      process.on('SIGINT', () => {
        logger.info('Shutting down Comet agent...');
        agent.stop();
        process.exit(0);
      });
      
      // Start the agent
      await agent.start();
    } catch (error) {
      logger.error('Failed to start Comet agent:', error);
      process.exit(1);
    }
  });

// Create pool command
program
  .command('create-pool')
  .description('Create a new DLMM pool')
  .requiredOption('-x, --token-x <address>', 'Token X mint address')
  .requiredOption('-y, --token-y <address>', 'Token Y mint address')
  .requiredOption('-b, --bin-step <number>', 'Bin step size')
  .requiredOption('-a, --active-id <number>', 'Initial active bin ID')
  .requiredOption('-f, --fee-bps <number>', 'Fee in basis points')
  .option('-t, --activation-type <number>', 'Activation type (0: UseOracle, 1: ManualBinId)', '1')
  .option('-v, --alpha-vault <boolean>', 'Enable alpha vault', 'false')
  .action(async (options) => {
    try {
      // Parse options
      const config: CometConfig = {
        ...envConfig,
        createPoolParams: {
          tokenX: new PublicKey(options.tokenX),
          tokenY: new PublicKey(options.tokenY),
          binStep: parseInt(options.binStep),
          activeId: parseInt(options.activeId),
          feeBps: parseInt(options.feeBps),
          activationType: parseInt(options.activationType) as ActivationType,
          hasAlphaVault: options.alphaVault === 'true'
        }
      };
      
      // Check required config
      if (!config.walletKey) {
        logger.error('Wallet key is required. Set COMET_WALLET_KEY environment variable.');
        process.exit(1);
      }
      
      // Initialize the agent
      const agent = new Comet(config);
      
      // Create the pool
      logger.info('Creating DLMM pool...');
      const poolAddress = await agent.createPool();
      
      logger.info(`Pool created successfully: ${poolAddress.toString()}`);
      process.exit(0);
    } catch (error) {
      logger.error('Failed to create DLMM pool:', error);
      process.exit(1);
    }
  });

// Add liquidity command
program
  .command('add-liquidity')
  .description('Add liquidity to a DLMM pool')
  .requiredOption('-p, --pool <address>', 'Pool address')
  .requiredOption('-x, --amount-x <amount>', 'Amount of token X')
  .requiredOption('-y, --amount-y <amount>', 'Amount of token Y')
  .option('-s, --strategy <type>', 'Strategy type (Spot, BidAsk, Curve)', 'Spot')
  .option('-r, --range <number>', 'Bin range around active bin', '10')
  .action(async (options) => {
    try {
      // Parse options
      const config: CometConfig = {
        ...envConfig,
        poolAddress: options.pool,
        strategy: options.strategy,
        binRange: parseInt(options.range)
      };
      
      // Check required config
      if (!config.walletKey) {
        logger.error('Wallet key is required. Set COMET_WALLET_KEY environment variable.');
        process.exit(1);
      }
      
      // Initialize the agent
      const agent = new Comet(config);
      await agent.initialize();
      
      // Add liquidity
      logger.info('Adding liquidity...');
      const xAmount = new BN(options.amountX);
      const yAmount = new BN(options.amountY);
      
      const txSignature = await agent.addLiquidity(xAmount, yAmount);
      
      logger.info(`Liquidity added successfully: ${txSignature}`);
      process.exit(0);
    } catch (error) {
      logger.error('Failed to add liquidity:', error);
      process.exit(1);
    }
  });

// Rebalance command
program
  .command('rebalance')
  .description('Rebalance positions')
  .requiredOption('-p, --pool <address>', 'Pool address')
  .action(async (options) => {
    try {
      // Parse options
      const config: CometConfig = {
        ...envConfig,
        poolAddress: options.pool
      };
      
      // Check required config
      if (!config.walletKey) {
        logger.error('Wallet key is required. Set COMET_WALLET_KEY environment variable.');
        process.exit(1);
      }
      
      // Initialize the agent
      const agent = new Comet(config);
      await agent.initialize();
      
      // Rebalance
      logger.info('Rebalancing positions...');
      await agent.rebalance();
      
      logger.info('Rebalance completed successfully');
      process.exit(0);
    } catch (error) {
      logger.error('Failed to rebalance positions:', error);
      process.exit(1);
    }
  });

// Collect fees command
program
  .command('collect-fees')
  .description('Collect fees from positions')
  .requiredOption('-p, --pool <address>', 'Pool address')
  .action(async (options) => {
    try {
      // Parse options
      const config: CometConfig = {
        ...envConfig,
        poolAddress: options.pool
      };
      
      // Check required config
      if (!config.walletKey) {
        logger.error('Wallet key is required. Set COMET_WALLET_KEY environment variable.');
        process.exit(1);
      }
      
      // Initialize the agent
      const agent = new Comet(config);
      await agent.initialize();
      
      // Collect fees
      logger.info('Collecting fees...');
      await agent.collectFees();
      
      logger.info('Fees collected successfully');
      process.exit(0);
    } catch (error) {
      logger.error('Failed to collect fees:', error);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse(process.argv);

// If no arguments provided, show help
if (process.argv.length <= 2) {
  program.help();
}