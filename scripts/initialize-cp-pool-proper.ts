#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction, 
  SystemProgram, 
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY
} from '@solana/web3.js';
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
const TOKEN_CONFIG_FILE = path.join(__dirname, '../config/tokens.json');
const POOL_CONFIG_FILE = path.join(__dirname, '../config/cp-pool-proper.json');
const connection = new Connection('http://localhost:8899', 'confirmed');

// CP-Swap program ID
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

// Instruction discriminators (from analysis)
const DISCRIMINATORS = {
  CREATE_AMM_CONFIG: [72, 186, 156, 243, 103, 195, 75, 79],
  INITIALIZE: [175, 175, 109, 31, 13, 152, 155, 237],
  DEPOSIT: [242, 35, 198, 137, 82, 225, 242, 182],
  SWAP_BASE_INPUT: [143, 190, 90, 218, 196, 30, 51, 222]
};

interface PoolConfig {
  // AMM Config
  ammConfig: string;
  ammConfigIndex: number;
  tradeFeeRate: number;
  tickSpacing: number;
  
  // Pool accounts
  poolId: string;
  token0Mint: string;
  token1Mint: string;
  token0Vault: string;
  token1Vault: string;
  lpMint: string;
  observationState: string;
  
  // Pool parameters
  initialPrice: number;
  sqrtPriceX64: string;
  
  // Initial liquidity
  initialToken0Amount: string;
  initialToken1Amount: string;
  
  // Metadata
  token0Symbol: string;
  token1Symbol: string;
  createdAt: number;
}

