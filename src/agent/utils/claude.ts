/**
 * Claude AI service for enhanced decision making in the Comet agent
 */

import { Anthropic } from '@anthropic-ai/sdk';
import { BN } from '@coral-xyz/anchor';
import { StrategyType } from '../../dlmm/types';
import { logger } from './logger';
import { rateLimiter } from './rate-limiter';

interface ClaudeConfig {
  apiKey: string;
  model: string; // claude-3-haiku-20240307, claude-3-sonnet-20240229, claude-3-opus-20240229
  temperature?: number;
  maxTokens?: number;
}

interface MarketData {
  activeBinId: number;
  binStep: number;
  currentPrice: number;
  tokenXSymbol: string;
  tokenYSymbol: string;
  priceHistory: {
    timestamp: number;
    price: number;
  }[];
  volumeHistory: {
    timestamp: number;
    volume: number;
  }[];
  marketVolatility: number;
  marketTrend: string; // "bullish", "bearish", "sideways"
}

interface RebalanceRecommendation {
  shouldRebalance: boolean;
  reason: string;
  strategy: StrategyType;
  binRange: number;
  minBinId: number;
  maxBinId: number;
  xWeighting: number; // 0-100%
  yWeighting: number; // 0-100%
  confidence: number; // 0-100%
}

/**
 * Claude AI service for enhanced decision making
 */
export class ClaudeService {
  private client: Anthropic;
  private config: ClaudeConfig;

  constructor(config: ClaudeConfig) {
    this.config = {
      ...config,
      temperature: config.temperature || 0.1,
      maxTokens: config.maxTokens || 1024,
    };
    
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
    
    logger.info(`Initialized ClaudeAI service with model: ${config.model}`);
  }

  /**
   * Analyze market data and provide rebalancing recommendations
   */
  async getRebalanceRecommendation(marketData: MarketData): Promise<RebalanceRecommendation> {
    try {
      logger.info('Requesting rebalance recommendation from Claude AI');
      
      const prompt = this.buildMarketAnalysisPrompt(marketData);
      
      // Apply rate limiting to Claude API calls
      const response = await rateLimiter.limit('claude:api', async () => {
        logger.debug('Making Claude API call for rebalance recommendation');
        return this.client.messages.create({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          system: "You are a specialized financial AI for DeFi liquidity management. Your task is to analyze market data and provide optimal strategies for liquidity distribution in Meteora DLMM pools.",
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
          response_format: { type: "json_object" }
        });
      });
      
      // Parse the response
      const content = response.content[0].text;
      const recommendation = JSON.parse(content) as RebalanceRecommendation;
      
      logger.debug(`Received rebalance recommendation: ${JSON.stringify(recommendation)}`);
      
      return recommendation;
    } catch (error) {
      logger.error('Failed to get recommendation from Claude AI', error);
      
      // Return a default recommendation if API fails
      return {
        shouldRebalance: false,
        reason: "AI analysis failed, defaulting to conservatism",
        strategy: StrategyType.Spot, // Default to the safest strategy
        binRange: 10,
        minBinId: marketData.activeBinId - 10,
        maxBinId: marketData.activeBinId + 10,
        xWeighting: 50,
        yWeighting: 50,
        confidence: 0
      };
    }
  }

