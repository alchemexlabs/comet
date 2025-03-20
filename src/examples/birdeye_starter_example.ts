/**
 * Birdeye Starter Plan API integration example
 * 
 * This example demonstrates how to use the enhanced Birdeye API features
 * available on the Starter Plan subscription tier.
 */

import { PublicKey } from '@solana/web3.js';
import { 
  getTokenInfo, 
  getTokenMarketData, 
  getTokenOHLCV, 
  getPairOHLCV,
  getTokenTrades,
  getPairTrades,
  getWalletPortfolio,
  getWalletHistoricalTrades,
  getTokenTopHolders
} from '../agent/utils/price';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// SOL token mint address
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
// USDC token mint address
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
// Example wallet address (Mango DAO)
const EXAMPLE_WALLET = new PublicKey('9BVcYqEQxyccuwznvxXqDkSJFavvTyheiTYk231T1A8S');

/**
 * Example demonstrating how to use the Birdeye Starter Plan API features
 */
async function main() {
  try {
    console.log('Birdeye Starter Plan API Example');
    console.log('================================\n');
    
    // 1. Get token information
    console.log('1. Token Information for SOL:');
    const tokenInfo = await getTokenInfo(SOL_MINT);
    console.log(JSON.stringify(tokenInfo, null, 2));
    console.log('\n');
    
    // 2. Get token market data
    console.log('2. Token Market Data for SOL:');
    const marketData = await getTokenMarketData(SOL_MINT);
    console.log(JSON.stringify(marketData, null, 2));
    console.log('\n');
    
    // 3. Get token OHLCV data (1 hour candles)
    console.log('3. SOL OHLCV Data (1H timeframe, last 5 candles):');
    const ohlcvData = await getTokenOHLCV(SOL_MINT, '1H', 5);
    console.log(JSON.stringify(ohlcvData, null, 2));
    console.log('\n');
    
    // 4. Get pair OHLCV data (SOL/USDC)
    console.log('4. SOL/USDC Pair OHLCV Data (1H timeframe, last 5 candles):');
    const pairOhlcvData = await getPairOHLCV(SOL_MINT, USDC_MINT, '1H', 5);
    console.log(JSON.stringify(pairOhlcvData, null, 2));
    console.log('\n');
    
    // 5. Get token recent trades
    console.log('5. Recent SOL Trades (last 5):');
    const tokenTrades = await getTokenTrades(SOL_MINT, 5);
    console.log(JSON.stringify(tokenTrades, null, 2));
    console.log('\n');
    
    // 6. Get pair recent trades
    console.log('6. Recent SOL/USDC Pair Trades (last 5):');
    const pairTrades = await getPairTrades(SOL_MINT, USDC_MINT, 5);
    console.log(JSON.stringify(pairTrades, null, 2));
    console.log('\n');
    
    // 7. Get wallet portfolio
    console.log('7. Example Wallet Portfolio:');
    const walletPortfolio = await getWalletPortfolio(EXAMPLE_WALLET);
    console.log(JSON.stringify(walletPortfolio, null, 2));
    console.log('\n');
    
    // 8. Get wallet historical trades
    console.log('8. Example Wallet Historical Trades (last 5):');
    const walletTrades = await getWalletHistoricalTrades(EXAMPLE_WALLET, 5);
    console.log(JSON.stringify(walletTrades, null, 2));
    console.log('\n');
    
    // 9. Get token top holders
    console.log('9. SOL Top Holders (top 5):');
    const topHolders = await getTokenTopHolders(SOL_MINT, 5);
    console.log(JSON.stringify(topHolders, null, 2));
    console.log('\n');

  } catch (error) {
    console.error('Error running Birdeye example:', error);
  }
}

// Run the example
main();