async function initializeCpPoolProperly() {
  console.log('=== CP-Swap Pool Initialization ===\n');

  // Load token configuration
  const tokenConfig = JSON.parse(fs.readFileSync(TOKEN_CONFIG_FILE, 'utf8'));
  const usdcMint = new PublicKey(tokenConfig.usdcMint);
  const wsolMint = new PublicKey(tokenConfig.wsolMint);

  // Load payer keypair
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/home/ubuntu/.config/solana/id.json', 'utf8')))
  );
  console.log('Payer:', payerKeypair.publicKey.toBase58());
  
  // Check payer balance
  const balance = await connection.getBalance(payerKeypair.publicKey);
  console.log('Balance:', balance / 1e9, 'SOL\n');

  // Step 1: Sort tokens (CRITICAL: token0 < token1)
  console.log('Step 1: Sorting tokens...');
  let token0Mint: PublicKey;
  let token1Mint: PublicKey;
  let token0Symbol: string;
  let token1Symbol: string;
  let token0Decimals: number;
  let token1Decimals: number;
  
  if (usdcMint.toBuffer().compare(wsolMint.toBuffer()) < 0) {
    token0Mint = usdcMint;
    token1Mint = wsolMint;
    token0Symbol = 'USDC';
    token1Symbol = 'WSOL';
    token0Decimals = tokenConfig.decimals.usdc;
    token1Decimals = tokenConfig.decimals.wsol;
  } else {
    token0Mint = wsolMint;
    token1Mint = usdcMint;
    token0Symbol = 'WSOL';
    token1Symbol = 'USDC';
    token0Decimals = tokenConfig.decimals.wsol;
    token1Decimals = tokenConfig.decimals.usdc;
  }
  
  console.log(`Token0: ${token0Symbol} (${token0Mint.toBase58()})`);
  console.log(`Token1: ${token1Symbol} (${token1Mint.toBase58()})`);

  // Step 2: Derive AMM Config PDA
  console.log('\nStep 2: Deriving AMM Config PDA...');
  const ammConfigIndex = 0; // Using index 0 for our first config
  const [ammConfig, ammConfigBump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('amm_config'),
      payerKeypair.publicKey.toBuffer(),
      Buffer.from([ammConfigIndex])
    ],
    CP_SWAP_PROGRAM_ID
  );
  console.log('AMM Config:', ammConfig.toBase58());
  console.log('AMM Config Bump:', ammConfigBump);

  // Step 3: Create AMM Config
  console.log('\nStep 3: Creating AMM Config...');
  const tradeFeeRate = 2500; // 0.25% = 2500 / 1_000_000
  const tickSpacing = 10;    // Standard tick spacing
  const protocolFeeRate = 0; // No protocol fee initially
  const fundFeeRate = 0;     // No fund fee initially

  try {
    const ammConfigAccount = await connection.getAccountInfo(ammConfig);
    if (!ammConfigAccount) {
      const createConfigTx = new Transaction().add(
        createAmmConfigInstruction(
          payerKeypair.publicKey,
          ammConfig,
          ammConfigIndex,
          tickSpacing,
          tradeFeeRate,
          protocolFeeRate,
          fundFeeRate
        )
      );
      
      const sig = await sendAndConfirmTransaction(
        connection,
        createConfigTx,
        [payerKeypair],
        { commitment: 'confirmed' }
      );
      console.log('AMM Config created:', sig);
    } else {
      console.log('AMM Config already exists');
    }
  } catch (err) {
    console.error('Error creating AMM config:', err);
    throw err;
  }

  // Step 4: Derive all pool PDAs
  console.log('\nStep 4: Deriving pool PDAs...');
  
  const [poolId, poolBump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('pool'),
      ammConfig.toBuffer(),
      token0Mint.toBuffer(),
      token1Mint.toBuffer()
    ],
    CP_SWAP_PROGRAM_ID
  );
  
  const [token0Vault, token0VaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_vault'), poolId.toBuffer(), token0Mint.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );
  
  const [token1Vault, token1VaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_vault'), poolId.toBuffer(), token1Mint.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );
  
  const [lpMint, lpMintBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_lp_mint'), poolId.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );
  
  const [observationState, observationBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('observation'), poolId.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );

  console.log('Pool ID:', poolId.toBase58());
  console.log('Token0 Vault:', token0Vault.toBase58());
  console.log('Token1 Vault:', token1Vault.toBase58());
  console.log('LP Mint:', lpMint.toBase58());
  console.log('Observation State:', observationState.toBase58());

  // Step 5: Calculate initial price
  console.log('\nStep 5: Calculating initial price...');
  // Price = amount of token1 per token0
  // Example: 1 WSOL = 100 USDC, so price = 100
  const initialPrice = token0Symbol === 'WSOL' ? 0.01 : 100; // Adjust based on token order
  const sqrtPrice = Math.sqrt(initialPrice);
  const sqrtPriceX64 = new BN(sqrtPrice * Math.pow(2, 64));
  
  console.log(`Initial price: 1 ${token0Symbol} = ${initialPrice} ${token1Symbol}`);
  console.log('Sqrt price:', sqrtPrice);
  console.log('Sqrt price X64:', sqrtPriceX64.toString());

  // Step 6: Initialize pool
  console.log('\nStep 6: Initializing pool...');
  try {
    const poolAccount = await connection.getAccountInfo(poolId);
    if (!poolAccount) {
      const openTime = 0; // Open immediately
      
      const initPoolTx = new Transaction().add(
        initializePoolInstruction(
          payerKeypair.publicKey,
          ammConfig,
          poolId,
          token0Mint,
          token1Mint,
          lpMint,
          token0Vault,
          token1Vault,
          observationState,
          sqrtPriceX64,
          new BN(openTime)
        )
      );
      
      const sig = await sendAndConfirmTransaction(
        connection,
        initPoolTx,
        [payerKeypair],
        { commitment: 'confirmed', skipPreflight: true }
      );
      console.log('Pool initialized:', sig);
    } else {
      console.log('Pool already exists');
    }
  } catch (err) {
    console.error('Error initializing pool:', err);
    if (err.logs) {
      console.error('Logs:', err.logs);
    }
    throw err;
  }

  // Step 7: Create LP token account
  console.log('\nStep 7: Creating LP token account...');
  const userLpAccount = await getAssociatedTokenAddress(lpMint, payerKeypair.publicKey);
  
  try {
    await getAccount(connection, userLpAccount);
    console.log('LP account already exists');
  } catch {
    const createLpTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payerKeypair.publicKey,
        userLpAccount,
        payerKeypair.publicKey,
        lpMint
      )
    );
    
    const sig = await sendAndConfirmTransaction(connection, createLpTx, [payerKeypair]);
    console.log('LP account created:', sig);
  }

  // Step 8: Add initial liquidity
  console.log('\nStep 8: Adding initial liquidity...');
  const userToken0Account = await getAssociatedTokenAddress(token0Mint, payerKeypair.publicKey);
  const userToken1Account = await getAssociatedTokenAddress(token1Mint, payerKeypair.publicKey);
  
  // Check user balances
  const token0Balance = await connection.getTokenAccountBalance(userToken0Account);
  const token1Balance = await connection.getTokenAccountBalance(userToken1Account);
  
  console.log(`User ${token0Symbol} balance:`, token0Balance.value.uiAmount);
  console.log(`User ${token1Symbol} balance:`, token1Balance.value.uiAmount);
  
  // Calculate deposit amounts based on price
  const token0Amount = new BN(1000 * Math.pow(10, token0Decimals)); // 1000 token0
  const token1Amount = new BN(initialPrice * 1000 * Math.pow(10, token1Decimals)); // Proportional token1
  
  console.log(`Depositing ${1000} ${token0Symbol} and ${initialPrice * 1000} ${token1Symbol}`);
  
  try {
    const depositTx = new Transaction().add(
      depositInstruction(
        payerKeypair.publicKey,
        poolId,
        lpMint,
        userToken0Account,
        userToken1Account,
        userLpAccount,
        token0Vault,
        token1Vault,
        new BN(0), // Min LP amount (accept any)
        token0Amount,
        token1Amount
      )
    );
    
    const sig = await sendAndConfirmTransaction(
      connection,
      depositTx,
      [payerKeypair],
      { commitment: 'confirmed' }
    );
    console.log('Initial liquidity added:', sig);
    
    // Check LP balance
    const lpBalance = await connection.getTokenAccountBalance(userLpAccount);
    console.log('LP tokens received:', lpBalance.value.uiAmount);
  } catch (err) {
    console.error('Error adding liquidity:', err);
    if (err.logs) {
      console.error('Logs:', err.logs);
    }
  }

  // Save configuration
  const poolConfig: PoolConfig = {
    // AMM Config
    ammConfig: ammConfig.toBase58(),
    ammConfigIndex,
    tradeFeeRate,
    tickSpacing,
    
    // Pool accounts
    poolId: poolId.toBase58(),
    token0Mint: token0Mint.toBase58(),
    token1Mint: token1Mint.toBase58(),
    token0Vault: token0Vault.toBase58(),
    token1Vault: token1Vault.toBase58(),
    lpMint: lpMint.toBase58(),
    observationState: observationState.toBase58(),
    
    // Pool parameters
    initialPrice,
    sqrtPriceX64: sqrtPriceX64.toString(),
    
    // Initial liquidity
    initialToken0Amount: token0Amount.toString(),
    initialToken1Amount: token1Amount.toString(),
    
    // Metadata
    token0Symbol,
    token1Symbol,
    createdAt: Date.now()
  };
  
  fs.writeFileSync(POOL_CONFIG_FILE, JSON.stringify(poolConfig, null, 2));
  console.log('\n✅ Pool configuration saved to:', POOL_CONFIG_FILE);
  
  console.log('\n=== Pool Initialization Complete! ===');
  console.log('Pool is now ready for swaps');
  
  return poolConfig;
}

