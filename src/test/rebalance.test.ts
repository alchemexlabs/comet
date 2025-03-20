import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { Comet } from '../agent';
import { StrategyType } from '../dlmm/types';
import { DLMM } from '../dlmm';
import { ClaudeService } from '../agent/utils/claude';
import { assertPosition } from './helper';

// Mock implementations
jest.mock('../agent/utils/claude');
jest.mock('../agent/utils/transaction', () => ({
  sendTransactionWithPriorityFee: jest.fn().mockResolvedValue('mock-transaction-signature'),
  confirmTransactionWithTimeout: jest.fn().mockResolvedValue(null),
}));
jest.mock('../agent/utils/database', () => ({
  recordRebalanceEvent: jest.fn().mockResolvedValue(null),
  recordPoolMetrics: jest.fn().mockResolvedValue(null),
}));
jest.mock('../agent/utils/price', () => ({
  getPriceFromBirdeye: jest.fn().mockResolvedValue(1.0),
}));

describe('Comet Agent Rebalance', () => {
  let agent: Comet;
  let mockDLMM: jest.Mocked<DLMM>;
  let mockConnection: jest.Mocked<Connection>;
  let mockClaudeService: jest.Mocked<ClaudeService>;
  let wallet: Keypair;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock wallet
    wallet = Keypair.generate();
    
    // Mock DLMM
    mockDLMM = {
      getActiveBin: jest.fn().mockResolvedValue({
        binId: 1000,
        price: '100.0',
      }),
      getPositionsByUserAndLbPair: jest.fn().mockResolvedValue({
        userPositions: [
          {
            publicKey: new PublicKey('11111111111111111111111111111111'),
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
      getPositionLiquidity: jest.fn().mockResolvedValue({
        liquidityAmount: new BN(1000),
      }),
      removeLiquidity: jest.fn().mockResolvedValue({
        transaction: { serialize: () => Buffer.from([]) },
        signers: [],
        amounts: {
          xAmount: new BN(1000),
          yAmount: new BN(1000),
        },
      }),
      initializePositionAndAddLiquidityByStrategy: jest.fn().mockResolvedValue({
        transaction: { serialize: () => Buffer.from([]) },
        signers: [],
      }),
      lbPair: {
        tokenX: { mint: new PublicKey('11111111111111111111111111111111') },
        tokenY: { mint: new PublicKey('22222222222222222222222222222222') },
        binStep: new BN(10),
        activeId: new BN(1000),
        feeParameter: new BN(1),
        reserveX: new BN(10000),
        reserveY: new BN(10000),
        publicKey: new PublicKey('33333333333333333333333333333333'),
      },
      refetchStates: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<DLMM>;
    
    // Mock Connection
    mockConnection = {
      getConnection: jest.fn().mockReturnValue({
        sendRawTransaction: jest.fn().mockResolvedValue('mock-transaction-signature'),
        confirmTransaction: jest.fn().mockResolvedValue({ value: { err: null } }),
      }),
    } as unknown as jest.Mocked<Connection>;
    
    // Mock Claude Service
    mockClaudeService = {
      getRebalanceRecommendation: jest.fn().mockResolvedValue({
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
    } as unknown as jest.Mocked<ClaudeService>;
    
    // Create Comet agent with mocked dependencies
    agent = new Comet({
      poolAddress: '33333333333333333333333333333333',
      walletKey: wallet.secretKey.toString(),
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
    // Execute rebalance
    await agent.rebalance();
    
    // Validate Claude service was called
    expect(mockClaudeService.getRebalanceRecommendation).toHaveBeenCalled();
    
    // Validate liquidity was removed
    expect(mockDLMM.getPositionLiquidity).toHaveBeenCalled();
    expect(mockDLMM.removeLiquidity).toHaveBeenCalled();
    
    // Validate new position was created with optimized strategy
    expect(mockDLMM.initializePositionAndAddLiquidityByStrategy).toHaveBeenCalledWith({
      positionPubKey: expect.any(PublicKey),
      user: wallet.publicKey,
      totalXAmount: expect.any(BN),
      totalYAmount: expect.any(BN),
      strategy: {
        maxBinId: 1015, // Claude recommended range
        minBinId: 985,  // Claude recommended range
        strategyType: StrategyType.BidAsk, // Claude recommended strategy
      },
    });
    
    // Validate last rebalance time was updated
    expect((agent as any).lastRebalanceTime).toBeGreaterThan(0);
  });
  
  it('should handle failed liquidity removal', async () => {
    // Mock error for liquidity removal
    mockDLMM.removeLiquidity.mockRejectedValueOnce(new Error('Failed to remove liquidity'));
    
    // Execute rebalance - should continue despite error with single position
    await agent.rebalance();
    
    // Validate liquidity was still attempted to be added (since we mocked a single position)
    expect(mockDLMM.initializePositionAndAddLiquidityByStrategy).not.toHaveBeenCalled();
  });
  
  it('should handle case with no positions', async () => {
    // Mock empty positions
    mockDLMM.getPositionsByUserAndLbPair.mockResolvedValueOnce({
      userPositions: [],
    });
    
    // Execute rebalance
    await agent.rebalance();
    
    // Validate early return
    expect(mockDLMM.removeLiquidity).not.toHaveBeenCalled();
    expect(mockDLMM.initializePositionAndAddLiquidityByStrategy).not.toHaveBeenCalled();
  });
  
  it('should fall back to default parameters when Claude fails', async () => {
    // Mock Claude service failure
    mockClaudeService.getRebalanceRecommendation.mockRejectedValueOnce(new Error('Claude service failed'));
    
    // Execute rebalance
    await agent.rebalance();
    
    // Validate default parameters were used
    expect(mockDLMM.initializePositionAndAddLiquidityByStrategy).toHaveBeenCalledWith({
      positionPubKey: expect.any(PublicKey),
      user: wallet.publicKey,
      totalXAmount: expect.any(BN),
      totalYAmount: expect.any(BN),
      strategy: {
        maxBinId: 1010, // Default range (1000 + 10)
        minBinId: 990,  // Default range (1000 - 10)
        strategyType: StrategyType.BidAsk, // Default from config
      },
    });
  });
});