  /**
   * Generate strategy parameters based on market conditions and risk profile
   */
  async generateStrategyParameters(
    strategyType: StrategyType,
    marketData: MarketData,
    riskProfile: string = 'moderate'
  ): Promise<{
    binRange: number,
    minBinId: number,
    maxBinId: number,
    weights: number[]
  }> {
    try {
      logger.info(`Requesting strategy parameters from Claude AI for ${strategyType}`);
      
      const prompt = this.buildStrategyParametersPrompt(strategyType, marketData, riskProfile);
      
      // Apply rate limiting to Claude API calls
      const response = await rateLimiter.limit('claude:api', async () => {
        logger.debug('Making Claude API call for strategy parameters');
        return this.client.messages.create({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          system: "You are a specialized financial AI for DeFi liquidity management. Your task is to generate optimal distribution parameters for liquidity in Meteora DLMM pools.",
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
          response_format: { type: "json_object" }
        });
      });
      
      // Parse the response
      const content = response.content[0].text;
      const parameters = JSON.parse(content) as {
        binRange: number,
        minBinId: number,
        maxBinId: number,
        weights: number[]
      };
      
      logger.debug(`Received strategy parameters: ${JSON.stringify(parameters)}`);
      
      return parameters;
    } catch (error) {
      logger.error('Failed to get strategy parameters from Claude AI', error);
      
      // Return default parameters if API fails
      const binRange = 10;
      return {
        binRange,
        minBinId: marketData.activeBinId - binRange,
        maxBinId: marketData.activeBinId + binRange,
        weights: Array(2 * binRange + 1).fill(1) // Equal weighting
      };
    }
  }

  /**
   * Build prompt for market analysis
   */
  private buildMarketAnalysisPrompt(marketData: MarketData): string {
    return `
I need you to analyze the following market data for a Meteora DLMM liquidity pool and provide a recommendation for rebalancing:

## Current Market Data
- Trading Pair: ${marketData.tokenXSymbol}/${marketData.tokenYSymbol}
- Current Price: ${marketData.currentPrice}
- Active Bin ID: ${marketData.activeBinId}
- Bin Step: ${marketData.binStep}
- Market Volatility: ${marketData.marketVolatility}%
- Market Trend: ${marketData.marketTrend}

## Price History (last 10 data points)
${marketData.priceHistory.slice(-10).map(p => `- ${new Date(p.timestamp).toISOString()}: ${p.price}`).join('\n')}

## Volume History (last 10 data points)
${marketData.volumeHistory.slice(-10).map(v => `- ${new Date(v.timestamp).toISOString()}: ${v.volume}`).join('\n')}

Based on this data, please provide a rebalancing recommendation in JSON format with the following fields:
- shouldRebalance: boolean indicating if rebalancing is recommended
- reason: explanation for the recommendation
- strategy: optimal strategy type ("Spot", "BidAsk", or "Curve")
- binRange: recommended bin range from active bin
- minBinId: minimum bin ID for the position
- maxBinId: maximum bin ID for the position
- xWeighting: recommended percentage allocation for token X (0-100)
- yWeighting: recommended percentage allocation for token Y (0-100)
- confidence: your confidence level in this recommendation (0-100)

Your recommendation should optimize for capital efficiency, fee generation, and minimizing impermanent loss based on the current market conditions.
`;
  }

  /**
   * Build prompt for strategy parameters
   */
  private buildStrategyParametersPrompt(
    strategyType: StrategyType,
    marketData: MarketData,
    riskProfile: string
  ): string {
    return `
I need you to generate optimal strategy parameters for a Meteora DLMM liquidity position with the following details:

## Strategy and Market Data
- Strategy Type: ${strategyType}
- Trading Pair: ${marketData.tokenXSymbol}/${marketData.tokenYSymbol}
- Current Price: ${marketData.currentPrice}
- Active Bin ID: ${marketData.activeBinId}
- Bin Step: ${marketData.binStep}
- Market Volatility: ${marketData.marketVolatility}%
- Market Trend: ${marketData.marketTrend}
- Risk Profile: ${riskProfile}

Based on this information, please generate optimal parameters in JSON format with the following fields:
- binRange: optimal number of bins to each side of active bin
- minBinId: minimum bin ID for the position
- maxBinId: maximum bin ID for the position
- weights: array of weight values for each bin from minBinId to maxBinId

For the weights, consider:
- For Spot strategy: Even distribution around the active bin
- For BidAsk strategy: Concentrate at the active bin and spread out
- For Curve strategy: Normal distribution around the active bin

The weights should sum to the total number of weights and represent the relative distribution of liquidity. Optimize for the given risk profile and market conditions.
`;
  }
}

export default ClaudeService;