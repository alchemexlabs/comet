/**
 * Strategy implementations for the Comet agent
 */

import { BN } from '@coral-xyz/anchor';
import { StrategyType } from '../dlmm/types';
import { logger } from './utils/logger';

interface StrategyParams {
  activeBinId: number;
  binStep: number;
  xAmount: BN;
  yAmount: BN;
  minBinId: number;
  maxBinId: number;
  strategyType: StrategyType;
}

/**
 * Auto-fill Y amount based on strategy
 * This is used to determine the Y amount to add based on the X amount,
 * active bin, and strategy parameters.
 * 
 * @param params - Strategy parameters
 * @returns The calculated Y amount
 */
export function autoFillYByStrategy(params: StrategyParams): BN {
  const {
    activeBinId,
    binStep,
    xAmount,
    minBinId,
    maxBinId,
    strategyType
  } = params;

  logger.debug(`Auto-filling Y by strategy: ${strategyType}`);

  switch (strategyType) {
    case StrategyType.Spot:
      return calculateSpotStrategy(activeBinId, binStep, xAmount, minBinId, maxBinId);
    
    case StrategyType.BidAsk:
      return calculateBidAskStrategy(activeBinId, binStep, xAmount, minBinId, maxBinId);
    
    case StrategyType.Curve:
      return calculateCurveStrategy(activeBinId, binStep, xAmount, minBinId, maxBinId);
    
    default:
      logger.warn(`Unknown strategy type: ${strategyType}, defaulting to Spot`);
      return calculateSpotStrategy(activeBinId, binStep, xAmount, minBinId, maxBinId);
  }
}

/**
 * Calculate Y amount for Spot strategy
 * Spot strategy distributes liquidity evenly around the active bin
 */
function calculateSpotStrategy(
  activeBinId: number,
  binStep: number,
  xAmount: BN,
  minBinId: number,
  maxBinId: number
): BN {
  // Implementation for even distribution around active bin
  // This is a simplified placeholder implementation
  
  // Calculate bin range
  const totalBins = maxBinId - minBinId + 1;
  
  // For demonstration, we'll calculate a Y amount that's proportional to X
  // In a real implementation, this would consider the active bin price and bin step
  const yAmount = xAmount.mul(new BN(totalBins));
  
  logger.debug(`Spot strategy: Active=${activeBinId}, Min=${minBinId}, Max=${maxBinId}, X=${xAmount}, Y=${yAmount}`);
  
  return yAmount;
}

/**
 * Calculate Y amount for BidAsk strategy
 * BidAsk strategy concentrates liquidity at the active bin and spread out from there
 */
function calculateBidAskStrategy(
  activeBinId: number,
  binStep: number,
  xAmount: BN,
  minBinId: number,
  maxBinId: number
): BN {
  // Implementation for bid-ask focused distribution
  // This is a simplified placeholder implementation
  
  // Calculate total bins
  const totalBins = maxBinId - minBinId + 1;
  
  // For demonstration, we'll use a different ratio than the spot strategy
  const yAmount = xAmount.mul(new BN(totalBins)).mul(new BN(2));
  
  logger.debug(`BidAsk strategy: Active=${activeBinId}, Min=${minBinId}, Max=${maxBinId}, X=${xAmount}, Y=${yAmount}`);
  
  return yAmount;
}

/**
 * Calculate Y amount for Curve strategy
 * Curve strategy distributes liquidity in a normal distribution around active bin
 */
function calculateCurveStrategy(
  activeBinId: number,
  binStep: number,
  xAmount: BN,
  minBinId: number,
  maxBinId: number
): BN {
  // Implementation for normal distribution around active bin
  // This is a simplified placeholder implementation
  
  // Calculate total bins
  const totalBins = maxBinId - minBinId + 1;
  
  // For demonstration, we'll use a different ratio than the other strategies
  const yAmount = xAmount.mul(new BN(totalBins)).div(new BN(2));
  
  logger.debug(`Curve strategy: Active=${activeBinId}, Min=${minBinId}, Max=${maxBinId}, X=${xAmount}, Y=${yAmount}`);
  
  return yAmount;
}

/**
 * Calculate optimal bin range based on volatility
 * 
 * @param volatility - Asset volatility percentage
 * @param binStep - Bin step size
 * @returns Optimal number of bins to each side of active bin
 */
export function calculateOptimalBinRange(volatility: number, binStep: number): number {
  // Simple calculation based on volatility and bin step
  // Higher volatility or smaller bin steps require wider ranges
  
  // Convert volatility to decimal (e.g., 5% -> 0.05)
  const volatilityDecimal = volatility / 100;
  
  // Calculate number of bins needed to cover the price range expected from volatility
  // This is a simplified approach
  const binsNeeded = Math.ceil(volatilityDecimal * 100 / binStep);
  
  // Ensure a minimum number of bins
  return Math.max(5, binsNeeded);
}