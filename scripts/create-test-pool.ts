#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

// Configuration
const CONFIG_FILE = path.join(__dirname, '../config/tokens.json');
const POOL_CONFIG_FILE = path.join(__dirname, '../config/pool.json');
const connection = new Connection('http://localhost:8899', 'confirmed');

// CP-Swap program ID (provided by user)
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

// Constants for CP-Swap
const AMM_CONFIG_SEED = Buffer.from('amm_config');
const POOL_SEED = Buffer.from('pool');
const POOL_VAULT_SEED = Buffer.from('pool_vault');
const POOL_LP_MINT_SEED = Buffer.from('pool_lp_mint');

interface PoolConfig {
  poolId: string;
  ammConfig: string;
  tokenAMint: string;
  tokenBMint: string;
  tokenAVault: string;
  tokenBVault: string;
  lpMint: string;
  continuum_authority: string;
}

async function createTestPool() {
  console.log('Creating CP-Swap pool on localnet...\n');

  // Load token configuration
  const tokenConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const usdcMint = new PublicKey(tokenConfig.usdcMint);
  const wsolMint = new PublicKey(tokenConfig.wsolMint);

  // Load payer keypair
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/home/ubuntu/.config/solana/id.json', 'utf8')))
  );
  console.log('Payer:', payerKeypair.publicKey.toBase58());

  // Sort tokens (CP-Swap requires token0 < token1)
  let token0Mint: PublicKey;
  let token1Mint: PublicKey;
  if (usdcMint.toBuffer().compare(wsolMint.toBuffer()) < 0) {
    token0Mint = usdcMint;
    token1Mint = wsolMint;
    console.log('Token ordering: USDC is token0, WSOL is token1');
  } else {
    token0Mint = wsolMint;
    token1Mint = usdcMint;
    console.log('Token ordering: WSOL is token0, USDC is token1');
  }

  // Derive AMM config PDA
  const [ammConfig] = PublicKey.findProgramAddressSync(
    [AMM_CONFIG_SEED, payerKeypair.publicKey.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );
  console.log('AMM Config PDA:', ammConfig.toBase58());

  // Create AMM config if it doesn't exist
  try {
    const ammConfigAccount = await connection.getAccountInfo(ammConfig);
    if (!ammConfigAccount) {
      console.log('Creating AMM config...');
      
      // Build create AMM config instruction
      const createConfigIx = await buildCreateAmmConfigInstruction(
        CP_SWAP_PROGRAM_ID,
        ammConfig,
        payerKeypair.publicKey,
        30, // 0.3% fee
        1   // tick spacing
      );

      const tx = new Transaction().add(createConfigIx);
      const sig = await sendAndConfirmTransaction(connection, tx, [payerKeypair]);
      console.log('AMM config created:', sig);
    } else {
      console.log('AMM config already exists');
    }
  } catch (err) {
    console.error('Error checking/creating AMM config:', err);
  }

  // Derive pool PDA
  const [poolId] = PublicKey.findProgramAddressSync(
    [POOL_SEED, ammConfig.toBuffer(), token0Mint.toBuffer(), token1Mint.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );
  console.log('Pool PDA:', poolId.toBase58());

  // Derive vault PDAs
  const [token0Vault] = PublicKey.findProgramAddressSync(
    [POOL_VAULT_SEED, poolId.toBuffer(), token0Mint.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );
  const [token1Vault] = PublicKey.findProgramAddressSync(
    [POOL_VAULT_SEED, poolId.toBuffer(), token1Mint.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );

  // Derive LP mint PDA
  const [lpMint] = PublicKey.findProgramAddressSync(
    [POOL_LP_MINT_SEED, poolId.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );

  console.log('\nPool details:');
  console.log('Token0 vault:', token0Vault.toBase58());
  console.log('Token1 vault:', token1Vault.toBase58());
  console.log('LP mint:', lpMint.toBase58());

  // Get user token accounts
  const userToken0Account = await getAssociatedTokenAddress(token0Mint, payerKeypair.publicKey);
  const userToken1Account = await getAssociatedTokenAddress(token1Mint, payerKeypair.publicKey);
  const userLpAccount = await getAssociatedTokenAddress(lpMint, payerKeypair.publicKey);

  // Build initialize pool instruction
  const initPoolIx = await buildInitializePoolInstruction(
    CP_SWAP_PROGRAM_ID,
    poolId,
    ammConfig,
    token0Mint,
    token1Mint,
    token0Vault,
    token1Vault,
    lpMint,
    payerKeypair.publicKey,
    userToken0Account,
    userToken1Account,
    userLpAccount,
    // Initial price: 1 USDC = 0.01 WSOL (100 USDC per WSOL)
    new BN(100 * 10 ** tokenConfig.decimals.usdc), // initial_price_numerator
    new BN(1 * 10 ** tokenConfig.decimals.wsol)    // initial_price_denominator
  );

  // Create associated token account for LP tokens
  const createLpAccountIx = createAssociatedTokenAccountInstruction(
    payerKeypair.publicKey,
    userLpAccount,
    payerKeypair.publicKey,
    lpMint
  );

  // Build and send transaction
  const tx = new Transaction()
    .add(createLpAccountIx)
    .add(initPoolIx);

  console.log('\nInitializing pool...');
  const sig = await sendAndConfirmTransaction(connection, tx, [payerKeypair], {
    skipPreflight: false,
    commitment: 'confirmed'
  });
  console.log('Pool initialized:', sig);

  // Now add initial liquidity
  console.log('\nAdding initial liquidity...');
  const depositIx = await buildDepositInstruction(
    CP_SWAP_PROGRAM_ID,
    poolId,
    token0Mint,
    token1Mint,
    token0Vault,
    token1Vault,
    lpMint,
    userToken0Account,
    userToken1Account,
    userLpAccount,
    payerKeypair.publicKey,
    new BN(10000 * 10 ** tokenConfig.decimals.usdc), // 10,000 USDC
    new BN(100 * 10 ** tokenConfig.decimals.wsol),   // 100 WSOL
    new BN(0) // min LP tokens (accept any amount)
  );

  const depositTx = new Transaction().add(depositIx);
  const depositSig = await sendAndConfirmTransaction(connection, depositTx, [payerKeypair]);
  console.log('Liquidity added:', depositSig);

  // Derive Continuum pool authority
  const [continuumAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('cp_pool_authority'), poolId.toBuffer()],
    new PublicKey('EaeWUSam5Li1fzCcCs33oE4jCLQT4F6RJXgrPYZaoKqq') // Continuum program
  );

  // Save pool configuration
  const poolConfig: PoolConfig = {
    poolId: poolId.toBase58(),
    ammConfig: ammConfig.toBase58(),
    tokenAMint: token0Mint.toBase58(),
    tokenBMint: token1Mint.toBase58(),
    tokenAVault: token0Vault.toBase58(),
    tokenBVault: token1Vault.toBase58(),
    lpMint: lpMint.toBase58(),
    continuum_authority: continuumAuthority.toBase58()
  };

  fs.writeFileSync(POOL_CONFIG_FILE, JSON.stringify(poolConfig, null, 2));
  console.log('\nPool configuration saved to:', POOL_CONFIG_FILE);

  console.log('\nPool creation complete!');
  console.log('Pool ID:', poolId.toBase58());
  console.log('Continuum authority:', continuumAuthority.toBase58());

  return poolConfig;
}

// Helper function to build create AMM config instruction
async function buildCreateAmmConfigInstruction(
  programId: PublicKey,
  ammConfig: PublicKey,
  owner: PublicKey,
  tradeFeeRate: number,
  tickSpacing: number
): Promise<anchor.web3.TransactionInstruction> {
  // CP-Swap create_amm_config instruction discriminator
  const discriminator = Buffer.from([72, 186, 156, 243, 103, 195, 75, 79]);
  
  const data = Buffer.concat([
    discriminator,
    new BN(tradeFeeRate).toArrayLike(Buffer, 'le', 8),
    new BN(tickSpacing).toArrayLike(Buffer, 'le', 2),
  ]);

  return new anchor.web3.TransactionInstruction({
    keys: [
      { pubkey: ammConfig, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

// Helper function to build initialize pool instruction
async function buildInitializePoolInstruction(
  programId: PublicKey,
  poolId: PublicKey,
  ammConfig: PublicKey,
  token0Mint: PublicKey,
  token1Mint: PublicKey,
  token0Vault: PublicKey,
  token1Vault: PublicKey,
  lpMint: PublicKey,
  creator: PublicKey,
  userToken0: PublicKey,
  userToken1: PublicKey,
  userLp: PublicKey,
  initPriceNum: BN,
  initPriceDen: BN
): Promise<anchor.web3.TransactionInstruction> {
  // CP-Swap initialize instruction discriminator
  const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);
  
  const data = Buffer.concat([
    discriminator,
    initPriceNum.toArrayLike(Buffer, 'le', 8),
    initPriceDen.toArrayLike(Buffer, 'le', 8),
  ]);

  return new anchor.web3.TransactionInstruction({
    keys: [
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: ammConfig, isSigner: false, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: token0Mint, isSigner: false, isWritable: false },
      { pubkey: token1Mint, isSigner: false, isWritable: false },
      { pubkey: lpMint, isSigner: false, isWritable: true },
      { pubkey: userToken0, isSigner: false, isWritable: true },
      { pubkey: userToken1, isSigner: false, isWritable: true },
      { pubkey: userLp, isSigner: false, isWritable: true },
      { pubkey: token0Vault, isSigner: false, isWritable: true },
      { pubkey: token1Vault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: anchor.web3.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

// Helper function to build deposit instruction
async function buildDepositInstruction(
  programId: PublicKey,
  poolId: PublicKey,
  token0Mint: PublicKey,
  token1Mint: PublicKey,
  token0Vault: PublicKey,
  token1Vault: PublicKey,
  lpMint: PublicKey,
  userToken0: PublicKey,
  userToken1: PublicKey,
  userLp: PublicKey,
  owner: PublicKey,
  amount0: BN,
  amount1: BN,
  minLpAmount: BN
): Promise<anchor.web3.TransactionInstruction> {
  // CP-Swap deposit instruction discriminator
  const discriminator = Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]);
  
  const data = Buffer.concat([
    discriminator,
    amount0.toArrayLike(Buffer, 'le', 8),
    amount1.toArrayLike(Buffer, 'le', 8),
    minLpAmount.toArrayLike(Buffer, 'le', 8),
  ]);

  return new anchor.web3.TransactionInstruction({
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: lpMint, isSigner: false, isWritable: true },
      { pubkey: userToken0, isSigner: false, isWritable: true },
      { pubkey: userToken1, isSigner: false, isWritable: true },
      { pubkey: userLp, isSigner: false, isWritable: true },
      { pubkey: token0Vault, isSigner: false, isWritable: true },
      { pubkey: token1Vault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

// Run if called directly
if (require.main === module) {
  createTestPool()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error creating pool:', err);
      process.exit(1);
    });
}

export { createTestPool };