// Instruction builders
function createAmmConfigInstruction(
  owner: PublicKey,
  ammConfig: PublicKey,
  index: number,
  tickSpacing: number,
  tradeFeeRate: number,
  protocolFeeRate: number,
  fundFeeRate: number
): anchor.web3.TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from(DISCRIMINATORS.CREATE_AMM_CONFIG),
    Buffer.from([index]),
    new BN(tickSpacing).toArrayLike(Buffer, 'le', 2),
    new BN(tradeFeeRate).toArrayLike(Buffer, 'le', 4),
    new BN(protocolFeeRate).toArrayLike(Buffer, 'le', 4),
    new BN(fundFeeRate).toArrayLike(Buffer, 'le', 4),
  ]);

  return new anchor.web3.TransactionInstruction({
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: ammConfig, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: CP_SWAP_PROGRAM_ID,
    data,
  });
}

function initializePoolInstruction(
  creator: PublicKey,
  ammConfig: PublicKey,
  poolState: PublicKey,
  token0Mint: PublicKey,
  token1Mint: PublicKey,
  lpMint: PublicKey,
  token0Vault: PublicKey,
  token1Vault: PublicKey,
  observationState: PublicKey,
  sqrtPriceX64: BN,
  openTime: BN
): anchor.web3.TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from(DISCRIMINATORS.INITIALIZE),
    sqrtPriceX64.toArrayLike(Buffer, 'le', 16),
    openTime.toArrayLike(Buffer, 'le', 8),
  ]);

  return new anchor.web3.TransactionInstruction({
    keys: [
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: ammConfig, isSigner: false, isWritable: false },
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: token0Mint, isSigner: false, isWritable: false },
      { pubkey: token1Mint, isSigner: false, isWritable: false },
      { pubkey: lpMint, isSigner: false, isWritable: true },
      { pubkey: token0Vault, isSigner: false, isWritable: true },
      { pubkey: token1Vault, isSigner: false, isWritable: true },
      { pubkey: observationState, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    programId: CP_SWAP_PROGRAM_ID,
    data,
  });
}

function depositInstruction(
  owner: PublicKey,
  poolState: PublicKey,
  lpMint: PublicKey,
  userToken0: PublicKey,
  userToken1: PublicKey,
  userLp: PublicKey,
  token0Vault: PublicKey,
  token1Vault: PublicKey,
  lpAmount: BN,
  maximum0Amount: BN,
  maximum1Amount: BN
): anchor.web3.TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from(DISCRIMINATORS.DEPOSIT),
    lpAmount.toArrayLike(Buffer, 'le', 8),
    maximum0Amount.toArrayLike(Buffer, 'le', 8),
    maximum1Amount.toArrayLike(Buffer, 'le', 8),
  ]);

  return new anchor.web3.TransactionInstruction({
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: lpMint, isSigner: false, isWritable: true },
      { pubkey: userToken0, isSigner: false, isWritable: true },
      { pubkey: userToken1, isSigner: false, isWritable: true },
      { pubkey: userLp, isSigner: false, isWritable: true },
      { pubkey: token0Vault, isSigner: false, isWritable: true },
      { pubkey: token1Vault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: CP_SWAP_PROGRAM_ID,
    data,
  });
}

// Run if called directly
if (require.main === module) {
  initializeCpPoolProperly()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

export { initializeCpPoolProperly };