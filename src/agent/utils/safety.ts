/**
 * Safety mechanisms for Comet agent real money operations
 * 
 * This module implements safety features like stop-loss, position monitoring,
 * and emergency shutdown procedures.
 */

import { BN } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { logger } from './logger';

interface SafetyConfig {
  // Stop loss percentage (0-100)
  stopLossPercentage: number;
  // Max drawdown percentage before emergency shutdown (0-100)
  maxDrawdownPercentage: number;
  // Minimum value in USD to maintain
  minimumValueUsd: number;
  // Whether to enable emergency notifications
  enableNotifications: boolean;
  // Email to send notifications to
  notificationEmail?: string;
}

/**
 * Safety manager for real money operations
 */
export class SafetyManager {
  private config: SafetyConfig;
  private initialValueUsd: number;
  private peakValueUsd: number;
  private currentValueUsd: number;
  private lastUpdateTime: number = 0;
  private stopLossTriggered: boolean = false;
  private emergencyShutdownTriggered: boolean = false;
  
  constructor(initialValueUsd: number, config: Partial<SafetyConfig> = {}) {
    // Configure with sensible defaults
    this.config = {
      stopLossPercentage: config.stopLossPercentage || 10,
      maxDrawdownPercentage: config.maxDrawdownPercentage || 20,
      minimumValueUsd: config.minimumValueUsd || 90, // $90 minimum for $100 starting capital
      enableNotifications: config.enableNotifications || false,
      notificationEmail: config.notificationEmail
    };
    
    this.initialValueUsd = initialValueUsd;
    this.peakValueUsd = initialValueUsd;
    this.currentValueUsd = initialValueUsd;
    
    logger.info(`Safety manager initialized with ${initialValueUsd.toFixed(2)} USD starting value`);
    logger.info(`Stop loss: ${this.config.stopLossPercentage}%, Max drawdown: ${this.config.maxDrawdownPercentage}%`);
  }
  
  /**
   * Update portfolio value and check safety conditions
   */
  updateValue(newValueUsd: number): void {
    this.currentValueUsd = newValueUsd;
    this.lastUpdateTime = Date.now();
    
    // Update peak value if current value is higher
    if (newValueUsd > this.peakValueUsd) {
      this.peakValueUsd = newValueUsd;
    }
    
    // Log current status
    const changeFromInitial = ((newValueUsd - this.initialValueUsd) / this.initialValueUsd) * 100;
    const changeFromPeak = ((newValueUsd - this.peakValueUsd) / this.peakValueUsd) * 100;
    
    logger.info(`Portfolio value: $${newValueUsd.toFixed(2)} (${changeFromInitial.toFixed(2)}% from initial, ${changeFromPeak.toFixed(2)}% from peak)`);
    
    // Check safety conditions
    this.checkSafetyConditions();
  }
  
  /**
   * Check for stop loss and drawdown conditions
   */
  private checkSafetyConditions(): void {
    // Check for minimum value breach
    if (this.currentValueUsd < this.config.minimumValueUsd) {
      logger.error(`ALERT: Portfolio value (${this.currentValueUsd.toFixed(2)}) below minimum threshold (${this.config.minimumValueUsd.toFixed(2)})`);
      this.triggerStopLoss();
      return;
    }
    
    // Calculate drawdown from peak
    const drawdownPercent = ((this.peakValueUsd - this.currentValueUsd) / this.peakValueUsd) * 100;
    
    // Check for max drawdown
    if (drawdownPercent > this.config.maxDrawdownPercentage) {
      logger.error(`ALERT: Maximum drawdown exceeded (${drawdownPercent.toFixed(2)}% > ${this.config.maxDrawdownPercentage}%)`);
      this.triggerEmergencyShutdown();
      return;
    }
    
    // Calculate loss from initial value
    const lossPercent = ((this.initialValueUsd - this.currentValueUsd) / this.initialValueUsd) * 100;
    
    // Check for stop loss
    if (lossPercent > this.config.stopLossPercentage) {
      logger.error(`ALERT: Stop loss triggered (${lossPercent.toFixed(2)}% loss)`);
      this.triggerStopLoss();
      return;
    }
  }
  
  /**
   * Trigger stop loss procedure
   */
  private triggerStopLoss(): void {
    if (this.stopLossTriggered) {
      return; // Already triggered
    }
    
    this.stopLossTriggered = true;
    logger.error('STOP LOSS TRIGGERED - Initiating position exit');
    
    // Notify if enabled
    if (this.config.enableNotifications && this.config.notificationEmail) {
      this.sendNotification(
        'Comet Agent Stop Loss Triggered', 
        `Stop loss triggered at ${new Date().toISOString()}. Portfolio value: $${this.currentValueUsd.toFixed(2)}`
      );
    }
    
    // In a real implementation, this would initiate liquidation of positions
  }
  
  /**
   * Trigger emergency shutdown procedure
   */
  private triggerEmergencyShutdown(): void {
    if (this.emergencyShutdownTriggered) {
      return; // Already triggered
    }
    
    this.emergencyShutdownTriggered = true;
    logger.error('EMERGENCY SHUTDOWN TRIGGERED - Halting all operations');
    
    // Notify if enabled
    if (this.config.enableNotifications && this.config.notificationEmail) {
      this.sendNotification(
        'Comet Agent Emergency Shutdown', 
        `Emergency shutdown triggered at ${new Date().toISOString()}. Portfolio value: $${this.currentValueUsd.toFixed(2)}`
      );
    }
    
    // In a real implementation, this would halt all operations and liquidate positions
  }
  
  /**
   * Check if stop loss has been triggered
   */
  isStopLossTriggered(): boolean {
    return this.stopLossTriggered;
  }
  
  /**
   * Check if emergency shutdown has been triggered
   */
  isEmergencyShutdownTriggered(): boolean {
    return this.emergencyShutdownTriggered;
  }
  
  /**
   * Reset stop loss (for testing or after manual intervention)
   */
  resetStopLoss(): void {
    this.stopLossTriggered = false;
    logger.info('Stop loss reset');
  }
  
  /**
   * Send notification 
   */
  private sendNotification(subject: string, message: string): void {
    // In a real implementation, this would send an email or other notification
    logger.info(`Would send notification: ${subject} - ${message}`);
  }
  
  /**
   * Get safety report with current status
   */
  getSafetyReport(): Record<string, any> {
    const drawdownPercent = ((this.peakValueUsd - this.currentValueUsd) / this.peakValueUsd) * 100;
    const lossPercent = ((this.initialValueUsd - this.currentValueUsd) / this.initialValueUsd) * 100;
    
    return {
      currentValue: this.currentValueUsd,
      initialValue: this.initialValueUsd,
      peakValue: this.peakValueUsd,
      drawdownPercent,
      lossPercent,
      stopLossTriggered: this.stopLossTriggered,
      emergencyShutdownTriggered: this.emergencyShutdownTriggered,
      lastUpdateTime: this.lastUpdateTime,
      config: this.config
    };
  }
}

export default SafetyManager;