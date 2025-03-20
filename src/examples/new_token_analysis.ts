/**
 * New Token Analysis Example
 * 
 * This example demonstrates how to monitor newly listed tokens on Solana
 * and analyze their potential using Birdeye Starter Plan API features.
 */

import { PublicKey } from '@solana/web3.js';
import { 
  getNewlyListedTokens,
  analyzeNewTokenPotential
} from '../agent/utils/price';
import { logger } from '../agent/utils/logger';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Main function to analyze new token opportunities
 */
async function main() {
  try {
    console.log('New Token Analysis Example');
    console.log('=========================\n');
    
    // 1. Get newly listed tokens from the past 24 hours
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    console.log(`Fetching tokens listed in the past 24 hours...\n`);
    
    const newTokens = await getNewlyListedTokens(10, oneDayAgo);
    
    if (!newTokens || newTokens.length === 0) {
      console.log('No new tokens found in the past 24 hours.');
      return;
    }
    
    console.log(`Found ${newTokens.length} newly listed tokens.\n`);
    
    // 2. Analyze each token
    console.log('Analyzing token potential...\n');
    
    const results = [];
    
    for (const token of newTokens) {
      const tokenAddress = token.address;
      const tokenName = token.name || 'Unknown Token';
      const tokenSymbol = token.symbol || '???';
      
      console.log(`Analyzing ${tokenName} (${tokenSymbol})...`);
      
      try {
        // Analyze the token's potential
        const analysis = await analyzeNewTokenPotential(tokenAddress);
        
        results.push({
          name: tokenName,
          symbol: tokenSymbol,
          address: tokenAddress,
          score: analysis.score,
          recommendation: analysis.recommendation,
          details: analysis
        });
        
        console.log(`Analysis complete: Score ${analysis.score}/100 - ${analysis.recommendation}\n`);
      } catch (error) {
        console.log(`Failed to analyze ${tokenName}: ${error.message}\n`);
      }
    }
    
    // 3. Sort results by score (highest first)
    results.sort((a, b) => b.score - a.score);
    
    // 4. Display results in a table format
    console.log('\nTop New Token Opportunities:');
    console.log('===========================');
    console.log('Rank | Name (Symbol) | Score | Recommendation');
    console.log('-----|---------------|-------|---------------');
    
    results.forEach((token, index) => {
      console.log(`${index + 1}    | ${token.name} (${token.symbol}) | ${token.score}/100 | ${token.recommendation}`);
    });
    
    // 5. Show detailed breakdown of top token
    if (results.length > 0) {
      const topToken = results[0];
      const details = topToken.details;
      
      console.log(`\nTop Token Detailed Analysis: ${topToken.name} (${topToken.symbol})`);
      console.log('========================================');
      console.log(`Total Score: ${details.score}/100 (${topToken.recommendation})`);
      console.log(`- Liquidity: ${details.liquidity}/20`);
      console.log(`- Volume: ${details.volume}/25`);
      console.log(`- Holder Growth: ${details.holderGrowth}/10`);
      console.log(`- Distribution: ${details.distribution}/10`);
      console.log(`- Metadata Quality: ${details.metadataQuality}/15`);
      console.log(`- Social Signals: ${details.socialSignals}/20`);
    }
    
  } catch (error) {
    logger.error(`Error running new token analysis: ${error.message}`);
    console.error(`Failed to analyze new tokens: ${error.message}`);
  }
}

// Run the example
main();