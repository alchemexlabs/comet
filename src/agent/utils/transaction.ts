/**
 * Transaction utilities for the Comet agent
 * 
 * This handles transaction building, signing, and sending with optimized
 * priority fees to ensure on-chain landing.
 */

import { 
  Connection, 
  PublicKey, 
  Keypair, 
  Transaction, 
  TransactionInstruction,
  ComputeBudgetProgram,
  SignatureResult,
  sendAndConfirmTransaction,
  Signer,
  TransactionMessage,
  VersionedTransaction
} from '@solana/web3.js';
import axios from 'axios';
import { logger } from './logger';
import { rateLimiter } from './rate-limiter';
import { retry } from './helpers';
import RateLimitedConnection from './connection';

// Priority fee levels
export enum PriorityLevel {
  MIN = 'min',
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  VERY_HIGH = 'veryHigh',
  UNSAFE_MAX = 'unsafeMax'
}

// Network congestion levels
export enum NetworkCongestion {
  LOW = 'low',
  MODERATE = 'moderate',
  HIGH = 'high',
  VERY_HIGH = 'veryHigh'
}

/**
 * Priority fee estimation response
 */
interface PriorityFeeResponse {
  priorityFeeEstimate: number;
  priorityFeeLevels?: {
    min: number;
    low: number;
    medium: number;
    high: number;
    veryHigh: number;
    unsafeMax: number;
  };
  medianHistoricalFee?: number;
}

/**
 * Options for priority fee estimation
 */
interface PriorityFeeOptions {
  priorityLevel?: PriorityLevel;
  includeAllPriorityFeeLevels?: boolean;
  lookbackSlots?: number;  // 1-150, default 150
  includeVote?: boolean;
  recommended?: boolean;
  evaluateEmptySlotAsZero?: boolean;
  includeDetails?: boolean;
}

/**
 * Get priority fee estimate using Helius API or direct RPC call
 */
export async function getPriorityFeeEstimate(
  connection: RateLimitedConnection | Connection,
  transaction: Transaction,
  options: PriorityFeeOptions = { recommended: true }
): Promise<PriorityFeeResponse> {
  try {
    // If we have a RateLimitedConnection, use its underlying connection
    const useConnection = 'getConnection' in connection 
      ? (connection as RateLimitedConnection).getConnection() 
      : connection;

    // Serialize the transaction for more accurate fee estimation
    const serializedTransaction = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false
    }).toString('base64');

    // Build request payload
    const payload = {
      jsonrpc: '2.0',
      id: 'comet-' + Date.now(),
      method: 'getPriorityFeeEstimate',
      params: [
        {
          transaction: serializedTransaction,
          options: {
            ...options,
            transactionEncoding: 'base64'
          }
        }
      ]
    };

    // Get endpoint URL from connection
    const endpoint = useConnection.rpcEndpoint;

    // Use axios for the request with rate limiting
    const response = await rateLimiter.limit('helius:api', async () => {
      return axios.post(endpoint, payload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      });
    });

    if (response.data.error) {
      throw new Error(`Priority fee estimation failed: ${response.data.error.message}`);
    }

    const result = response.data.result;
    logger.debug(`Priority fee estimate: ${JSON.stringify(result)}`);
    
    return result;
  } catch (error) {
    logger.error('Error estimating priority fee:', error);
    
    // Return default values as fallback
    return {
      priorityFeeEstimate: 10000, // 10,000 micro-lamports per CU as safe default
      priorityFeeLevels: {
        min: 1,
        low: 5000,
        medium: 10000,
        high: 100000,
        veryHigh: 1000000,
        unsafeMax: 5000000
      }
    };
  }
}

/**
 * Estimate the current network congestion level based on priority fees
 */
