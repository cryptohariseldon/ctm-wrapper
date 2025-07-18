# Continuum CP-Swap Client Integration Guide

This guide explains how to integrate with Continuum CP-Swap from a client application (wallet, dApp, etc.).

## Overview

Continuum CP-Swap is a wrapper around Raydium CP-Swap that enforces FIFO order execution and provides custom pool authority management. All swaps must go through the Continuum program, which then makes cross-program invocations (CPI) to the underlying CP-Swap program.

## Prerequisites

- `@solana/web3.js` >= 1.78.0
- `@solana/spl-token` >= 0.3.0
- Access to constants from `constants.json`

## Key Concepts

1. **FIFO Execution**: Orders are executed in First-In-First-Out order
2. **Custom Authority**: Pools are controlled by Continuum's PDA, preventing direct swaps
3. **Immediate Swaps**: The `swap_immediate` instruction submits and executes in one transaction

## Getting Started

### 1. Load Constants

```typescript
import constants from './constants.json';

// Select network
const network = 'devnet'; // or 'localnet', 'mainnet'
const config = constants[network];

// Program IDs
const CONTINUUM_PROGRAM_ID = new PublicKey(config.programs.continuum);
const CP_SWAP_PROGRAM_ID = new PublicKey(config.programs.cpSwap);
```

### 2. Derive PDAs

```typescript
// FIFO State PDA
const [fifoState] = PublicKey.findProgramAddressSync(
  [Buffer.from('fifo_state')],
  CONTINUUM_PROGRAM_ID
);

// Pool Authority PDA (for a specific pool)
const [poolAuthority, poolAuthorityBump] = PublicKey.findProgramAddressSync(
  [Buffer.from('cp_pool_authority'), poolId.toBuffer()],
  CONTINUUM_PROGRAM_ID
);

// CP-Swap Vault Authority
const [cpSwapAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from('vault_and_lp_mint_auth_seed')],
  CP_SWAP_PROGRAM_ID
);
```

## Instruction Builders

### Initialize FIFO State (Admin Only)

```typescript
function buildInitializeInstruction(
  admin: PublicKey
): TransactionInstruction {
  const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);
  
  return new TransactionInstruction({
    keys: [
      { pubkey: fifoState, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: CONTINUUM_PROGRAM_ID,
    data: discriminator,
  });
}
```

### Swap Immediate

The most common instruction - performs an immediate swap through Continuum.

```typescript
function buildSwapImmediateInstruction(
  user: PublicKey,
  poolId: PublicKey,
  amountIn: BN,
  minAmountOut: BN,
  isBaseInput: boolean,
  poolAuthorityBump: number
): TransactionInstruction {
  // Get pool config from constants
  const pool = config.pools['USDC-WSOL'];
  
  // Discriminator for swap_immediate
  const discriminator = Buffer.from([175, 131, 44, 121, 171, 170, 38, 18]);
  
  // Build instruction data
  const data = Buffer.concat([
    discriminator,
    amountIn.toArrayLike(Buffer, 'le', 8),
    minAmountOut.toArrayLike(Buffer, 'le', 8),
    Buffer.from([isBaseInput ? 1 : 0]),
    poolId.toBuffer(),
    Buffer.from([poolAuthorityBump]),
  ]);

  // Get user token accounts
  const userTokenA = getAssociatedTokenAddressSync(
    new PublicKey(pool.tokenAMint), 
    user
  );
  const userTokenB = getAssociatedTokenAddressSync(
    new PublicKey(pool.tokenBMint), 
    user
  );

  return new TransactionInstruction({
    keys: [
      // Required accounts for Continuum
      { pubkey: fifoState, isSigner: false, isWritable: true },
      { pubkey: CP_SWAP_PROGRAM_ID, isSigner: false, isWritable: false },
      
      // Remaining accounts for CP-Swap CPI
      { pubkey: user, isSigner: true, isWritable: false },
      { pubkey: cpSwapAuthority, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(pool.ammConfig), isSigner: false, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: userTokenA, isSigner: false, isWritable: true },
      { pubkey: userTokenB, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(pool.tokenAVault), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(pool.tokenBVault), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(pool.tokenAMint), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(pool.tokenBMint), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(pool.observationState), isSigner: false, isWritable: true },
    ],
    programId: CONTINUUM_PROGRAM_ID,
    data,
  });
}
```

