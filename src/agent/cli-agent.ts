/**
 * Comet CLI Agent
 * 
 * An interactive, agentic CLI interface for Comet, inspired by Claude Code.
 * This provides a conversational interface to interact with your Comet agent.
 */

import readline from 'readline';
import { Comet } from './index';
import { CometConfig } from './types';
import { parseEnvConfig } from './utils/helpers';
import { logger } from './utils/logger';
import { ClaudeService } from './utils/claude';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { getPriceFromBirdeye } from './utils/price';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { SafetyManager } from './utils/safety';

// ANSI color codes for better CLI formatting
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underscore: '\x1b[4m',
  blink: '\x1b[5m',
  reverse: '\x1b[7m',
  hidden: '\x1b[8m',
  
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};

// Define welcome message and help text
const welcomeMessage = `
${colors.cyan}${colors.bright}========================================
🪐 COMET INTERACTIVE CLI AGENT 🪐
========================================${colors.reset}

Welcome to Comet, your autonomous liquidity agent for Meteora DLMM.
I'm here to help you manage your liquidity and optimize your DeFi strategies.

${colors.yellow}Type a command or ask me anything about your positions, the market, or 
how to optimize your liquidity. Type ${colors.bright}/help${colors.reset}${colors.yellow} to see available commands.${colors.reset}
`;

const helpText = `
${colors.cyan}${colors.bright}Available Commands:${colors.reset}

${colors.green}/help${colors.reset} - Show this help text
${colors.green}/status${colors.reset} - Show current positions and agent status
${colors.green}/create-pool${colors.reset} <tokenX> <tokenY> <binStep> <feeBps> - Create a new DLMM pool
${colors.green}/add-liquidity${colors.reset} <pool> <amountX> <amountY> [strategy] [range] - Add liquidity to a pool
${colors.green}/rebalance${colors.reset} <pool> - Rebalance a position
${colors.green}/collect-fees${colors.reset} <pool> - Collect fees from a position
${colors.green}/market${colors.reset} <token> - Get market data for a token
${colors.green}/analyze${colors.reset} <pool> - Analyze a pool for optimization opportunities
${colors.green}/simulate${colors.reset} <strategy> <amount> <days> - Simulate returns for a strategy
${colors.green}/strategy${colors.reset} <type> - Switch to a different strategy type
${colors.green}/exit${colors.reset} - Exit the CLI agent

You can also ask me questions in natural language, like:
- "How are my pools performing?"
- "What's the current price of SOL?"
- "When should I rebalance my positions?"
- "How much have I earned in fees so far?"
- "What's the optimal bin range for SOL/USDC right now?"
`;

/**
 * Main CLI Agent class
 */
class CometCliAgent {
  private rl: readline.Interface;
  private config: CometConfig;
  private agent: Comet | null = null;
  private claudeService: ClaudeService | null = null;
  private safetyManager: SafetyManager | null = null;
  private isRunning: boolean = false;
  private poolAddresses: string[] = [];
  private portfolioValue: number = 0;
  