export async function estimateNetworkCongestion(
  connection: RateLimitedConnection | Connection
): Promise<NetworkCongestion> {
  try {
    // Create a minimal transaction to estimate fees
    const dummyTransaction = new Transaction();
    
    // Add a no-op instruction to make it valid
    dummyTransaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 })
    );
    
    // Get fee estimates for all levels
    const feeEstimate = await getPriorityFeeEstimate(
      connection,
      dummyTransaction,
      { 
        includeAllPriorityFeeLevels: true,
        recommended: true 
      }
    );
    
    // Determine congestion based on medium priority fee
    const mediumFee = feeEstimate.priorityFeeLevels?.medium || 0;
    
    if (mediumFee <= 5000) {
      return NetworkCongestion.LOW;
    } else if (mediumFee <= 50000) {
      return NetworkCongestion.MODERATE;
    } else if (mediumFee <= 500000) {
      return NetworkCongestion.HIGH;
    } else {
      return NetworkCongestion.VERY_HIGH;
    }
  } catch (error) {
    logger.error('Error estimating network congestion:', error);
    // Default to moderate congestion on error
    return NetworkCongestion.MODERATE;
  }
}

/**
 * Get priority fee level based on transaction importance and network congestion
 */
export function determinePriorityLevel(
  transactionImportance: 'low' | 'medium' | 'high' | 'critical',
  networkCongestion: NetworkCongestion
): PriorityLevel {
  // Priority matrix based on transaction importance and network congestion
  const priorityMatrix: Record<string, Record<NetworkCongestion, PriorityLevel>> = {
    low: {
      [NetworkCongestion.LOW]: PriorityLevel.MIN,
      [NetworkCongestion.MODERATE]: PriorityLevel.LOW,
      [NetworkCongestion.HIGH]: PriorityLevel.MEDIUM,
      [NetworkCongestion.VERY_HIGH]: PriorityLevel.MEDIUM
    },
    medium: {
      [NetworkCongestion.LOW]: PriorityLevel.LOW,
      [NetworkCongestion.MODERATE]: PriorityLevel.MEDIUM,
      [NetworkCongestion.HIGH]: PriorityLevel.MEDIUM,
      [NetworkCongestion.VERY_HIGH]: PriorityLevel.HIGH
    },
    high: {
      [NetworkCongestion.LOW]: PriorityLevel.MEDIUM,
      [NetworkCongestion.MODERATE]: PriorityLevel.MEDIUM,
      [NetworkCongestion.HIGH]: PriorityLevel.HIGH,
      [NetworkCongestion.VERY_HIGH]: PriorityLevel.VERY_HIGH
    },
    critical: {
      [NetworkCongestion.LOW]: PriorityLevel.HIGH,
      [NetworkCongestion.MODERATE]: PriorityLevel.HIGH,
      [NetworkCongestion.VERY_HIGH]: PriorityLevel.VERY_HIGH,
      [NetworkCongestion.HIGH]: PriorityLevel.VERY_HIGH
    }
  };
  
  return priorityMatrix[transactionImportance][networkCongestion];
}

/**
 * Add optimized priority fee to a transaction based on importance
 */
export async function addOptimizedPriorityFee(
  connection: RateLimitedConnection | Connection,
  transaction: Transaction,
  importance: 'low' | 'medium' | 'high' | 'critical' = 'medium'
): Promise<Transaction> {
  try {
    // First estimate network congestion
    const congestion = await estimateNetworkCongestion(connection);
    logger.info(`Current network congestion: ${congestion}`);
    
    // Determine the appropriate priority level
    const priorityLevel = determinePriorityLevel(importance, congestion);
    logger.info(`Using priority level: ${priorityLevel} for ${importance} importance transaction`);
    
    // Get fee estimates for all levels
    const feeEstimate = await getPriorityFeeEstimate(
      connection,
      transaction,
      { 
        includeAllPriorityFeeLevels: true,
        priorityLevel // Will be used if includeAllPriorityFeeLevels is false
      }
    );
    
    // Select the appropriate fee
    let selectedFee = 10000; // Default minimum
    
    if (feeEstimate.priorityFeeLevels) {
      selectedFee = feeEstimate.priorityFeeLevels[priorityLevel];
    } else {
      selectedFee = feeEstimate.priorityFeeEstimate;
    }
    
    // Ensure minimum fee of 10000 micro-lamports per compute unit
    selectedFee = Math.max(selectedFee, 10000);
    
    logger.info(`Adding priority fee of ${selectedFee} micro-lamports per compute unit`);
    
    // Remove any existing compute budget instructions to avoid duplicates
    transaction.instructions = transaction.instructions.filter(
      instr => !ComputeBudgetProgram.programId.equals(instr.programId)
    );
    
    // Add compute budget instruction for compute unit limit
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 1000000 // 1M CU limit
      })
    );
    
    // Add compute budget instruction for priority fee
    transaction.add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: selectedFee
      })
    );
    
    return transaction;
  } catch (error) {
    logger.error('Error adding optimized priority fee:', error);
    
    // Add a reasonable default fee on error
    transaction.add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 50000 // 50,000 micro-lamports as a safe fallback
      })
    );
    
    return transaction;
  }
}

