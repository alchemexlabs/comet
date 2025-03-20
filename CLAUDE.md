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
# Comet Agent Configuration
RPC_URL=https://api.helius.xyz/v0/solanaqt
HELIUS_API_KEY=your_helius_api_key
BIRDEYE_API_KEY=your_birdeye_api_key
BIRDEYE_API_URL=https://public-api.birdeye.so
JUPITER_API_URL=https://price.jup.ag/v4

# Wallet Configuration
COMET_WALLET_KEY=your_wallet_private_key

# Strategy Configuration
COMET_POOL_ADDRESS=your_pool_address
COMET_STRATEGY=Spot  # Options: Spot, BidAsk, Curve
COMET_BIN_RANGE=10
COMET_AUTO_REBALANCE=true
COMET_MIN_REBALANCE_INTERVAL=3600000  # 1 hour in milliseconds
COMET_PRICE_DEVIATION_THRESHOLD=2.5   # % price change that triggers rebalance

# Claude AI Integration
CLAUDE_API_KEY=your_claude_api_key
CLAUDE_MODEL=claude-3-sonnet-20240229  # options: claude-3-haiku-20240307, claude-3-sonnet-20240229, claude-3-opus-20240229
CLAUDE_ENABLED=true
CLAUDE_RISK_PROFILE=moderate  # options: conservative, moderate, aggressive
CLAUDE_TEMPERATURE=0.1        # 0.0-1.0, lower = more deterministic
CLAUDE_MAX_TOKENS=1024        # max tokens in response

# Logging
LOG_LEVEL=info  # debug, info, warn, error
```

## Comet Agent
Comet is an autonomous liquidity agent for Meteora DLMM pools that:
- Monitors price movements and market conditions
- Automatically rebalances positions based on configured strategy
- Optimizes liquidity distribution for maximum capital efficiency
- Claims and compounds fees and rewards
- Provides real-time analytics on position performance

## Strategy Types

### Standard Strategies
- **Spot**: Distributes liquidity evenly around the active bin
- **BidAsk**: Concentrates liquidity at the active bin and spreads out
- **Curve**: Distributes liquidity in a normal distribution around active bin

### MicroPortfolio Strategy
A specialized strategy for growing a small portfolio ($100 USDC + 1 SOL):
- Intelligently allocates capital across multiple token pairs
- Implements weekend safety mode for risk reduction
- Dynamically adjusts based on market volatility
- Compounds fees for accelerated growth
- Adapts strategy based on risk profile (low/medium/high)

Example usage:
```
bun run start-agent-cli start --strategy MicroPortfolio --micro-risk medium --micro-usdc 100 --micro-sol 1 --micro-weekend-safety true --claude-enabled true
```

## Rate Limiting

Comet implements automatic rate limiting for all external API calls to respect service quotas:

### Default Rate Limits
- **Helius RPC**: 50 requests per second
- **SendTransaction**: 5 requests per second
- **GetProgramAccounts**: 25 requests per second
- **Helius Enhanced API**: 10 requests per second
- **Birdeye API**: 10 requests per second
- **Jupiter API**: 50 requests per second
- **Claude AI API**: 1 request per 10 seconds

These limits can be customized through environment variables:
```
# Rate Limiting Configuration
RATE_LIMIT_HELIUS_RPC=50
RATE_LIMIT_HELIUS_SEND_TX=5
RATE_LIMIT_HELIUS_PROGRAM_ACCTS=25
RATE_LIMIT_HELIUS_API=10
RATE_LIMIT_BIRDEYE_API=10
RATE_LIMIT_JUPITER_API=50
RATE_LIMIT_CLAUDE_API=1
RATE_LIMIT_CLAUDE_PERIOD=10000
```