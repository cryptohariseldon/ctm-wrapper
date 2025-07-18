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
  getAccount,
  createSyncNativeInstruction,
  NATIVE_MINT
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

// Configuration
const TOKEN_CONFIG_FILE = path.join(__dirname, '../config/tokens.json');
const POOL_CONFIG_FILE = path.join(__dirname, '../config/cp-pool.json');
const connection = new Connection('http://localhost:8899', 'confirmed');

// CP-Swap program ID (provided by user)
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

// Constants for CP-Swap
const AMM_CONFIG_SEED = Buffer.from('amm_config');
const POOL_SEED = Buffer.from('pool');
const POOL_VAULT_SEED = Buffer.from('pool_vault');
const POOL_LP_MINT_SEED = Buffer.from('pool_lp_mint');
const POOL_OBSERVATION_SEED = Buffer.from('observation');

interface CpPoolConfig {
  poolId: string;
  ammConfig: string;
  tokenAMint: string;
  tokenBMint: string;
  tokenAVault: string;
  tokenBVault: string;
  lpMint: string;
  observationState: string;
  creatorTokenA: string;
  creatorTokenB: string;
  creatorLp: string;
  feeRate: number;
  tickSpacing: number;
  initialPrice: string;
}

async function createCpSwapPool() {
  console.log('Creating CP-Swap pool on localnet...\n');

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
  let token0Decimals: number;
  let token1Decimals: number;
  let token0Symbol: string;
  let token1Symbol: string;
  if (usdcMint.toBuffer().compare(wsolMint.toBuffer()) < 0) {
    token0Mint = usdcMint;
    token1Mint = wsolMint;
    token0Decimals = tokenConfig.decimals.usdc;
    token1Decimals = tokenConfig.decimals.wsol;
    token0Symbol = 'USDC';
    token1Symbol = 'WSOL';
    console.log('Token ordering: USDC is token0, WSOL is token1');
  } else {
    token0Mint = wsolMint;
    token1Mint = usdcMint;
    token0Decimals = tokenConfig.decimals.wsol;
    token1Decimals = tokenConfig.decimals.usdc;
    token0Symbol = 'WSOL';
    token1Symbol = 'USDC';
    console.log('Token ordering: WSOL is token0, USDC is token1');
  }

  // AMM Config parameters
  const feeRate = 2500; // 0.25% fee (2500 / 1_000_000)
  const tickSpacing = 10; // Standard tick spacing

  // Derive AMM config PDA with index 0
  const ammConfigIndex = 0;
  const [ammConfig] = PublicKey.findProgramAddressSync(
    [AMM_CONFIG_SEED, new BN(ammConfigIndex).toArrayLike(Buffer, 'le', 2)],
    CP_SWAP_PROGRAM_ID
  );
  console.log('AMM Config PDA:', ammConfig.toBase58());

  // Step 1: Create AMM config if it doesn't exist
  try {
    const ammConfigAccount = await connection.getAccountInfo(ammConfig);
    if (!ammConfigAccount) {
      console.log('\nCreating AMM config...');
      
      const createConfigIx = buildCreateAmmConfigInstruction(
        CP_SWAP_PROGRAM_ID,
        ammConfig,
        payerKeypair.publicKey,
        ammConfigIndex,
        feeRate,
        tickSpacing
      );

      const tx = new Transaction().add(createConfigIx);
      const sig = await sendAndConfirmTransaction(connection, tx, [payerKeypair]);
      console.log('AMM config created:', sig);
    } else {
      console.log('AMM config already exists');
    }
  } catch (err) {
    console.error('Error creating AMM config:', err);
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

  console.log('\nPool details:');
  console.log('Token0 vault:', token0Vault.toBase58());
  console.log('Token1 vault:', token1Vault.toBase58());
  console.log('LP mint:', lpMint.toBase58());
  console.log('Observation state:', observationState.toBase58());

  // Get user token accounts
  const userToken0Account = await getAssociatedTokenAddress(token0Mint, payerKeypair.publicKey);
  const userToken1Account = await getAssociatedTokenAddress(token1Mint, payerKeypair.publicKey);
  const userLpAccount = await getAssociatedTokenAddress(lpMint, payerKeypair.publicKey);

  // Create fee account if needed
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
  try {
    const poolAccount = await connection.getAccountInfo(poolId);
    if (!poolAccount) {
      console.log('\nInitializing pool...');

      // Calculate initial amounts
      const initAmount0 = new BN(10000 * Math.pow(10, token0Decimals)); // 10,000 of token0
      const initAmount1 = new BN(10000 * Math.pow(10, token1Decimals)); // 10,000 of token1

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
        initAmount1
      );

      const tx = new Transaction()
        .add(initPoolIx);

      const sig = await sendAndConfirmTransaction(connection, tx, [payerKeypair], {
        skipPreflight: false,
        commitment: 'confirmed'
      });
      console.log('Pool initialized with liquidity:', sig);
      
      // Save updated pool configuration
      const poolConfig: CpPoolConfig = {
        poolId: poolId.toBase58(),
        ammConfig: ammConfig.toBase58(),
        tokenAMint: token0Mint.toBase58(),
        tokenBMint: token1Mint.toBase58(),
        tokenAVault: token0Vault.toBase58(),
        tokenBVault: token1Vault.toBase58(),
        lpMint: lpMint.toBase58(),
        observationState: observationState.toBase58(),
        creatorTokenA: userToken0Account.toBase58(),
        creatorTokenB: userToken1Account.toBase58(),
        creatorLp: userLpAccount.toBase58(),
        feeRate,
        tickSpacing,
        initialPrice: `${token0Symbol}/${token1Symbol}`
      };

      fs.writeFileSync(POOL_CONFIG_FILE, JSON.stringify(poolConfig, null, 2));
      console.log('\nPool configuration saved to:', POOL_CONFIG_FILE);

    } else {
      console.log('Pool already exists');
    }
  } catch (err) {
    console.error('Error creating pool:', err);
    if (err.logs) {
      console.error('Transaction logs:', err.logs);
    }
  }

  console.log('\n✅ CP-Swap pool creation complete!');
  console.log('Pool ID:', poolId.toBase58());
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
  initAmount1: BN
): Promise<anchor.web3.TransactionInstruction> {
  // initialize discriminator [175, 175, 109, 31, 13, 152, 155, 237]
  const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);
  
  const data = Buffer.concat([
    discriminator,
    initAmount0.toArrayLike(Buffer, 'le', 8), // init_amount_0 as u64
    initAmount1.toArrayLike(Buffer, 'le', 8), // init_amount_1 as u64
    new BN(0).toArrayLike(Buffer, 'le', 8), // open_time as u64
    Buffer.from([0]), // authority_type as u8 (0 for default PDA)
    Buffer.from([0]), // custom_authority as Option<Pubkey> (None = 0)
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
  
  // Create pool fee receiver (using WSOL as fee token)
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

// Helper function to build deposit instruction
function buildDepositInstruction(
  programId: PublicKey,
  poolId: PublicKey,
  lpMint: PublicKey,
  userToken0: PublicKey,
  userToken1: PublicKey,
  userLp: PublicKey,
  token0Vault: PublicKey,
  token1Vault: PublicKey,
  owner: PublicKey,
  amount0Max: BN,
  amount1Max: BN,
  minLpAmount: BN
): anchor.web3.TransactionInstruction {
  // deposit discriminator [242, 35, 198, 137, 82, 225, 242, 182]
  const discriminator = Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]);
  
  const data = Buffer.concat([
    discriminator,
    minLpAmount.toArrayLike(Buffer, 'le', 8), // lp_token_amount
    amount0Max.toArrayLike(Buffer, 'le', 8), // maximum_token_0_amount
    amount1Max.toArrayLike(Buffer, 'le', 8), // maximum_token_1_amount
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
  createCpSwapPool()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}

export { createCpSwapPool };