### Important Account Ordering

The account order for CP-Swap CPI is critical:
1. User (signer)
2. CP-Swap vault authority PDA
3. AMM config
4. Pool state
5. User source token account
6. User destination token account
7. Token A vault
8. Token B vault
9-10. Token programs
11-12. Token mints
13. Observation state

## Complete Swap Example

```typescript
async function swapTokens(
  connection: Connection,
  wallet: Keypair,
  amountIn: number,
  minAmountOut: number,
  isBaseInput: boolean
) {
  // Load pool config
  const pool = config.pools['USDC-WSOL'];
  const poolId = new PublicKey(pool.poolId);
  
  // Derive PDAs
  const [poolAuthority, poolAuthorityBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('cp_pool_authority'), poolId.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );
  
  // Convert amounts to proper units
  const tokenADecimals = isBaseInput ? 6 : 9; // USDC : WSOL
  const amountInUnits = new BN(amountIn * Math.pow(10, tokenADecimals));
  const minAmountOutUnits = new BN(minAmountOut * Math.pow(10, isBaseInput ? 9 : 6));
  
  // Build instruction
  const swapIx = buildSwapImmediateInstruction(
    wallet.publicKey,
    poolId,
    amountInUnits,
    minAmountOutUnits,
    isBaseInput,
    poolAuthorityBump
  );
  
  // Create and send transaction
  const tx = new Transaction().add(swapIx);
  const signature = await sendAndConfirmTransaction(connection, tx, [wallet]);
  
  return signature;
}
```

## Relayer Integration

For applications that want to use the relayer service:

### Get Airdrop (Devnet Only)

```typescript
async function requestAirdrop(address: string, token?: 'SOL' | 'USDC' | 'WSOL') {
  const response = await fetch('http://localhost:8085/api/v1/airdrop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address,
      token: token || 'USDC',
      amount: token === 'SOL' ? 0.1 : token === 'WSOL' ? 10 : 1000
    })
  });
  
  return response.json();
}
```

### Get Pool Price

```typescript
async function getPoolPrice(poolId: string) {
  const response = await fetch(`http://localhost:8085/api/v1/pools/${poolId}/price`);
  return response.json();
}
```

### Submit Order (via Relayer)

```typescript
async function submitOrder(
  transaction: Transaction,
  poolId: string,
  amountIn: string,
  minAmountOut: string,
  isBaseInput: boolean,
  userPublicKey: string
) {
  const serialized = transaction.serialize({ 
    requireAllSignatures: false 
  }).toString('base64');
  
  const response = await fetch('http://localhost:8085/api/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transaction: serialized,
      poolId,
      amountIn,
      minAmountOut,
      isBaseInput,
      userPublicKey
    })
  });
  
  return response.json();
}
```

## Error Handling

Common errors and their meanings:

- `0xbba` (3002): AccountDiscriminatorMismatch - Account data doesn't match expected format
- `0xbc4` (3012): AccountNotInitialized - Account needs to be initialized first
- `0x1771` (6001): InvalidSequence - Order sequence number mismatch
- `0x1775` (6005): PoolNotRegistered - Pool not registered with Continuum

## Best Practices

1. **Always check balances** before attempting swaps
2. **Use appropriate slippage** - Set `minAmountOut` based on current pool price
3. **Handle transaction errors** gracefully with retry logic
4. **Monitor gas costs** - Add priority fees during high congestion
5. **Validate inputs** - Ensure amounts are within pool liquidity limits

## Testing on Devnet

1. Get devnet SOL: `solana airdrop 2 --url devnet`
2. Use the relayer's airdrop endpoint to get test tokens
3. Test with small amounts first
4. Monitor transactions on Solana Explorer

## Network-Specific Configurations

Always use the appropriate configuration for your network:

```typescript
// Devnet
const config = constants.devnet;

// Localnet (for development)
const config = constants.localnet;

// Mainnet (when available)
const config = constants.mainnet;
```

## Support

For issues or questions:
- GitHub: [Your Repository URL]
- Discord: [Your Discord Server]
- Documentation: [Additional Docs URL]