/**
 * Send transaction with optimized priority fees and retries
 */
export async function sendTransactionWithPriorityFee(
  connection: RateLimitedConnection | Connection,
  transaction: Transaction,
  signers: Keypair[],
  importance: 'low' | 'medium' | 'high' | 'critical' = 'medium',
  maxRetries: number = 3
): Promise<string> {
  try {
    // Add recent blockhash
    const useConnection = 'getConnection' in connection 
      ? (connection as RateLimitedConnection).getConnection() 
      : connection;
      
    transaction.recentBlockhash = (await useConnection.getLatestBlockhash()).blockhash;
    transaction.feePayer = signers[0].publicKey;
    
    // Add optimized priority fee
    transaction = await addOptimizedPriorityFee(connection, transaction, importance);
    
    // Sign the transaction
    transaction.sign(...signers);
    
    // Send with retries
    return await retry(
      async () => {
        // Rate limit the sendTransaction call
        if ('rpcCall' in connection) {
          return await (connection as RateLimitedConnection).rpcCall<string>(
            'sendTransaction',
            transaction.serialize(),
            { skipPreflight: false, maxRetries: 1 }
          );
        } else {
          // Use the regular connection
          return await rateLimiter.limit('helius:sendTransaction', () =>
            useConnection.sendRawTransaction(
              transaction.serialize(),
              { skipPreflight: false, maxRetries: 1 }
            )
          );
        }
      },
      maxRetries,
      1000, // 1 second initial delay
      async (error, attempt) => {
        logger.warn(`Transaction attempt ${attempt} failed: ${error.message}`);
        
        // If we've failed due to a likely fee issue, increase the fee for next attempt
        if (error.message.includes('not confirmed') || 
            error.message.includes('block height exceeded') || 
            error.message.includes('timeout')) {
          
          // Get a fresh blockhash
          transaction.recentBlockhash = (await useConnection.getLatestBlockhash()).blockhash;
          
          // Increase priority fee for next attempt (double it each time)
          // First find the current fee instruction
          const feeInstruction = transaction.instructions.find(
            instr => ComputeBudgetProgram.programId.equals(instr.programId) &&
                     instr.data[0] === 3 // setComputeUnitPrice has 3 as first byte
          );
          
          if (feeInstruction) {
            // Remove the old fee instruction
            transaction.instructions = transaction.instructions.filter(
              instr => instr !== feeInstruction
            );
            
            // Parse the current fee
            const currentFee = feeInstruction.data.readUInt32LE(1);
            const newFee = currentFee * 2; // Double the fee
            
            // Add new fee instruction
            transaction.add(
              ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: newFee
              })
            );
            
            // Re-sign the transaction
            transaction.signatures = [];
            transaction.sign(...signers);
            
            logger.info(`Increased priority fee to ${newFee} for retry`);
          }
        }
      }
    );
  } catch (error) {
    logger.error('Failed to send transaction with priority fee:', error);
    throw error;
  }
}

/**
 * Create and send a versioned transaction with optimized priority fees
 */
