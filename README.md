# Comet - Autonomous Liquidity Agent for Meteora DLMM

<p align="center">
<img align="center" src="https://app.meteora.ag/icons/logo.svg" width="180" height="180" />
</p>
<br>

Comet is an autonomous trading agent for Solana's Meteora protocol, designed to create a perpetual money machine by providing concentrated liquidity on Meteora's DLMM (Dynamic Liquidity Market Maker) pools.

## Features

- **Automated Pool Management**: Create and manage DLMM pools with specified parameters
- **Intelligent Liquidity Provision**: Add liquidity concentrated around the current price for maximum fee earnings
- **Dynamic Rebalancing**: Monitor pool prices and automatically rebalance positions
- **Fee Collection**: Collect and reinvest trading fees to compound returns
- **Multiple Strategies**: Support for Spot, BidAsk, and Curve liquidity distribution strategies
- **REST API and CLI**: Manage your agents through an API or command line interface

## Installation

```bash
# Install dependencies
bun install

# Build the project
bun run build
```

## Configuration

Create a `.env` file based on `.env.example`:

```
HELIUS_API_KEY=your_helius_api_key
BIRDEYE_API_KEY=your_birdeye_api_key
RPC_URL=https://api.helius.xyz/v0/solanaqt
BIRDEYE_API_URL=https://public-api.birdeye.so

# Comet Agent Configuration
COMET_WALLET_KEY=your_wallet_private_key
COMET_POOL_ADDRESS=your_pool_address
COMET_STRATEGY=Spot  # Options: Spot, BidAsk, Curve
COMET_AUTO_REBALANCE=true
COMET_BIN_RANGE=10
COMET_MIN_REBALANCE_INTERVAL=3600000
COMET_PRICE_DEVIATION_THRESHOLD=1.0
COMET_FEE_COLLECTION_INTERVAL=86400000
COMET_POLLING_INTERVAL=60000
COMET_MAX_RETRIES=3
COMET_RETRY_DELAY=1000
COMET_LOG_LEVEL=info
COMET_API_PORT=3001
```

## Usage

### Starting the Agent API Server

```bash
bun run start-agent
```

### Using the CLI

```bash
# Start an agent for a specific pool
bun run start-agent-cli start --pool <pool_address> --strategy Spot --auto-rebalance true

# Create a new DLMM pool
bun run start-agent-cli create-pool --token-x <token_x_address> --token-y <token_y_address> --bin-step 20 --active-id 8388608 --fee-bps 20

# Add liquidity to a pool
bun run start-agent-cli add-liquidity --pool <pool_address> --amount-x 100000000 --amount-y 100000000 --strategy Spot --range 10

# Manually rebalance positions
bun run start-agent-cli rebalance --pool <pool_address>

# Collect fees
bun run start-agent-cli collect-fees --pool <pool_address>
```

### API Endpoints

Start an agent:
```
POST /agents/start
{
  "poolAddress": "ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq",
  "strategy": "Spot",
  "binRange": 10,
  "autoRebalance": true
}
```

Stop an agent:
```
POST /agents/stop
{
  "poolAddress": "ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq"
}
```

Get agent status:
```
GET /agents/:poolAddress/status
```

Create a pool:
```
POST /pools/create
{
  "tokenX": "So11111111111111111111111111111111111111112",
  "tokenY": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "binStep": 20,
  "activeId": 8388608,
  "feeBps": 20,
  "activationType": 1,
  "hasAlphaVault": false
}
```

Add liquidity:
```
POST /pools/:poolAddress/add-liquidity
{
  "amountX": "100000000",
  "amountY": "100000000",
  "strategy": "Spot",
  "binRange": 10
}
```

Rebalance positions:
```
POST /pools/:poolAddress/rebalance
```

Collect fees:
```
POST /pools/:poolAddress/collect-fees
```

## Strategies

- **Spot**: Distributes liquidity evenly around the active bin
- **BidAsk**: Concentrates liquidity at the active bin and spreads out
- **Curve**: Distributes liquidity in a normal distribution around the active bin

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

ISC

## Credits

Built with the [Meteora DLMM SDK](https://github.com/MeteoraAg/dlmm-sdk)