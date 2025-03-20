import { describe, it, expect, beforeEach, jest, mock } from 'bun:test';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { Comet } from '../agent';
import { StrategyType } from '../dlmm/types';
import { DLMM } from '../dlmm';
import { ClaudeService } from '../agent/utils/claude';
import { assertPosition } from './helper';

// Create valid PublicKeys for testing using base58 encoded strings
const DUMMY_PUBKEY1 = Keypair.generate().publicKey;
const DUMMY_PUBKEY2 = Keypair.generate().publicKey;
const DUMMY_PUBKEY3 = Keypair.generate().publicKey;

// Mock imports
import * as transactionUtils from '../agent/utils/transaction';
import * as databaseUtils from '../agent/utils/database';
import * as priceUtils from '../agent/utils/price';
import * as helpers from '../agent/utils/helpers';

// Mock helpers module to provide a mock wallet
mock.module('../agent/utils/helpers', () => ({
  loadWalletFromKey: () => Keypair.generate(),
  sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
}));

// Mock implementations
mock.module('../agent/utils/claude', () => ({
  ClaudeService: class MockClaudeService {
    async getRebalanceRecommendation() {
      return {
        shouldRebalance: true,
        reason: 'Market conditions have changed',
        strategy: StrategyType.BidAsk,
        binRange: 15,
        minBinId: 985,
        maxBinId: 1015,
        xWeighting: 60,
        yWeighting: 40,
        confidence: 80,
      };
    }
  }
}));

// Create mocks for the utility modules
mock.module('../agent/utils/transaction', () => ({
  sendTransactionWithPriorityFee: () => Promise.resolve('mock-transaction-signature'),
  confirmTransactionWithTimeout: () => Promise.resolve(null),
}));

mock.module('../agent/utils/database', () => ({
  recordRebalanceEvent: () => Promise.resolve(null),
  recordPoolMetrics: () => Promise.resolve(null),
  initializeDatabase: () => {},
  registerAgent: () => 1,
  registerPool: () => {},
  updateAgentStatus: () => {},
}));

mock.module('../agent/utils/price', () => ({
  getPriceFromBirdeye: () => Promise.resolve(1.0),
}));

