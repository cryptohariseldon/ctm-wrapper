#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction, 
  SystemProgram, 
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

// Configuration
const TOKEN_CONFIG_FILE = path.join(__dirname, '../config/tokens.json');
const POOL_CONFIG_FILE = path.join(__dirname, '../config/working-pool.json');
const connection = new Connection('http://localhost:8899', 'confirmed');

// Program IDs
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');
const CONTINUUM_PROGRAM_ID = new PublicKey('EaeWUSam5Li1fzCcCs33oE4jCLQT4F6RJXgrPYZaoKqq');

// Constants for CP-Swap
const AMM_CONFIG_SEED = Buffer.from('amm_config');
const POOL_SEED = Buffer.from('pool');
const POOL_VAULT_SEED = Buffer.from('pool_vault');
const POOL_LP_MINT_SEED = Buffer.from('pool_lp_mint');
const POOL_OBSERVATION_SEED = Buffer.from('observation');

async function createWorkingPool() {
  console.log('Creating a working CP-Swap pool...\n');

  // Load token configuration
  const tokenConfig = JSON.parse(fs.readFileSync(TOKEN_CONFIG_FILE, 'utf8'));
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

  // Try a different AMM config index since 0 seems problematic
  const ammConfigIndex = 10; // Use index 10 instead of 0
  const [ammConfig] = PublicKey.findProgramAddressSync(
    [AMM_CONFIG_SEED, new BN(ammConfigIndex).toArrayLike(Buffer, 'le', 2)],
    CP_SWAP_PROGRAM_ID
  );
  console.log('AMM Config PDA (index', ammConfigIndex, '):', ammConfig.toBase58());

  // Step 1: Create AMM config
  const ammConfigAccount = await connection.getAccountInfo(ammConfig);
  if (!ammConfigAccount) {
    console.log('\nCreating AMM config...');
    
    const feeRate = 2500; // 0.25% fee
    const createConfigIx = buildCreateAmmConfigInstruction(
      CP_SWAP_PROGRAM_ID,
      ammConfig,
      payerKeypair.publicKey,
      ammConfigIndex,
      feeRate,
      10
    );

    const tx = new Transaction().add(createConfigIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [payerKeypair]);
    console.log('AMM config created:', sig);
  } else {
    console.log('AMM config already exists');
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

  // Derive observation state PDA
  const [observationState] = PublicKey.findProgramAddressSync(
    [POOL_OBSERVATION_SEED, poolId.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );

  // Get user token accounts
  const userToken0Account = await getAssociatedTokenAddress(token0Mint, payerKeypair.publicKey);
  const userToken1Account = await getAssociatedTokenAddress(token1Mint, payerKeypair.publicKey);
  const userLpAccount = await getAssociatedTokenAddress(lpMint, payerKeypair.publicKey);

  // Create fee account
  const feeOwner = new PublicKey('GsV1jugD8ftfWBYNykA9SLK2V4mQqUW2sLop8MAfjVRq');
  const feeAccount = await getAssociatedTokenAddress(token0Mint, feeOwner);
  
  const feeAccountInfo = await connection.getAccountInfo(feeAccount);
  if (!feeAccountInfo) {
    console.log('\nCreating fee account...');
    const createFeeAccountIx = createAssociatedTokenAccountInstruction(
      payerKeypair.publicKey,
      feeAccount,
      feeOwner,
      token0Mint
    );
    const tx = new Transaction().add(createFeeAccountIx);
    await sendAndConfirmTransaction(connection, tx, [payerKeypair]);
  }

  // Step 2: Initialize pool
  const poolAccount = await connection.getAccountInfo(poolId);
  if (!poolAccount) {
    console.log('\nInitializing pool...');

    // Calculate initial amounts
    const initAmount0 = new BN(10000 * Math.pow(10, tokenConfig.decimals.wsol)); 
    const initAmount1 = new BN(10000 * Math.pow(10, tokenConfig.decimals.usdc));

    // Derive Continuum's cp_pool_authority PDA
    const [cpPoolAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('cp_pool_authority'), poolId.toBuffer()],
      CONTINUUM_PROGRAM_ID
    );
    console.log('Setting custom authority to Continuum cp_pool_authority:', cpPoolAuthority.toBase58());

    const initPoolIx = await buildInitializePoolInstruction(
      CP_SWAP_PROGRAM_ID,
      poolId,
      ammConfig,
      token0Mint,
      token1Mint,
      token0Vault,
      token1Vault,
      lpMint,
      observationState,
      payerKeypair.publicKey,
      initAmount0,
      initAmount1,
      cpPoolAuthority
    );

    const tx = new Transaction().add(initPoolIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [payerKeypair], {
      skipPreflight: false,
      commitment: 'confirmed'
    });
    console.log('Pool initialized:', sig);
    
    // Save pool configuration
    const poolConfig = {
      poolId: poolId.toBase58(),
      ammConfig: ammConfig.toBase58(),
      ammConfigIndex: ammConfigIndex,
      tokenAMint: token0Mint.toBase58(),
      tokenBMint: token1Mint.toBase58(),
      tokenAVault: token0Vault.toBase58(),
      tokenBVault: token1Vault.toBase58(),
      lpMint: lpMint.toBase58(),
      observationState: observationState.toBase58(),
      creatorTokenA: userToken0Account.toBase58(),
      creatorTokenB: userToken1Account.toBase58(),
      creatorLp: userLpAccount.toBase58(),
      feeRate: 2500,
      tickSpacing: 10,
      cpPoolAuthority: cpPoolAuthority.toBase58(),
      authorityType: 1
    };

    fs.writeFileSync(POOL_CONFIG_FILE, JSON.stringify(poolConfig, null, 2));
    console.log('\nPool configuration saved to:', POOL_CONFIG_FILE);
  } else {
    console.log('Pool already exists');
  }

  console.log('\n✅ Working pool creation complete!');
}

// Helper function to build create AMM config instruction
function buildCreateAmmConfigInstruction(
  programId: PublicKey,
  ammConfig: PublicKey,
  owner: PublicKey,
  index: number,
  tradeFeeRate: number,
  tickSpacing: number
): anchor.web3.TransactionInstruction {
  // create_amm_config discriminator from IDL
  const discriminator = Buffer.from([137, 52, 237, 212, 215, 117, 108, 104]);
  
  const data = Buffer.concat([
    discriminator,
    new BN(index).toArrayLike(Buffer, 'le', 2), // index as u16
    new BN(tradeFeeRate).toArrayLike(Buffer, 'le', 8), // trade_fee_rate as u64
    new BN(0).toArrayLike(Buffer, 'le', 8), // protocol_fee_rate as u64
    new BN(0).toArrayLike(Buffer, 'le', 8), // fund_fee_rate as u64
    new BN(0).toArrayLike(Buffer, 'le', 8), // create_pool_fee as u64
  ]);

  return new anchor.web3.TransactionInstruction({
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: ammConfig, isSigner: false, isWritable: true },
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
  observationState: PublicKey,
  creator: PublicKey,
  initAmount0: BN,
  initAmount1: BN,
  customAuthority: PublicKey
): Promise<anchor.web3.TransactionInstruction> {
  // initialize discriminator
  const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);
  
  const data = Buffer.concat([
    discriminator,
    initAmount0.toArrayLike(Buffer, 'le', 8), // init_amount_0 as u64
    initAmount1.toArrayLike(Buffer, 'le', 8), // init_amount_1 as u64
    new BN(0).toArrayLike(Buffer, 'le', 8), // open_time as u64
    Buffer.from([1]), // authority_type as u8 (1 for custom authority)
    Buffer.from([1]), // Option tag (1 = Some)
    customAuthority.toBuffer(), // custom_authority pubkey
  ]);

  // Derive authority
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_and_lp_mint_auth_seed')],
    programId
  );
  
  // Get user token accounts
  const creatorToken0 = await getAssociatedTokenAddress(token0Mint, creator);
  const creatorToken1 = await getAssociatedTokenAddress(token1Mint, creator);
  const creatorLpToken = await getAssociatedTokenAddress(lpMint, creator);
  
  // Create pool fee receiver
  const feeOwner = new PublicKey('GsV1jugD8ftfWBYNykA9SLK2V4mQqUW2sLop8MAfjVRq');
  const createPoolFee = await getAssociatedTokenAddress(token0Mint, feeOwner);

  return new anchor.web3.TransactionInstruction({
    keys: [
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: ammConfig, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: false, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: token0Mint, isSigner: false, isWritable: false },
      { pubkey: token1Mint, isSigner: false, isWritable: false },
      { pubkey: lpMint, isSigner: false, isWritable: true },
      { pubkey: creatorToken0, isSigner: false, isWritable: true },
      { pubkey: creatorToken1, isSigner: false, isWritable: true },
      { pubkey: creatorLpToken, isSigner: false, isWritable: true },
      { pubkey: token0Vault, isSigner: false, isWritable: true },
      { pubkey: token1Vault, isSigner: false, isWritable: true },
      { pubkey: createPoolFee, isSigner: false, isWritable: true },
      { pubkey: observationState, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_0_program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_1_program
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

// Run if called directly
if (require.main === module) {
  createWorkingPool()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}

export { createWorkingPool };