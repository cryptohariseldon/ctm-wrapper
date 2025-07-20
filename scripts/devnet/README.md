# Devnet Testing Scripts

This directory contains scripts for testing the Continuum CP-Swap integration on Solana Devnet.

## Prerequisites

- Solana CLI installed and configured for devnet
- Node.js and npm installed
- A funded wallet on devnet (at least 2 SOL)

## Scripts Overview

1. **create-tokens-devnet.ts** - Creates test tokens (USDC and WSOL) on devnet
2. **init-pool-devnet.ts** - Initializes a CP-Swap pool with Continuum as custom authority
3. **test-swap-devnet.ts** - Tests swap functionality through the Continuum wrapper
4. **start-relayer-devnet.sh** - Starts the relayer service configured for devnet

## Usage

### Step 1: Ensure Programs are Deployed

The following programs should be deployed to devnet:
- Continuum: `9tcAhE4XGcZZTE8ez1EW8FF7rxyBN8uat2kkepgaeyEa`
- CP-Swap: `GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp`

### Step 2: Fund Your Wallet

```bash
# Check your wallet address
solana address

# Request airdrop if needed
solana airdrop 2 --url devnet
```

### Step 3: Create Test Tokens

```bash
./create-tokens-devnet.ts
```

This will:
- Create USDC-like token (6 decimals)
- Create WSOL-like token (9 decimals)
- Mint 10,000 USDC and 100 WSOL to your wallet
- Save token info to `devnet-tokens.json`

### Step 4: Initialize CP-Swap Pool

```bash
./init-pool-devnet.ts
```

This will:
- Create an AMM config with 0.25% trading fee
- Initialize a pool with 1000 USDC and 1 WSOL
- Set Continuum's PDA as the custom authority
- Save pool info to `devnet-pool.json`

### Step 5: Test Swap Functionality

```bash
./test-swap-devnet.ts
```

This will:
- Attempt a direct swap (should fail)
- Execute a swap through Continuum (should succeed)
- Swap 100 USDC for WSOL
- Display execution price and results

### Step 6: Start Relayer (Optional)

```bash
./start-relayer-devnet.sh
```

This will:
- Start the relayer service on port 8085
- Enable devnet configuration
- Provide API endpoints for order submission

## Configuration Files

### devnet-tokens.json
Contains mint addresses and token accounts created on devnet.

### devnet-pool.json
Contains pool configuration including:
- Pool ID
- AMM Config
- Token mints
- Authority (Continuum PDA)

### devnet-swap-test.json
Contains results from the swap test including:
- Transaction signature
- Amounts swapped
- Execution price

## API Endpoints (when relayer is running)

- Health check: `http://localhost:8085/health`
- Relayer info: `http://localhost:8085/api/v1/info`
- Submit order: `POST http://localhost:8085/api/v1/orders`
- Get order status: `GET http://localhost:8085/api/v1/orders/:orderId`
- Get pool price: `GET http://localhost:8085/api/v1/pools/:poolId/price`
- Request airdrop: `POST http://localhost:8085/api/v1/airdrop`

## Troubleshooting

### "Insufficient balance" error
Request more SOL from the devnet faucet:
```bash
solana airdrop 2 --url devnet
```

### "Program not found" error
Ensure the programs are deployed to the correct addresses on devnet.

### "Pool not initialized" error
Make sure you've run the initialization script before testing swaps.

### Connection issues
Try using a different RPC endpoint:
```bash
export DEVNET_RPC_URL=https://rpc.ankr.com/solana_devnet
```

## Next Steps

After successful testing on devnet:
1. Deploy to mainnet-beta
2. Update program IDs in configuration
3. Create production pools with real tokens
4. Configure relayer for production use