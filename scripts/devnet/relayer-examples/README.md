# Relayer Devnet Examples

This directory contains example scripts for interacting with the Continuum CP-Swap relayer on devnet.

## Prerequisites

1. Ensure the relayer is running with devnet configuration:
   ```bash
   cd ../../../relayer
   npm run dev -- --devnet
   ```

2. Install dependencies:
   ```bash
   npm install ws
   ```

3. Make scripts executable:
   ```bash
   chmod +x *.ts
   ```

## Available Scripts

### 1. Request Airdrop (`request-airdrop.ts`)

Request airdrops of SOL, USDC, or WSOL tokens for testing.

```bash
# Request all airdrops (SOL, USDC, WSOL)
./request-airdrop.ts

# Or run with custom wallet path
WALLET_PATH=/path/to/wallet.json ./request-airdrop.ts
```

### 2. Get Pool Information (`get-pool-info.ts`)

Fetch comprehensive information about the relayer and available pools.

```bash
# Get all relayer and pool info
./get-pool-info.ts

# Use custom relayer URL
RELAYER_URL=http://your-relayer:8085 ./get-pool-info.ts
```

### 3. Submit Swap Order (`submit-swap.ts`)

Submit swap orders to the relayer and monitor their execution.

```bash
# Swap 100 USDC to WSOL
./submit-swap.ts usdc-to-wsol 100

# Swap 1 WSOL to USDC
./submit-swap.ts wsol-to-usdc 1

# Use custom wallet
WALLET_PATH=/path/to/wallet.json ./submit-swap.ts usdc-to-wsol 50
```

### 4. Monitor Orders (`monitor-order.ts`)

Monitor order execution in real-time via WebSocket.

```bash
# Monitor a specific order
./monitor-order.ts ord_1234567890_abc123

# Monitor all orders (live feed)
./monitor-order.ts all
```

## Example Workflow

1. **Setup and Airdrop**
   ```bash
   # First, get some tokens
   ./request-airdrop.ts
   ```

2. **Check Pool Information**
   ```bash
   # View current pool prices
   ./get-pool-info.ts
   ```

3. **Submit a Swap**
   ```bash
   # Swap 100 USDC for WSOL
   ./submit-swap.ts usdc-to-wsol 100
   ```

4. **Monitor in Real-Time**
   ```bash
   # In another terminal, monitor all orders
   ./monitor-order.ts all
   ```

## Environment Variables

- `RELAYER_URL`: Relayer API endpoint (default: http://localhost:8085)
- `WALLET_PATH`: Path to wallet keypair JSON (default: ~/.config/solana/id.json)

## Programmatic Usage

All scripts can also be imported and used programmatically:

```typescript
import { requestAirdrop } from './request-airdrop';
import { submitSwapOrder } from './submit-swap';
import { getPoolPrice } from './get-pool-info';
import { monitorOrder } from './monitor-order';

// Request USDC airdrop
await requestAirdrop('YOUR_WALLET_ADDRESS', 'USDC');

// Get current pool price
const price = await getPoolPrice('POOL_ID');

// Submit swap
const order = await submitSwapOrder(wallet, 100, 'USDC', 100);

// Monitor order
await monitorOrder(order.orderId);
```

## Troubleshooting

### "Relayer is not responding"
Make sure the relayer is running:
```bash
cd ../../../relayer
npm run dev -- --devnet
```

### "Insufficient balance in relayer wallet"
The relayer needs to hold tokens for airdrops. Fund it using the devnet token creation scripts.

### "Rate limited"
Airdrops are rate-limited to once per minute. Wait before requesting another airdrop.

### WebSocket connection issues
Ensure your firewall allows WebSocket connections on the relayer port (default: 8085).