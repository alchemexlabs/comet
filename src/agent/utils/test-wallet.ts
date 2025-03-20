/**
 * Test Wallet Utility for Comet Agent
 * 
 * This utility helps create and manage test wallets for real money testing
 * with limited risk exposure.
 */

import { Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

interface TestWalletConfig {
  // Maximum USD value allowed in this wallet
  maxValueUsd: number;
  // Path to save wallet key file
  keyPath?: string;
  // Optional existing wallet private key
  existingPrivateKey?: string;
}

/**
 * Test wallet utility for real money testing with safety limits
 */
export class TestWallet {
  private keypair: Keypair;
  private config: TestWalletConfig;
  private currentValueUsd: number = 0;
  
  constructor(config: TestWalletConfig) {
    this.config = {
      maxValueUsd: config.maxValueUsd || 10, // Default $10 max
      keyPath: config.keyPath || path.join(process.cwd(), '.test-wallet.json')
    };
    
    // Create or load keypair
    if (config.existingPrivateKey) {
      this.keypair = Keypair.fromSecretKey(
        Uint8Array.from(Buffer.from(config.existingPrivateKey, 'base64'))
      );
      logger.info(`Loaded existing test wallet: ${this.keypair.publicKey.toString()}`); 
    } else {
      this.loadOrCreateKeypair();
    }
  }
  
  /**
   * Get the wallet keypair
   */
  getKeypair(): Keypair {
    return this.keypair;
  }
  
  /**
   * Update current wallet value
   */
  updateValue(valueUsd: number): boolean {
    this.currentValueUsd = valueUsd;
    
    // Check if value exceeds maximum
    if (this.currentValueUsd > this.config.maxValueUsd) {
      logger.warn(`Test wallet value ($${valueUsd.toFixed(2)}) exceeds maximum ($${this.config.maxValueUsd.toFixed(2)})`);
      return false;
    }
    
    return true;
  }
  
  /**
   * Get current wallet value
   */
  getCurrentValue(): number {
    return this.currentValueUsd;
  }
  
  /**
   * Check if a transaction would exceed the maximum value
   */
  canExecuteTransaction(additionalValueUsd: number): boolean {
    return (this.currentValueUsd + additionalValueUsd) <= this.config.maxValueUsd;
  }
  
  /**
   * Export wallet for backup
   */
  exportWallet(): string {
    const secretKey = Buffer.from(this.keypair.secretKey).toString('base64');
    return JSON.stringify({
      publicKey: this.keypair.publicKey.toString(),
      secretKey: secretKey
    }, null, 2);
  }
  
  /**
   * Load existing keypair or create a new one
   */
  private loadOrCreateKeypair(): void {
    try {
      // Check if wallet file exists
      if (fs.existsSync(this.config.keyPath)) {
        // Load existing wallet
        const walletData = JSON.parse(fs.readFileSync(this.config.keyPath, 'utf-8'));
        this.keypair = Keypair.fromSecretKey(
          Uint8Array.from(Buffer.from(walletData.secretKey, 'base64'))
        );
        logger.info(`Loaded test wallet from ${this.config.keyPath}: ${this.keypair.publicKey.toString()}`);
      } else {
        // Create new wallet
        this.keypair = Keypair.generate();
        
        // Save to file
        const walletData = {
          publicKey: this.keypair.publicKey.toString(),
          secretKey: Buffer.from(this.keypair.secretKey).toString('base64')
        };
        
        fs.writeFileSync(
          this.config.keyPath,
          JSON.stringify(walletData, null, 2),
          { mode: 0o600 } // Restrictive file permissions
        );
        
        logger.info(`Created new test wallet: ${this.keypair.publicKey.toString()}`);
        logger.info(`Secret key saved to ${this.config.keyPath} with restricted permissions`);
      }
    } catch (error) {
      logger.error('Error creating or loading test wallet:', error);
      // Fallback to creating in-memory wallet
      this.keypair = Keypair.generate();
      logger.info(`Created in-memory test wallet: ${this.keypair.publicKey.toString()}`);
    }
  }
}

export default TestWallet;