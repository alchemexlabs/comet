/**
 * Rate-limited connection wrapper for Solana RPC calls
 */

import { 
  Connection, 
  ConnectionConfig, 
  PublicKey, 
  Commitment, 
  RpcResponseAndContext,
  SignatureResult,
  TransactionSignature,
  BlockhashWithExpiryBlockHeight,
  Transaction
} from '@solana/web3.js';
import { logger } from './logger';
import { rateLimiter } from './rate-limiter';

/**
 * A rate-limited wrapper around the Solana Connection object
 * to respect Helius API limits
 */
export class RateLimitedConnection {
  private connection: Connection;
  
  constructor(endpoint: string, config?: ConnectionConfig) {
    this.connection = new Connection(endpoint, config);
    logger.info(`Created rate-limited connection to ${endpoint}`);
  }
  
  /**
   * Get the underlying connection object
   */
  getConnection(): Connection {
    return this.connection;
  }
  
  /**
   * Send a single transaction with rate limiting
   */
  async sendTransaction(
    transaction: Transaction,
    ...args: any[]
  ): Promise<TransactionSignature> {
    return rateLimiter.limit('helius:sendTransaction', () => 
      this.connection.sendTransaction(transaction, ...args)
    );
  }
  
  /**
   * Get the latest blockhash with rate limiting
   */
  async getLatestBlockhash(commitment?: Commitment): Promise<BlockhashWithExpiryBlockHeight> {
    return rateLimiter.limit('helius:rpc', () => 
      this.connection.getLatestBlockhash(commitment)
    );
  }
  
  /**
   * Get account info with rate limiting
   */
  async getAccountInfo(publicKey: PublicKey, commitment?: Commitment): Promise<any> {
    return rateLimiter.limit('helius:rpc', () => 
      this.connection.getAccountInfo(publicKey, commitment)
    );
  }
  
  /**
   * Get program accounts with rate limiting
   */
  async getProgramAccounts(
    programId: PublicKey,
    configOrCommitment?: any
  ): Promise<any[]> {
    return rateLimiter.limit('helius:getProgramAccounts', () => 
      this.connection.getProgramAccounts(programId, configOrCommitment)
    );
  }
  
  /**
   * Get transaction confirmation status with rate limiting
   */
  async confirmTransaction(
    signature: TransactionSignature,
    commitment?: Commitment
  ): Promise<RpcResponseAndContext<SignatureResult>> {
    return rateLimiter.limit('helius:rpc', () => 
      this.connection.confirmTransaction(signature, commitment)
    );
  }
  
  /**
   * Get token account balance with rate limiting
   */
  async getTokenAccountBalance(
    tokenAddress: PublicKey,
    commitment?: Commitment
  ): Promise<any> {
    return rateLimiter.limit('helius:rpc', () => 
      this.connection.getTokenAccountBalance(tokenAddress, commitment)
    );
  }
  
  /**
   * Get multiple token accounts with rate limiting
   */
  async getMultipleAccountsInfo(
    publicKeys: PublicKey[],
    commitment?: Commitment
  ): Promise<any[]> {
    return rateLimiter.limit('helius:rpc', () => 
      this.connection.getMultipleAccountsInfo(publicKeys, commitment)
    );
  }
  
  /**
   * Get balance with rate limiting
   */
  async getBalance(
    publicKey: PublicKey,
    commitment?: Commitment
  ): Promise<number> {
    return rateLimiter.limit('helius:rpc', () => 
      this.connection.getBalance(publicKey, commitment)
    );
  }
  
  /**
   * Get transaction with rate limiting (archival call = higher credit usage)
   */
  async getTransaction(
    signature: string,
    options?: any
  ): Promise<any> {
    // This is an archival call, so it uses more credits
    logger.debug('Making archival call: getTransaction');
    return rateLimiter.limit('helius:rpc', () => 
      this.connection.getTransaction(signature, options)
    );
  }
  
  /**
   * Get block time with rate limiting (archival call = higher credit usage)
   */
  async getBlockTime(slot: number): Promise<number | null> {
    // This is an archival call, so it uses more credits
    logger.debug('Making archival call: getBlockTime');
    return rateLimiter.limit('helius:rpc', () => 
      this.connection.getBlockTime(slot)
    );
  }
  
  /**
   * Get token accounts by owner with rate limiting
   */
  async getTokenAccountsByOwner(
    ownerAddress: PublicKey,
    filter: any,
    commitment?: Commitment
  ): Promise<any> {
    return rateLimiter.limit('helius:rpc', () => 
      this.connection.getTokenAccountsByOwner(ownerAddress, filter, commitment)
    );
  }
  
  /**
   * Get minimum balance for rent exemption with rate limiting
   */
  async getMinimumBalanceForRentExemption(
    dataLength: number,
    commitment?: Commitment
  ): Promise<number> {
    return rateLimiter.limit('helius:rpc', () => 
      this.connection.getMinimumBalanceForRentExemption(dataLength, commitment)
    );
  }
  
  /**
   * Get slot with rate limiting
   */
  async getSlot(commitment?: Commitment): Promise<number> {
    return rateLimiter.limit('helius:rpc', () => 
      this.connection.getSlot(commitment)
    );
  }
  
  /**
   * Generic method for rate-limited RPC call
   * @param method - The method name to call on the connection object
   * @param args - Arguments to pass to the method
   * @returns The result of the RPC call
   */
  async rpcCall<T>(method: string, ...args: any[]): Promise<T> {
    // Determine which rate limit to use based on method name
    let rateLimit = 'helius:rpc';
    
    if (method === 'sendTransaction') {
      rateLimit = 'helius:sendTransaction';
    } else if (method === 'getProgramAccounts') {
      rateLimit = 'helius:getProgramAccounts';
    } else if (['getValidityProof', 'getPhotonState'].includes(method)) {
      rateLimit = 'helius:photon';
    }
    
    return rateLimiter.limit(rateLimit, async () => {
      // @ts-ignore: Dynamic method call
      if (typeof this.connection[method] !== 'function') {
        throw new Error(`Method ${method} not found on Connection object`);
      }
      
      // @ts-ignore: Dynamic method call
      return this.connection[method](...args);
    });
  }
}

export default RateLimitedConnection;