export async function sendVersionedTransactionWithPriorityFee(
  connection: RateLimitedConnection | Connection,
  instructions: TransactionInstruction[],
  signers: Keypair[],
  importance: 'low' | 'medium' | 'high' | 'critical' = 'medium',
  maxRetries: number = 3
): Promise<string> {
  try {
    // Get connection
    const useConnection = 'getConnection' in connection 
      ? (connection as RateLimitedConnection).getConnection() 
      : connection;
    
    // Create a legacy transaction first to get fee estimate
    const legacyTx = new Transaction();
    legacyTx.add(...instructions);
    
    // Add optimized priority fee
    legacyTx.recentBlockhash = (await useConnection.getLatestBlockhash('finalized')).blockhash;
    legacyTx.feePayer = signers[0].publicKey;
    const optimizedTx = await addOptimizedPriorityFee(connection, legacyTx, importance);
    
    // Extract optimized instructions including the compute budget ones
    const optimizedInstructions = optimizedTx.instructions;
    
    // Create a versioned transaction
    const blockhash = (await useConnection.getLatestBlockhash('finalized')).blockhash;
    const messageV0 = new TransactionMessage({
      payerKey: signers[0].publicKey,
      recentBlockhash: blockhash,
      instructions: optimizedInstructions,
    }).compileToV0Message();
    
    const versionedTransaction = new VersionedTransaction(messageV0);
    
    // Sign the transaction
    versionedTransaction.sign(signers);
    
    // Send with retries
    return await retry(
      async () => {
        // Rate limit the sendTransaction call
        if ('rpcCall' in connection) {
          return await (connection as RateLimitedConnection).rpcCall<string>(
            'sendTransaction',
            versionedTransaction.serialize(),
            { skipPreflight: false, maxRetries: 1 }
          );
        } else {
          // Use the regular connection
          return await rateLimiter.limit('helius:sendTransaction', () =>
            useConnection.sendRawTransaction(
              versionedTransaction.serialize(),
              { skipPreflight: false, maxRetries: 1 }
            )
          );
        }
      },
      maxRetries,
      1000
    );
  } catch (error) {
    logger.error('Failed to send versioned transaction with priority fee:', error);
    throw error;
  }
}

/**
 * Create a transaction with optimized compute units and priority fee
 */
export async function createOptimizedTransaction(
  connection: RateLimitedConnection | Connection,
  instructions: TransactionInstruction[],
  feePayer: PublicKey,
  importance: 'low' | 'medium' | 'high' | 'critical' = 'medium'
): Promise<Transaction> {
  try {
    const transaction = new Transaction();
    
    // Add instructions
    transaction.add(...instructions);
    
    // Add recent blockhash
    const useConnection = 'getConnection' in connection 
      ? (connection as RateLimitedConnection).getConnection() 
      : connection;
      
    transaction.recentBlockhash = (await useConnection.getLatestBlockhash()).blockhash;
    transaction.feePayer = feePayer;
    
    // Add optimized priority fee
    return addOptimizedPriorityFee(connection, transaction, importance);
  } catch (error) {
    logger.error('Error creating optimized transaction:', error);
    throw error;
  }
}

/**
 * Wait for transaction confirmation with enhanced error handling and logging
 */
export async function confirmTransactionWithTimeout(
  connection: RateLimitedConnection | Connection,
  signature: string,
  timeoutMs: number = 60000, // 1 minute default
  commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed'
): Promise<SignatureResult | null> {
  try {
    logger.info(`Waiting for transaction ${signature} to be ${commitment}...`);
    
    // Start timeout timer
    const timeoutId = setTimeout(() => {
      throw new Error(`Transaction confirmation timeout after ${timeoutMs}ms`);
    }, timeoutMs);
    
    const useConnection = 'getConnection' in connection 
      ? (connection as RateLimitedConnection).getConnection() 
      : connection;
    
    // Set up confirmation with retries
    const result = await retry(
      async () => {
        // Rate limit the confirmTransaction call
        if ('rpcCall' in connection) {
          return await (connection as RateLimitedConnection).rpcCall<SignatureResult>(
            'confirmTransaction',
            signature,
            commitment
          );
        } else {
          // Use the regular connection and with rate limiting directly
          return await rateLimiter.limit('helius:rpc', () => 
            useConnection.confirmTransaction(signature, commitment)
          );
        }
      },
      5, // 5 retries for confirmation
      2000 // 2 second initial delay
    );
    
    // Clear timeout as we've got a response
    clearTimeout(timeoutId);
    
    // Check for transaction error
    if (result && result.value && result.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
    }
    
    logger.info(`Transaction ${signature} confirmed successfully`);
    return result ? result.value : null;
  } catch (error) {
    logger.error(`Error confirming transaction ${signature}:`, error);
    throw error;
  }
}

export default {
  getPriorityFeeEstimate,
  estimateNetworkCongestion,
  determinePriorityLevel,
  addOptimizedPriorityFee,
  sendTransactionWithPriorityFee,
  sendVersionedTransactionWithPriorityFee,
  createOptimizedTransaction,
  confirmTransactionWithTimeout
};