describe('Comet Agent Rebalance', () => {
  let agent: Comet;
  let mockDLMM: any;
  let mockConnection: any;
  let mockClaudeService: any;
  let wallet: Keypair;
  
  beforeEach(() => {
    // Create mock wallet
    wallet = Keypair.generate();
    
    // Mock DLMM
    mockDLMM = {
      getActiveBin: () => Promise.resolve({
        binId: 1000,
        price: '100.0',
      }),
      getPositionsByUserAndLbPair: () => Promise.resolve({
        userPositions: [
          {
            publicKey: DUMMY_PUBKEY1,
            positionData: {
              totalXAmount: new BN(1000),
              totalYAmount: new BN(1000),
              positionBinData: [
                { binId: 990 },
                { binId: 1000 },
                { binId: 1010 },
              ],
            },
          },
        ],
      }),
      getPositionLiquidity: () => Promise.resolve({
        liquidityAmount: new BN(1000),
      }),
      removeLiquidity: () => Promise.resolve({
        transaction: { serialize: () => Buffer.from([]) },
        signers: [],
        amounts: {
          xAmount: new BN(1000),
          yAmount: new BN(1000),
        },
      }),
      initializePositionAndAddLiquidityByStrategy: () => Promise.resolve({
        transaction: { serialize: () => Buffer.from([]) },
        signers: [],
      }),
      lbPair: {
        tokenX: { mint: DUMMY_PUBKEY1 },
        tokenY: { mint: DUMMY_PUBKEY2 },
        binStep: new BN(10),
        activeId: new BN(1000),
        feeParameter: new BN(1),
        reserveX: new BN(10000),
        reserveY: new BN(10000),
        publicKey: DUMMY_PUBKEY3,
      },
      refetchStates: () => Promise.resolve(null),
    };
    
    // Mock Connection
    mockConnection = {
      getConnection: () => ({
        sendRawTransaction: () => Promise.resolve('mock-transaction-signature'),
        confirmTransaction: () => Promise.resolve({ value: { err: null } }),
      }),
    };
    
    // Mock Claude Service
    mockClaudeService = {
      getRebalanceRecommendation: () => Promise.resolve({
        shouldRebalance: true,
        reason: 'Market conditions have changed',
        strategy: StrategyType.BidAsk,
        binRange: 15,
        minBinId: 985,
        maxBinId: 1015,
        xWeighting: 60,
        yWeighting: 40,
        confidence: 80,
      }),
    };
    
    // Create Comet agent with mocked dependencies
    agent = new Comet({
      poolAddress: DUMMY_PUBKEY3.toString(),
      walletKey: 'dummy-wallet-key', // This is mocked in the helpers module
      rpcUrl: 'https://api.mainnet-beta.solana.com',
      strategy: 'BidAsk',
      binRange: 10,
      autoRebalance: true,
      claude: {
        enabled: true,
        apiKey: 'mock-claude-api-key',
      },
    });
    
    // Inject mocked dependencies
    (agent as any).dlmm = mockDLMM;
    (agent as any).connection = mockConnection;
    (agent as any).claudeService = mockClaudeService;
    (agent as any).agentId = 1;
    
    // Initialize price history
    (agent as any).priceHistory = [
      { timestamp: Date.now() - 60000, price: 95 },
      { timestamp: Date.now() - 30000, price: 98 },
      { timestamp: Date.now(), price: 100 },
    ];
    
    // Initialize volume history
    (agent as any).volumeHistory = [
      { timestamp: Date.now() - 60000, volume: 10000 },
      { timestamp: Date.now() - 30000, volume: 15000 },
      { timestamp: Date.now(), volume: 20000 },
    ];
  });
  
  it('should successfully rebalance positions', async () => {
    // Set up spies to track function calls
    let getRebalanceRecommendationCalled = false;
    let getPositionLiquidityCalled = false;
    let removeLiquidityCalled = false;
    let addLiquidityCalled = false;
    let addLiquidityArgs = null;
    
    // Override functions with tracking
    mockClaudeService.getRebalanceRecommendation = () => {
      getRebalanceRecommendationCalled = true;
      return Promise.resolve({
        shouldRebalance: true,
        reason: 'Market conditions have changed',
        strategy: StrategyType.BidAsk,
        binRange: 15,
        minBinId: 985,
        maxBinId: 1015,
        xWeighting: 60,
        yWeighting: 40,
        confidence: 80,
      });
    };
    
    mockDLMM.getPositionLiquidity = () => {
      getPositionLiquidityCalled = true;
      return Promise.resolve({ liquidityAmount: new BN(1000) });
    };
    
    mockDLMM.removeLiquidity = () => {
      removeLiquidityCalled = true;
      return Promise.resolve({
        transaction: { serialize: () => Buffer.from([]) },
        signers: [],
        amounts: { xAmount: new BN(1000), yAmount: new BN(1000) },
      });
    };
    
    mockDLMM.initializePositionAndAddLiquidityByStrategy = (args: any) => {
      addLiquidityCalled = true;
      addLiquidityArgs = args;
      return Promise.resolve({
        transaction: { serialize: () => Buffer.from([]) },
        signers: [],
      });
    };
    
    // Execute rebalance
    await agent.rebalance();
    
    // Validate function calls
    expect(getRebalanceRecommendationCalled).toBe(true);
    expect(getPositionLiquidityCalled).toBe(true);
    expect(removeLiquidityCalled).toBe(true);
    expect(addLiquidityCalled).toBe(true);
    
    // Validate new position arguments
    expect(addLiquidityArgs.strategy.maxBinId).toBe(1015); // Claude recommended range
    expect(addLiquidityArgs.strategy.minBinId).toBe(985);  // Claude recommended range
    expect(addLiquidityArgs.strategy.strategyType).toBe(2); // BidAsk strategy is enum value 2
    
    // Validate last rebalance time was updated
    expect((agent as any).lastRebalanceTime).toBeGreaterThan(0);
  });
  
  it('should handle failed liquidity removal', async () => {
    // Set up tracking of function calls
    let addLiquidityCalled = false;
    
    // Override functions with tracking
    mockDLMM.removeLiquidity = () => {
      return Promise.reject(new Error('Failed to remove liquidity'));
    };
    
    mockDLMM.initializePositionAndAddLiquidityByStrategy = () => {
      addLiquidityCalled = true;
      return Promise.resolve({
        transaction: { serialize: () => Buffer.from([]) },
        signers: [],
      });
    };
    
    // We expect this to throw due to the error
    try {
      await agent.rebalance();
    } catch (error) {
      // Expected error
    }
    
    // Validate liquidity was not added after removal failed
    expect(addLiquidityCalled).toBe(false);
  });
  
  it('should handle case with no positions', async () => {
    // Set up tracking of function calls
    let removeLiquidityCalled = false;
    let addLiquidityCalled = false;
    
    // Override functions with tracking
    mockDLMM.getPositionsByUserAndLbPair = () => {
      return Promise.resolve({
        userPositions: [],
      });
    };
    
    mockDLMM.removeLiquidity = () => {
      removeLiquidityCalled = true;
      return Promise.resolve({
        transaction: { serialize: () => Buffer.from([]) },
        signers: [],
        amounts: { xAmount: new BN(0), yAmount: new BN(0) },
      });
    };
    
    mockDLMM.initializePositionAndAddLiquidityByStrategy = () => {
      addLiquidityCalled = true;
      return Promise.resolve({
        transaction: { serialize: () => Buffer.from([]) },
        signers: [],
      });
    };
    
    // Execute rebalance
    await agent.rebalance();
    
    // Validate early return
    expect(removeLiquidityCalled).toBe(false);
    expect(addLiquidityCalled).toBe(false);
  });
  
  it('should fall back to default parameters when Claude fails', async () => {
    // Set up tracking of function calls
    let addLiquidityCalled = false;
    let addLiquidityArgs = null;
    
    // Override functions with tracking
    mockClaudeService.getRebalanceRecommendation = () => {
      return Promise.reject(new Error('Claude service failed'));
    };
    
    mockDLMM.initializePositionAndAddLiquidityByStrategy = (args: any) => {
      addLiquidityCalled = true;
      addLiquidityArgs = args;
      return Promise.resolve({
        transaction: { serialize: () => Buffer.from([]) },
        signers: [],
      });
    };
    
    // Execute rebalance
    await agent.rebalance();
    
    // Validate default parameters were used
    expect(addLiquidityCalled).toBe(true);
    expect(addLiquidityArgs.strategy.maxBinId).toBe(1010); // Default range (1000 + 10)
    expect(addLiquidityArgs.strategy.minBinId).toBe(990);  // Default range (1000 - 10)
    // The actual value used is 0 for Spot strategy (which is the default)
    expect(addLiquidityArgs.strategy.strategyType).toBe(StrategyType.Spot); // Default from getStrategyType
  });
});