  constructor() {
    // Load config from environment
    this.config = parseEnvConfig();
    
    // Create readline interface
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: `${colors.green}${colors.bright}comet>${colors.reset} `,
      historySize: 100,
      terminal: true
    });
    
    // Check for Claude API key
    if (this.config.claude?.apiKey) {
      this.claudeService = new ClaudeService({
        apiKey: this.config.claude.apiKey,
        model: this.config.claude.model || 'claude-3-sonnet-20240229'
      });
    }
    
    // Initialize safety manager
    this.safetyManager = new SafetyManager(100, {
      stopLossPercentage: 5,
      maxDrawdownPercentage: 10,
      enableNotifications: false
    });
  }
  
  /**
   * Start the interactive CLI agent
   */
  async start(): Promise<void> {
    try {
      console.log(welcomeMessage);
      
      // Initialize Comet agent if wallet key is available
      if (this.config.walletKey) {
        console.log(`${colors.cyan}Initializing Comet agent...${colors.reset}`);
        this.agent = new Comet(this.config);
        await this.agent.initialize();
        console.log(`${colors.green}Comet agent initialized successfully.${colors.reset}`);
        
        // Get current pools and positions
        await this.refreshPositions();
      } else {
        console.log(`${colors.yellow}⚠️ No wallet key found. Some commands will be unavailable.${colors.reset}`);
        console.log(`${colors.yellow}Set the COMET_WALLET_KEY environment variable to enable all features.${colors.reset}`);
      }
      
      // Start the CLI loop
      this.isRunning = true;
      this.promptUser();
      
      // Set up event handlers
      this.rl.on('line', async (input) => {
        if (!this.isRunning) return;
        
        try {
          await this.processInput(input.trim());
        } catch (error) {
          console.error(`${colors.red}Error processing command:${colors.reset}`, error);
        }
        
        this.promptUser();
      });
      
      this.rl.on('close', () => {
        this.shutdown();
      });
      
      // Handle Ctrl+C
      process.on('SIGINT', () => {
        this.shutdown();
      });
      
    } catch (error) {
      console.error(`${colors.red}Failed to start CLI agent:${colors.reset}`, error);
      this.shutdown();
    }
  }
  
  /**
   * Process user input
   */
  private async processInput(input: string): Promise<void> {
    // Empty input
    if (!input) return;
    
    // Check if the input is a command
    if (input.startsWith('/')) {
      const [command, ...args] = input.split(' ');
      
      switch (command.toLowerCase()) {
        case '/help':
          console.log(helpText);
          break;
          
        case '/status':
          await this.showStatus();
          break;
          
        case '/create-pool':
          await this.createPool(args);
          break;
          
        case '/add-liquidity':
          await this.addLiquidity(args);
          break;
          
        case '/rebalance':
          await this.rebalance(args);
          break;
          
        case '/collect-fees':
          await this.collectFees(args);
          break;
          
        case '/market':
          await this.getMarketData(args);
          break;
          
        case '/analyze':
          await this.analyzePool(args);
          break;
          
        case '/simulate':
          await this.simulateStrategy(args);
          break;
          
        case '/strategy':
          await this.setStrategy(args);
          break;
          
        case '/exit':
          this.shutdown();
          break;
          
        default:
          console.log(`${colors.yellow}Unknown command: ${command}${colors.reset}`);
          console.log(`Type ${colors.bright}/help${colors.reset} to see available commands.`);
      }
      
      return;
    }
    
    // If not a command, process as natural language query
    await this.processNaturalLanguage(input);
  }
  
  /**
   * Show current agent status
   */
  private async showStatus(): Promise<void> {
    if (!this.agent) {
      console.log(`${colors.yellow}⚠️ Comet agent not initialized. Set COMET_WALLET_KEY to enable.${colors.reset}`);
      return;
    }
    
    // Get current balance
    const connection = this.agent.getConnection();
    const wallet = this.agent.getWallet();
    const balance = await connection.getBalance(wallet.publicKey);
    const balanceSol = balance / LAMPORTS_PER_SOL;
    
    console.log(`\n${colors.cyan}${colors.bright}Comet Agent Status${colors.reset}`);
    console.log(`${colors.cyan}==================${colors.reset}`);
    console.log(`${colors.bright}Wallet:${colors.reset} ${wallet.publicKey.toString()}`);
    console.log(`${colors.bright}SOL Balance:${colors.reset} ${balanceSol.toFixed(4)} SOL`);
    
    // Show pools and positions
    if (this.poolAddresses.length > 0) {
      console.log(`\n${colors.cyan}${colors.bright}Active Pools${colors.reset}`);
      console.log(`${colors.cyan}============${colors.reset}`);
      
      for (const poolAddress of this.poolAddresses) {
        try {
          // Update agent to use this pool
          this.agent.setPoolAddress(new PublicKey(poolAddress));
          
          // Get pool info
          const pool = await this.agent.getPool();
          if (!pool) {
            console.log(`${colors.yellow}Pool not found: ${poolAddress}${colors.reset}`);
            continue;
          }
          
          // Get token symbols
          const tokenX = await this.agent.getTokenSymbol(pool.lbPair.tokenX.mint);
          const tokenY = await this.agent.getTokenSymbol(pool.lbPair.tokenY.mint);
          
          // Get active bin
          const activeBin = await pool.getActiveBin();
          
          console.log(`\n${colors.bright}Pool:${colors.reset} ${poolAddress}`);
          console.log(`${colors.bright}Pair:${colors.reset} ${tokenX}/${tokenY}`);
          console.log(`${colors.bright}Active Bin:${colors.reset} ${activeBin.binId}`);
          console.log(`${colors.bright}Current Price:${colors.reset} ${activeBin.price.toFixed(6)}`);
          console.log(`${colors.bright}Bin Step:${colors.reset} ${pool.lbPair.binStep / 100}%`);
          
          // Get positions
          const positions = await this.agent.getPositions();
          if (positions.length > 0) {
            console.log(`\n${colors.bright}Positions:${colors.reset}`);
            for (const position of positions) {
              console.log(`  Position ID: ${position.publicKey.toString()}`);
              console.log(`  Liquidity: ${position.liquidityX.toString()} ${tokenX}, ${position.liquidityY.toString()} ${tokenY}`);
              console.log(`  Range: Bins ${position.lowerBinId} to ${position.upperBinId}`);
            }
          } else {
            console.log(`\n${colors.yellow}No positions found in this pool.${colors.reset}`);
          }
          
        } catch (error) {
          console.error(`${colors.red}Error getting pool info for ${poolAddress}:${colors.reset}`, error);
        }
      }
    } else {
      console.log(`\n${colors.yellow}No active pools found.${colors.reset}`);
    }
    
    // Show portfolio value
    console.log(`\n${colors.bright}Estimated Portfolio Value:${colors.reset} $${this.portfolioValue.toFixed(2)}`);
    
    // Show safety status
    if (this.safetyManager) {
      const safetyReport = this.safetyManager.getSafetyReport();
      console.log(`\n${colors.cyan}${colors.bright}Safety Status${colors.reset}`);
      console.log(`${colors.cyan}==============${colors.reset}`);
      console.log(`${colors.bright}Stop Loss:${colors.reset} ${safetyReport.stopLossTriggered ? colors.red + 'TRIGGERED' : colors.green + 'Not Triggered'}`);
      console.log(`${colors.bright}Emergency Shutdown:${colors.reset} ${safetyReport.emergencyShutdownTriggered ? colors.red + 'TRIGGERED' : colors.green + 'Not Triggered'}`);
      console.log(`${colors.bright}Current Drawdown:${colors.reset} ${safetyReport.drawdownPercent.toFixed(2)}%`);
      console.log(`${colors.bright}Current Loss:${colors.reset} ${safetyReport.lossPercent.toFixed(2)}%`);
    }
  }
  
  /**
   * Create a new DLMM pool
   */
  private async createPool(args: string[]): Promise<void> {
    if (!this.agent) {
      console.log(`${colors.yellow}⚠️ Comet agent not initialized. Set COMET_WALLET_KEY to enable.${colors.reset}`);
      return;
    }
    
    if (args.length < 4) {
      console.log(`${colors.yellow}Usage: /create-pool <tokenX> <tokenY> <binStep> <feeBps>${colors.reset}`);
      return;
    }
    
    const [tokenX, tokenY, binStepStr, feeBpsStr] = args;
    const binStep = parseInt(binStepStr);
    const feeBps = parseInt(feeBpsStr);
    
    if (isNaN(binStep) || isNaN(feeBps)) {
      console.log(`${colors.red}Invalid bin step or fee BPS. Please provide numbers.${colors.reset}`);
      return;
    }
    
    try {
      console.log(`${colors.cyan}Creating DLMM pool...${colors.reset}`);
      
      // Use the Comet API to create the pool
      const poolAddress = await this.agent.createPoolWithParameters(
        new PublicKey(tokenX),
        new PublicKey(tokenY),
        binStep,
        8388608, // Default active ID
        feeBps
      );
      
      console.log(`${colors.green}Pool created successfully: ${poolAddress.toString()}${colors.reset}`);
      
      // Add to list of pools
      this.poolAddresses.push(poolAddress.toString());
      
    } catch (error) {
      console.error(`${colors.red}Failed to create pool:${colors.reset}`, error);
    }
  }
  
  /**
   * Add liquidity to a pool
   */
  private async addLiquidity(args: string[]): Promise<void> {
    if (!this.agent) {
      console.log(`${colors.yellow}⚠️ Comet agent not initialized. Set COMET_WALLET_KEY to enable.${colors.reset}`);
      return;
    }
    
    if (args.length < 3) {
      console.log(`${colors.yellow}Usage: /add-liquidity <pool> <amountX> <amountY> [strategy] [range]${colors.reset}`);
      return;
    }
    
    const [poolAddress, amountXStr, amountYStr, strategy = 'Spot', rangeStr = '10'] = args;
    const amountX = new BN(amountXStr);
    const amountY = new BN(amountYStr);
    const binRange = parseInt(rangeStr);
    
    if (amountX.isZero() || amountY.isZero() || isNaN(binRange)) {
      console.log(`${colors.red}Invalid amounts or bin range. Please provide valid numbers.${colors.reset}`);
      return;
    }
    
    try {
      console.log(`${colors.cyan}Adding liquidity to pool ${poolAddress}...${colors.reset}`);
      
      // Set the pool address in the agent
      this.agent.setPoolAddress(new PublicKey(poolAddress));
      
      // Set the strategy
      this.agent.setStrategy(strategy);
      
      // Set the bin range
      this.agent.setBinRange(binRange);
      
      // Add liquidity
      const txSignature = await this.agent.addLiquidity(amountX, amountY);
      
      console.log(`${colors.green}Liquidity added successfully!${colors.reset}`);
      console.log(`Transaction: ${txSignature}`);
      
      // Refresh positions
      await this.refreshPositions();
      
    } catch (error) {
      console.error(`${colors.red}Failed to add liquidity:${colors.reset}`, error);
    }
  }
  
  /**
   * Rebalance a position
   */
  private async rebalance(args: string[]): Promise<void> {
    if (!this.agent) {
      console.log(`${colors.yellow}⚠️ Comet agent not initialized. Set COMET_WALLET_KEY to enable.${colors.reset}`);
      return;
    }
    
    if (args.length < 1) {
      console.log(`${colors.yellow}Usage: /rebalance <pool>${colors.reset}`);
      return;
    }
    
    const [poolAddress] = args;
    
    try {
      console.log(`${colors.cyan}Rebalancing pool ${poolAddress}...${colors.reset}`);
      
      // Set the pool address in the agent
      this.agent.setPoolAddress(new PublicKey(poolAddress));
      
      // Rebalance
      await this.agent.rebalance();
      
      console.log(`${colors.green}Rebalance completed successfully!${colors.reset}`);
      
      // Refresh positions
      await this.refreshPositions();
      
    } catch (error) {
      console.error(`${colors.red}Failed to rebalance:${colors.reset}`, error);
    }
  }
  
  /**
   * Collect fees from a position
   */
  private async collectFees(args: string[]): Promise<void> {
    if (!this.agent) {
      console.log(`${colors.yellow}⚠️ Comet agent not initialized. Set COMET_WALLET_KEY to enable.${colors.reset}`);
      return;
    }
    
    if (args.length < 1) {
      console.log(`${colors.yellow}Usage: /collect-fees <pool>${colors.reset}`);
      return;
    }
    
    const [poolAddress] = args;
    
    try {
      console.log(`${colors.cyan}Collecting fees from pool ${poolAddress}...${colors.reset}`);
      
      // Set the pool address in the agent
      this.agent.setPoolAddress(new PublicKey(poolAddress));
      
      // Collect fees
      await this.agent.collectFees();
      
      console.log(`${colors.green}Fees collected successfully!${colors.reset}`);
      
      // Refresh positions
      await this.refreshPositions();
      
    } catch (error) {
      console.error(`${colors.red}Failed to collect fees:${colors.reset}`, error);
    }
  }
  
  /**
   * Get market data for a token
   */
  private async getMarketData(args: string[]): Promise<void> {
    if (args.length < 1) {
      console.log(`${colors.yellow}Usage: /market <token>${colors.reset}`);
      return;
    }
    
    const [token] = args;
    
    try {
      console.log(`${colors.cyan}Getting market data for ${token}...${colors.reset}`);
      
      // Map token symbols to addresses
      let tokenAddress = '';
      switch (token.toUpperCase()) {
        case 'SOL':
          tokenAddress = 'So11111111111111111111111111111111111111112';
          break;
        case 'USDC':
          tokenAddress = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
          break;
        case 'BONK':
          tokenAddress = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
          break;
        case 'MSOL':
          tokenAddress = 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So';
          break;
        default:
          // Assume the token is already an address
          tokenAddress = token;
      }
      
      // Get price from Birdeye
      const price = await getPriceFromBirdeye(tokenAddress, 1);
      
      console.log(`\n${colors.cyan}${colors.bright}Market Data for ${token}${colors.reset}`);
      console.log(`${colors.cyan}======================${colors.reset}`);
      console.log(`${colors.bright}Price:${colors.reset} $${price.toFixed(6)}`);
      
      // Check for Claude to get more market data
      if (this.claudeService) {
        console.log(`\n${colors.cyan}Getting additional market analysis from Claude AI...${colors.reset}`);
        
        const analysis = await this.claudeService.generateMarketAnalysis(token, price);
        console.log(`\n${colors.cyan}${colors.bright}Claude AI Analysis${colors.reset}`);
        console.log(`${colors.cyan}==================${colors.reset}`);
        console.log(analysis);
      }
      
    } catch (error) {
      console.error(`${colors.red}Failed to get market data:${colors.reset}`, error);
    }
  }
  
  /**
   * Analyze a pool for optimization opportunities
   */
  private async analyzePool(args: string[]): Promise<void> {
    if (!this.agent) {
      console.log(`${colors.yellow}⚠️ Comet agent not initialized. Set COMET_WALLET_KEY to enable.${colors.reset}`);
      return;
    }
    
    if (args.length < 1) {
      console.log(`${colors.yellow}Usage: /analyze <pool>${colors.reset}`);
      return;
    }
    
    const [poolAddress] = args;
    
    try {
      console.log(`${colors.cyan}Analyzing pool ${poolAddress}...${colors.reset}`);
      
      // Set the pool address in the agent
      this.agent.setPoolAddress(new PublicKey(poolAddress));
      
      // Get pool info
      const pool = await this.agent.getPool();
      if (!pool) {
        console.log(`${colors.red}Pool not found.${colors.reset}`);
        return;
      }
      
      // Get token symbols
      const tokenX = await this.agent.getTokenSymbol(pool.lbPair.tokenX.mint);
      const tokenY = await this.agent.getTokenSymbol(pool.lbPair.tokenY.mint);
      
      // Get active bin
      const activeBin = await pool.getActiveBin();
      
      console.log(`\n${colors.cyan}${colors.bright}Pool Analysis for ${tokenX}/${tokenY}${colors.reset}`);
      console.log(`${colors.cyan}=============================${colors.reset}`);
      console.log(`${colors.bright}Active Bin:${colors.reset} ${activeBin.binId}`);
      console.log(`${colors.bright}Current Price:${colors.reset} ${activeBin.price.toFixed(6)}`);
      console.log(`${colors.bright}Bin Step:${colors.reset} ${pool.lbPair.binStep / 100}%`);
      
      // Get positions
      const positions = await this.agent.getPositions();
      
      if (positions.length > 0) {
        // Check if rebalance needed
        const shouldRebalance = await this.agent.shouldRebalance();
        
        console.log(`\n${colors.bright}Rebalance Needed:${colors.reset} ${shouldRebalance ? colors.yellow + 'Yes' : colors.green + 'No'}`);
        
        // Calculate distance from center of position range
        for (const position of positions) {
          const positionCenter = (position.lowerBinId + position.upperBinId) / 2;
          const distance = Math.abs(positionCenter - activeBin.binId);
          const distancePercent = (distance * pool.lbPair.binStep) / 100;
          
          console.log(`\n${colors.bright}Position ID:${colors.reset} ${position.publicKey.toString()}`);
          console.log(`${colors.bright}Range:${colors.reset} Bins ${position.lowerBinId} to ${position.upperBinId}`);
          console.log(`${colors.bright}Distance from Active Bin:${colors.reset} ${distance} bins (${distancePercent.toFixed(2)}%)`);
          
          // Classify the position
          if (distance === 0) {
            console.log(`${colors.green}Position is perfectly centered.${colors.reset}`);
          } else if (distance <= 5) {
            console.log(`${colors.green}Position is well centered.${colors.reset}`);
          } else if (distance <= 10) {
            console.log(`${colors.yellow}Position is slightly off-center.${colors.reset}`);
          } else {
            console.log(`${colors.red}Position is significantly off-center. Consider rebalancing.${colors.reset}`);
          }
        }
      } else {
        console.log(`\n${colors.yellow}No positions found in this pool.${colors.reset}`);
      }
      
      // Get Claude analysis if available
      if (this.claudeService) {
        console.log(`\n${colors.cyan}Getting optimization recommendations from Claude AI...${colors.reset}`);
        
        const analysis = await this.claudeService.generatePoolAnalysis(
          tokenX,
          tokenY,
          activeBin.price,
          pool.lbPair.binStep / 100
        );
        
        console.log(`\n${colors.cyan}${colors.bright}Claude AI Recommendations${colors.reset}`);
        console.log(`${colors.cyan}==========================${colors.reset}`);
        console.log(analysis);
      }
      
    } catch (error) {
      console.error(`${colors.red}Failed to analyze pool:${colors.reset}`, error);
    }
  }
  
  /**
   * Simulate a strategy
   */
  private async simulateStrategy(args: string[]): Promise<void> {
    if (args.length < 3) {
      console.log(`${colors.yellow}Usage: /simulate <strategy> <amount> <days>${colors.reset}`);
      return;
    }
    
    const [strategy, amountStr, daysStr] = args;
    const amount = parseFloat(amountStr);
    const days = parseInt(daysStr);
    
    if (isNaN(amount) || isNaN(days)) {
      console.log(`${colors.red}Invalid amount or days. Please provide numbers.${colors.reset}`);
      return;
    }
    
    try {
      console.log(`${colors.cyan}Simulating ${strategy} strategy with $${amount} over ${days} days...${colors.reset}`);
      
      // Simple simulation logic (placeholder)
      let simulatedAmount = amount;
      const dailyReturnMap: Record<string, number> = {
        'Spot': 0.001, // 0.1% daily return
        'BidAsk': 0.0015, // 0.15% daily return
        'Curve': 0.0012, // 0.12% daily return
        'MicroPortfolio': 0.002 // 0.2% daily return
      };
      
      // Get daily return for the strategy (default to 0.1%)
      const dailyReturn = dailyReturnMap[strategy] || 0.001;
      
      // Calculate compound return
      for (let i = 0; i < days; i++) {
        simulatedAmount *= (1 + dailyReturn);
      }
      
      const profit = simulatedAmount - amount;
      const percentReturn = ((simulatedAmount / amount) - 1) * 100;
      
      console.log(`\n${colors.cyan}${colors.bright}Simulation Results${colors.reset}`);
      console.log(`${colors.cyan}===================${colors.reset}`);
      console.log(`${colors.bright}Strategy:${colors.reset} ${strategy}`);
      console.log(`${colors.bright}Initial Investment:${colors.reset} $${amount.toFixed(2)}`);
      console.log(`${colors.bright}Final Value:${colors.reset} $${simulatedAmount.toFixed(2)}`);
      console.log(`${colors.bright}Profit:${colors.reset} $${profit.toFixed(2)} (${percentReturn.toFixed(2)}%)`);
      console.log(`${colors.bright}Annualized Return:${colors.reset} ${(percentReturn * 365 / days).toFixed(2)}%`);
      
      // Get Claude analysis if available
      if (this.claudeService) {
        console.log(`\n${colors.cyan}Getting strategy insights from Claude AI...${colors.reset}`);
        
        const analysis = await this.claudeService.generateStrategyAnalysis(
          strategy,
          amount,
          days,
          simulatedAmount
        );
        
        console.log(`\n${colors.cyan}${colors.bright}Claude AI Analysis${colors.reset}`);
        console.log(`${colors.cyan}==================${colors.reset}`);
        console.log(analysis);
      }
      
    } catch (error) {
      console.error(`${colors.red}Failed to simulate strategy:${colors.reset}`, error);
    }
  }
  
  /**
   * Set the strategy type
   */
  private async setStrategy(args: string[]): Promise<void> {
    if (!this.agent) {
      console.log(`${colors.yellow}⚠️ Comet agent not initialized. Set COMET_WALLET_KEY to enable.${colors.reset}`);
      return;
    }
    
    if (args.length < 1) {
      console.log(`${colors.yellow}Usage: /strategy <type>${colors.reset}`);
      return;
    }
    
    const [strategyType] = args;
    
    try {
      // Set strategy in agent
      this.agent.setStrategy(strategyType);
      
      console.log(`${colors.green}Strategy set to ${strategyType}.${colors.reset}`);
      
    } catch (error) {
      console.error(`${colors.red}Failed to set strategy:${colors.reset}`, error);
    }
  }
  
  /**
   * Process natural language queries
   */
  private async processNaturalLanguage(input: string): Promise<void> {
    // If Claude is not available, provide basic response
    if (!this.claudeService) {
      console.log(`${colors.yellow}I can process natural language queries with Claude AI.${colors.reset}`);
      console.log(`${colors.yellow}Set CLAUDE_API_KEY in your environment to enable this feature.${colors.reset}`);
      console.log(`${colors.yellow}For now, please use the slash commands listed in /help.${colors.reset}`);
      return;
    }
    
    try {
      console.log(`${colors.cyan}Processing your query...${colors.reset}`);
      
      // Get current status to provide context to Claude
      let contextInfo = '';
      
      if (this.agent) {
        // Get wallet info
        const wallet = this.agent.getWallet();
        const connection = this.agent.getConnection();
        const balance = await connection.getBalance(wallet.publicKey);
        const balanceSol = balance / LAMPORTS_PER_SOL;
        
        contextInfo += `Wallet: ${wallet.publicKey.toString()}\n`;
        contextInfo += `SOL Balance: ${balanceSol.toFixed(4)} SOL\n`;
        
        // Add pool info if available
        if (this.poolAddresses.length > 0) {
          contextInfo += `\nActive Pools:\n`;
          
          for (const poolAddress of this.poolAddresses) {
            try {
              this.agent.setPoolAddress(new PublicKey(poolAddress));
              const pool = await this.agent.getPool();
              
              if (pool) {
                const tokenX = await this.agent.getTokenSymbol(pool.lbPair.tokenX.mint);
                const tokenY = await this.agent.getTokenSymbol(pool.lbPair.tokenY.mint);
                const activeBin = await pool.getActiveBin();
                
                contextInfo += `- Pool: ${poolAddress} (${tokenX}/${tokenY})\n`;
                contextInfo += `  Price: ${activeBin.price.toFixed(6)}\n`;
                contextInfo += `  Active Bin: ${activeBin.binId}\n`;
                contextInfo += `  Bin Step: ${pool.lbPair.binStep / 100}%\n`;
              }
            } catch (error) {
              console.error(`Error getting pool info: ${error}`);
            }
          }
        }
        
        // Add portfolio value
        contextInfo += `\nPortfolio Value: $${this.portfolioValue.toFixed(2)}\n`;
      }
      
      // Get response from Claude
      const response = await this.claudeService.generateAgentResponse(
        input,
        contextInfo
      );
      
      console.log(`\n${colors.cyan}${colors.bright}Comet Assistant${colors.reset}`);
      console.log(`${colors.cyan}================${colors.reset}`);
      console.log(response);
      
    } catch (error) {
      console.error(`${colors.red}Failed to process query:${colors.reset}`, error);
    }
  }
  
  /**
   * Refresh positions data
   */
  private async refreshPositions(): Promise<void> {
    if (!this.agent) return;
    
    try {
      // Get wallet address
      const wallet = this.agent.getWallet();
      
      // Find all pools with positions for this wallet
      // In a real implementation, we'd use a database or other method to track this
      // For now, just use the configured pool if any
      this.poolAddresses = [];
      
      if (this.config.poolAddress) {
        this.poolAddresses.push(this.config.poolAddress);
      }
      
      // Calculate portfolio value (simplified)
      this.portfolioValue = 0;
      
      // Add SOL value
      const connection = this.agent.getConnection();
      const balance = await connection.getBalance(wallet.publicKey);
      const balanceSol = balance / LAMPORTS_PER_SOL;
      
      // Assume SOL price is $100 (simplified)
      const solPrice = 100;
      this.portfolioValue += balanceSol * solPrice;
      
      // Update safety manager
      if (this.safetyManager) {
        this.safetyManager.updateValue(this.portfolioValue);
      }
      
    } catch (error) {
      console.error(`${colors.red}Error refreshing positions:${colors.reset}`, error);
    }
  }
  
  /**
   * Prompt the user for input
   */
  private promptUser(): void {
    this.rl.prompt();
  }
  
  /**
   * Shutdown the CLI agent
   */
  private shutdown(): void {
    this.isRunning = false;
    console.log(`\n${colors.green}Shutting down Comet CLI agent...${colors.reset}`);
    
    if (this.agent) {
      this.agent.stop();
    }
    
    this.rl.close();
    process.exit(0);
  }
}

// Run the CLI agent if this file is executed directly
if (require.main === module) {
  const cliAgent = new CometCliAgent();
  cliAgent.start();
}

export default CometCliAgent;