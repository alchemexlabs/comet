# Comet - Autonomous Liquidity Agent for Meteora DLMM

## Build Commands
```
bun run build     # Build the SDK
bun run start     # Build with watch mode
bun test          # Run all tests
bun jest src/test/file.test.ts   # Run a single test file
bun run unit-test # Run specific unit tests
bun run example   # Run example script with environment variables
bun run start-server # Start the Hono server
```

## Code Style Guidelines
- **Imports**: Group imports by package (@coral-xyz/anchor, @solana/web3.js, etc.)
- **Formatting**: Follow TypeScript standard formatting
- **Types**: Use BN for numeric values, PublicKey for addresses, use strong typing
- **Naming**: 
  - Variables: camelCase
  - Classes: PascalCase
  - Constants: UPPER_SNAKE_CASE
- **Error Handling**: Use try/catch for transactions, check for null results
- **Testing**: Write comprehensive unit tests for new functionality

## Project Structure
- `src/dlmm`: Core DLMM implementation
- `src/examples`: Example usage
- `src/server`: Hono server implementation
- `src/test`: Test files
- `src/agent`: Comet autonomous liquidity agent implementation

## Environment Variables (.env.example)
```
HELIUS_API_KEY=your_helius_api_key
BIRDEYE_API_KEY=your_birdeye_api_key
RPC_URL=https://api.helius.xyz/v0/solanaqt
BIRDEYE_API_URL=https://public-api.birdeye.so
COMET_WALLET_KEY=your_wallet_private_key
COMET_STRATEGY=Spot  # Options: Spot, BidAsk, Curve
COMET_AUTO_REBALANCE=true
```

## Comet Agent
Comet is an autonomous liquidity agent for Meteora DLMM pools that:
- Monitors price movements and market conditions
- Automatically rebalances positions based on configured strategy
- Optimizes liquidity distribution for maximum capital efficiency
- Claims and compounds fees and rewards
- Provides real-time analytics on position performance