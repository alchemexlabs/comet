/**
 * Claude AI service for enhanced decision making in the Comet agent
 */

import { Anthropic } from '@anthropic-ai/sdk';
import { BN } from '@coral-xyz/anchor';
import { StrategyType } from '../../dlmm/types';
import { logger } from './logger';
import { rateLimiter } from './rate-limiter';
import axios from 'axios';

interface ClaudeConfig {
  apiKey: string;
  model: string; // claude-3-haiku-20240307, claude-3-sonnet-20240229, claude-3-opus-20240229
  temperature?: number;
  maxTokens?: number;
  mcpServer?: string;
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
      mcpServer: config.mcpServer || process.env.MCP_SERVER_URL || 'http://localhost:3003',
    };
    
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
    
    logger.info(`Initialized ClaudeAI service with model: ${config.model}`);
    
    if (this.config.mcpServer) {
      logger.info(`MCP Server configured at: ${this.config.mcpServer}`);
    }
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
   * Generate market analysis for a token
   */
  async generateMarketAnalysis(
    tokenSymbol: string,
    currentPrice: number
  ): Promise<string> {
    try {
      logger.info(`Requesting market analysis for ${tokenSymbol}`);
      
      // Apply rate limiting to Claude API calls
      const response = await rateLimiter.limit('claude:api', async () => {
        return this.client.messages.create({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          system: `You are an expert crypto market analyst specialized in Solana tokens.
          
Your task is to provide a concise but insightful market analysis for a specific token.

Your response should include:
1. Current market sentiment and trend
2. Key price levels to watch
3. Recent developments affecting the token (if known)
4. A short-term outlook (1-7 days)
5. Risks and opportunities

Keep your analysis practical, data-driven, and focused on information that would be useful for a liquidity provider.
Avoid making specific price predictions, and acknowledge limitations in your information.`,
          messages: [
            {
              role: "user",
              content: `Please provide a market analysis for ${tokenSymbol}.
              
Current price: $${currentPrice}

What's your assessment of the current market conditions for this token and the key factors a liquidity provider should consider?`
            }
          ]
        });
      });
      
      // Return the text response
      return response.content[0].text;
    } catch (error) {
      logger.error('Error generating market analysis with Claude:', error);
      return 'Unable to generate market analysis at this time. Please try again later.';
    }
  }
  
  /**
   * Generate pool analysis for a token pair
   */
  async generatePoolAnalysis(
    tokenX: string,
    tokenY: string,
    currentPrice: number,
    binStep: number
  ): Promise<string> {
    try {
      logger.info(`Requesting pool analysis for ${tokenX}/${tokenY}`);
      
      // Apply rate limiting to Claude API calls
      const response = await rateLimiter.limit('claude:api', async () => {
        return this.client.messages.create({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          system: `You are an expert in automated market making and liquidity provision strategies for Meteora DLMM pools.
          
Your task is to analyze a specific pool and provide optimization recommendations.

For context:
- DLMM (Dynamic Liquidity Market Maker) pools use discrete price bins
- Each bin represents a specific price level
- Bin step determines the price difference between adjacent bins
- Liquidity can be concentrated around specific price ranges
- Different strategies (Spot, BidAsk, Curve) distribute liquidity differently

Your analysis should include:
1. Optimal bin range recommendations based on the token pair
2. Strategy recommendations (Spot, BidAsk, or Curve)
3. Fee optimization suggestions
4. Rebalancing frequency recommendations
5. Risk management considerations`,
          messages: [
            {
              role: "user",
              content: `Please analyze the following pool and provide optimization recommendations:
              
Token Pair: ${tokenX}/${tokenY}
Current Price: $${currentPrice}
Bin Step: ${binStep}%

How can I optimize my liquidity provision strategy for this pool?`
            }
          ]
        });
      });
      
      // Return the text response
      return response.content[0].text;
    } catch (error) {
      logger.error('Error generating pool analysis with Claude:', error);
      return 'Unable to generate pool analysis at this time. Please try again later.';
    }
  }
  
  /**
   * Generate strategy analysis for simulations
   */
  async generateStrategyAnalysis(
    strategy: string,
    initialAmount: number,
    days: number,
    finalAmount: number
  ): Promise<string> {
    try {
      logger.info(`Requesting strategy analysis for ${strategy}`);
      
      // Apply rate limiting to Claude API calls
      const response = await rateLimiter.limit('claude:api', async () => {
        return this.client.messages.create({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          system: `You are an expert in DeFi liquidity provision strategies and performance analysis.
          
Your task is to analyze a strategy simulation and provide insights.

For context:
- Strategies include Spot (even distribution), BidAsk (concentrated at active bin), and Curve (normal distribution)
- Different market conditions favor different strategies
- Returns are affected by volatility, trading volume, and price trends
- Risk varies by strategy and market conditions

Your analysis should include:
1. Key strengths and weaknesses of the strategy
2. Market conditions where this strategy excels
3. Risk assessment
4. Comparison to alternative strategies
5. Optimization suggestions`,
          messages: [
            {
              role: "user",
              content: `Please analyze the following strategy simulation results:
              
Strategy: ${strategy}
Initial Investment: $${initialAmount.toFixed(2)}
Time Period: ${days} days
Final Value: $${finalAmount.toFixed(2)}
Profit: $${(finalAmount - initialAmount).toFixed(2)} (${(((finalAmount / initialAmount) - 1) * 100).toFixed(2)}%)
Annualized Return: ${(((finalAmount / initialAmount) - 1) * 100 * 365 / days).toFixed(2)}%

What insights can you provide about this strategy based on these results?`
            }
          ]
        });
      });
      
      // Return the text response
      return response.content[0].text;
    } catch (error) {
      logger.error('Error generating strategy analysis with Claude:', error);
      return 'Unable to generate strategy analysis at this time. Please try again later.';
    }
  }
  
  /**
   * Generate agent response for CLI
   */
  async generateAgentResponse(
    userQuery: string,
    contextInfo: string
  ): Promise<string> {
    try {
      logger.info('Generating agent response for user query');
      
      // Fetch additional context from MCP server if available
      let mcpContext = '';
      if (this.config.mcpServer) {
        try {
          const mcpResponse = await rateLimiter.limit('mcp:api', async () => {
            return axios.get(`${this.config.mcpServer}/api/claude-context`);
          });
          
          if (mcpResponse.data) {
            logger.debug('Received context data from MCP server');
            
            // Format MCP context data
            const mcpData = mcpResponse.data;
            mcpContext = `
## Additional Context from MCP Server
Last Updated: ${new Date(mcpData.timestamp).toISOString()}

${mcpData.portfolio && mcpData.portfolio.positions ? 
  `### Portfolio Information
Total Value: ${mcpData.portfolio.totalValue || 'N/A'}
Active Positions: ${mcpData.portfolio.positions.length || 0}` : ''}

${mcpData.pools && mcpData.pools.pools ? 
  `### Active Pools
Total Pools: ${mcpData.pools.pools.length || 0}` : ''}

${Object.keys(mcpData.market || {}).length > 0 ? 
  `### Market Data
Available Pairs: ${Object.keys(mcpData.market).join(', ')}` : ''}
`;
          }
        } catch (error) {
          logger.warn('Failed to fetch context from MCP server', error);
          // Continue without MCP context
        }
      }
      
      // Combine user-provided context with MCP context
      const fullContext = contextInfo + (mcpContext ? '\n\n' + mcpContext : '');
      
      // Apply rate limiting to Claude API calls
      const response = await rateLimiter.limit('claude:api', async () => {
        return this.client.messages.create({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          system: `You are Comet, an intelligent autonomous liquidity agent assistant for DeFi on Solana.
          
Your primary purpose is to help users:
1. Understand their liquidity positions and portfolio
2. Provide market insights and analysis
3. Make recommendations to optimize strategies
4. Explain DeFi and DLMM concepts
5. Assist with making informed decisions about liquidity provision

Keep your responses:
- Concise but informative
- Practical and actionable
- Focused on the user's question
- Balanced in terms of opportunities and risks

You have access to information about the user's current portfolio, positions, and market data.
Base your responses on this information when available, but be transparent about what you don't know.

When discussing returns or performance, always acknowledge the inherent risks of DeFi.
Avoid making specific price predictions or promises of returns.`,
          messages: [
            {
              role: "user",
              content: `Here's information about my current state:

${fullContext}

My question is: ${userQuery}`
            }
          ]
        });
      });
      
      // Return the text response
      return response.content[0].text;
    } catch (error) {
      logger.error('Error generating agent response with Claude:', error);
      return 'I apologize, but I\'m having trouble processing your request at the moment. Please try again later or use one of the specific commands listed in /help.';
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