import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { ContinuumClient, InitializeCpSwapPoolParams } from '../src';
import { Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { 
  createMint, 
  getOrCreateAssociatedTokenAccount, 
  mintTo,
  getAssociatedTokenAddress
} from '@solana/spl-token';

/**
 * Example: Create a CP-Swap pool through Continuum
 * This demonstrates how to initialize a new AMM pool with Continuum authority
 */
async function createPoolExample() {
  // Configuration
  const connection = new Connection('http://localhost:8899', 'confirmed');
  
  // Admin keypair (in production, use your wallet)
  const admin = Keypair.generate();
  
  // Airdrop SOL for fees
  console.log('Requesting airdrop...');
  const airdropSig = await connection.requestAirdrop(admin.publicKey, 5e9); // 5 SOL
  await connection.confirmTransaction(airdropSig);
  console.log('Airdrop successful');

  // Create wallet for Continuum client
  const wallet = new Wallet(admin);
  const client = new ContinuumClient(connection, wallet);

  console.log('\n=== Step 1: Initialize Continuum FIFO State ===');
  
  try {
    const initSig = await client.initialize(admin);
    console.log('Continuum initialized:', initSig);
  } catch (error) {
    console.log('Continuum already initialized or error:', error.message);
  }

  console.log('\n=== Step 2: Create Tokens ===');
  
  // Create mint authorities
  const mintAuthorityA = Keypair.generate();
  const mintAuthorityB = Keypair.generate();
  
  // Create Token A (e.g., USDC-like with 6 decimals)
  const tokenA = await createMint(
    connection,
    admin,
    mintAuthorityA.publicKey,
    null,
    6
  );
  console.log('Token A created:', tokenA.toBase58());
  
  // Create Token B (e.g., SOL-like with 9 decimals)
  const tokenB = await createMint(
    connection,
    admin,
    mintAuthorityB.publicKey,
    null,
    9
  );
  console.log('Token B created:', tokenB.toBase58());

  // Sort tokens (CP-Swap requires token0 < token1)
  const [token0, token1, mintAuth0, mintAuth1] = tokenA.toBuffer().compare(tokenB.toBuffer()) < 0
    ? [tokenA, tokenB, mintAuthorityA, mintAuthorityB]
    : [tokenB, tokenA, mintAuthorityB, mintAuthorityA];
  
  console.log('Token 0 (sorted):', token0.toBase58());
  console.log('Token 1 (sorted):', token1.toBase58());

  console.log('\n=== Step 3: Create and Fund Token Accounts ===');
  
  // Create admin token accounts
  const adminToken0Account = await getOrCreateAssociatedTokenAccount(
    connection,
    admin,
    token0,
    admin.publicKey
  );
  
  const adminToken1Account = await getOrCreateAssociatedTokenAccount(
    connection,
    admin,
    token1,
    admin.publicKey
  );
  
  // Mint tokens to admin
  const amount0 = 1_000_000 * 10 ** 6; // 1M tokens with 6 decimals
  const amount1 = 500_000 * 10 ** 9;   // 500K tokens with 9 decimals
  
  await mintTo(
    connection,
    admin,
    token0,
    adminToken0Account.address,
    mintAuth0,
    amount0
  );
  console.log('Minted', amount0 / 10 ** 6, 'Token 0 to admin');
  
  await mintTo(
    connection,
    admin,
    token1,
    adminToken1Account.address,
    mintAuth1,
    amount1
  );
  console.log('Minted', amount1 / 10 ** 9, 'Token 1 to admin');

  console.log('\n=== Step 4: Find or Create AMM Config ===');
  
  // CP-Swap AMM config (you may need to adjust these values)
  const ammConfigIndex = 0;
  const tradeFeeRate = new BN(10);      // 0.01% (10 / 100000)
  const protocolFeeRate = new BN(1000); // 1% of trade fee
  const fundFeeRate = new BN(25000);    // 25% of trade fee
  
  // Note: In production, you would check if config exists first
  // For this example, we'll assume it exists or handle the error

  console.log('\n=== Step 5: Create Pool ===');
  
  // Initial liquidity amounts
  const initAmount0 = new BN(100_000 * 10 ** 6); // 100K token0
  const initAmount1 = new BN(50_000 * 10 ** 9);  // 50K token1
  const openTime = new BN(0); // Pool opens immediately
  
  // Pool creation parameters
  const poolParams: InitializeCpSwapPoolParams = {
    admin: admin.publicKey,
    token0,
    token1,
    ammConfigIndex,
    initAmount0,
    initAmount1,
    openTime,
    adminToken0: adminToken0Account.address,
    adminToken1: adminToken1Account.address,
    feeReceiver: admin.publicKey, // Fee receiver for protocol fees
  };
  
  try {
    const poolSig = await client.initializeCpSwapPool(admin, poolParams);
    console.log('Pool created successfully!');
    console.log('Transaction signature:', poolSig);
    
    // Derive pool ID
    const [poolState] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('pool'),
        Buffer.from([ammConfigIndex, 0]), // Config index as 2 bytes
        token0.toBuffer(),
        token1.toBuffer(),
      ],
      new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp') // CP-Swap program ID
    );
    
    console.log('\n=== Pool Summary ===');
    console.log('Pool ID:', poolState.toBase58());
    console.log('Token 0:', token0.toBase58());
    console.log('Token 1:', token1.toBase58());
    console.log('Initial liquidity:');
    console.log('  - Token 0:', initAmount0.toNumber() / 10 ** 6);
    console.log('  - Token 1:', initAmount1.toNumber() / 10 ** 9);
    console.log('Initial price:', (initAmount1.toNumber() / 10 ** 9) / (initAmount0.toNumber() / 10 ** 6), 'Token1/Token0');
    
    // Get pool registry info
    const registry = await client.getPoolRegistry(poolState);
    if (registry) {
      console.log('\n=== Pool Registry ===');
      console.log('Pool active:', registry.isActive);
      console.log('Continuum authority:', registry.continuumAuthority.toBase58());
    }
    
    return {
      poolId: poolState,
      token0,
      token1,
      admin,
    };
    
  } catch (error) {
    console.error('Error creating pool:', error);
    throw error;
  }
}

// Advanced example: Create pool with custom parameters
async function createCustomPool(
  connection: Connection,
  admin: Keypair,
  token0: PublicKey,
  token1: PublicKey,
  initPrice: number, // Price of token1 in terms of token0
  liquidityAmount: number // Amount of token0 to provide as liquidity
) {
  const wallet = new Wallet(admin);
  const client = new ContinuumClient(connection, wallet);
  
  // Calculate token amounts based on price
  const token0Decimals = 6; // Assume 6 decimals
  const token1Decimals = 9; // Assume 9 decimals
  
  const initAmount0 = new BN(liquidityAmount * 10 ** token0Decimals);
  const initAmount1 = new BN(liquidityAmount * initPrice * 10 ** token1Decimals);
  
  console.log('Creating pool with:');
  console.log('  Initial price:', initPrice, 'Token1/Token0');
  console.log('  Token 0 amount:', liquidityAmount);
  console.log('  Token 1 amount:', liquidityAmount * initPrice);
  
  // Get admin token accounts
  const adminToken0 = await getAssociatedTokenAddress(token0, admin.publicKey);
  const adminToken1 = await getAssociatedTokenAddress(token1, admin.publicKey);
  
  const poolParams: InitializeCpSwapPoolParams = {
    admin: admin.publicKey,
    token0,
    token1,
    ammConfigIndex: 0,
    initAmount0,
    initAmount1,
    openTime: new BN(0),
    adminToken0,
    adminToken1,
    feeReceiver: admin.publicKey,
  };
  
  const signature = await client.initializeCpSwapPool(admin, poolParams);
  console.log('Custom pool created:', signature);
  
  return signature;
}

// Run the example
if (require.main === module) {
  createPoolExample()
    .then((result) => {
      console.log('\nPool creation completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Error creating pool:', error);
      process.exit(1);
    });
}

export { createPoolExample, createCustomPool };