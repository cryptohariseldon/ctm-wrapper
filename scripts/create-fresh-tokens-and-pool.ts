#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { 
  createMint, 
  getOrCreateAssociatedTokenAccount, 
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction
} from '@solana/spl-token';
import { Program, AnchorProvider, BN, Wallet, workspace, setProvider } from '@coral-xyz/anchor';
import { RaydiumCpSwap } from '../raydium-cp-swap/target/types/raydium_cp_swap';
import fs from 'fs';
import path from 'path';

// Configuration
const CONFIG_DIR = path.join(__dirname, '../config');
const TOKEN_CONFIG_FILE = path.join(CONFIG_DIR, 'fresh-tokens.json');
const POOL_CONFIG_FILE = path.join(CONFIG_DIR, 'fresh-pool.json');

interface TokenConfig {
  usdcMint: string;
  wsolMint: string;
  usdcAccount: string;
  wsolAccount: string;
  decimals: {
    usdc: number;
    wsol: number;
  };
}

interface PoolConfig {
  poolId: string;
  ammConfig: string;
  token0Mint: string;
  token1Mint: string;
  token0Vault: string;
  token1Vault: string;
  lpMint: string;
  observationState: string;
  authority: string;
  tradeFeeRate: number;
  token0Symbol: string;
  token1Symbol: string;
  initialLiquidity: {
    token0: string;
    token1: string;
  };
}

async function createFreshTokensAndPool() {
  console.log('🚀 Creating fresh tokens and Raydium CP-Swap pool...\n');

  // Setup connection and wallet
  const connection = new Connection('http://localhost:8899', 'confirmed');
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/home/ubuntu/.config/solana/id.json', 'utf8')))
  );
  
  const wallet = new Wallet(payerKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  setProvider(provider);
  
  // Load the program from workspace
  const program = workspace.RaydiumCpSwap as Program<RaydiumCpSwap>;

  console.log('Payer:', payerKeypair.publicKey.toBase58());
  const balance = await connection.getBalance(payerKeypair.publicKey);
  console.log('Balance:', balance / 1e9, 'SOL\n');

  // Step 1: Create fresh tokens
  console.log('📦 Step 1: Creating fresh tokens...');
  
  // Create USDC-like token (6 decimals)
  const usdcMint = await createMint(
    connection,
    payerKeypair,
    payerKeypair.publicKey,
    payerKeypair.publicKey,
    6,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );
  console.log('USDC mint created:', usdcMint.toBase58());

  // Create WSOL-like token (9 decimals)
  const wsolMint = await createMint(
    connection,
    payerKeypair,
    payerKeypair.publicKey,
    payerKeypair.publicKey,
    9,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );
  console.log('WSOL mint created:', wsolMint.toBase58());

  // Create token accounts and mint supply
  const usdcAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payerKeypair,
    usdcMint,
    payerKeypair.publicKey
  );
  
  const wsolAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payerKeypair,
    wsolMint,
    payerKeypair.publicKey
  );

  // Mint tokens
  await mintTo(
    connection,
    payerKeypair,
    usdcMint,
    usdcAccount.address,
    payerKeypair.publicKey,
    1_000_000 * 10 ** 6 // 1M USDC
  );
  console.log('Minted 1,000,000 USDC');

  await mintTo(
    connection,
    payerKeypair,
    wsolMint,
    wsolAccount.address,
    payerKeypair.publicKey,
    10_000 * 10 ** 9 // 10K WSOL
  );
  console.log('Minted 10,000 WSOL');

  // Save token configuration
  const tokenConfig: TokenConfig = {
    usdcMint: usdcMint.toBase58(),
    wsolMint: wsolMint.toBase58(),
    usdcAccount: usdcAccount.address.toBase58(),
    wsolAccount: wsolAccount.address.toBase58(),
    decimals: {
      usdc: 6,
      wsol: 9
    }
  };

  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(TOKEN_CONFIG_FILE, JSON.stringify(tokenConfig, null, 2));
  console.log('\n✅ Token configuration saved\n');

  // Step 2: Sort tokens for pool creation
  console.log('📊 Step 2: Setting up pool parameters...');
  let token0Mint: PublicKey;
  let token1Mint: PublicKey;
  let token0Symbol: string;
  let token1Symbol: string;
  
  if (usdcMint.toBuffer().compare(wsolMint.toBuffer()) < 0) {
    token0Mint = usdcMint;
    token1Mint = wsolMint;
    token0Symbol = 'USDC';
    token1Symbol = 'WSOL';
  } else {
    token0Mint = wsolMint;
    token1Mint = usdcMint;
    token0Symbol = 'WSOL';
    token1Symbol = 'USDC';
  }
  
  console.log(`Token0: ${token0Symbol} (${token0Mint.toBase58()})`);
  console.log(`Token1: ${token1Symbol} (${token1Mint.toBase58()})`);

  // Step 3: Create AMM Config
  console.log('\n🔧 Step 3: Creating AMM Config...');
  const configIndex = 0;
  const tradeFeeRate = new BN(2500); // 0.25%
  const protocolFeeRate = new BN(0);
  const fundFeeRate = new BN(0);
  const createPoolFee = new BN(0);

  const [ammConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from('amm_config'), new BN(configIndex).toArrayLike(Buffer, 'le', 2)],
    program.programId
  );

  try {
    const ammConfigAccount = await connection.getAccountInfo(ammConfig);
    if (!ammConfigAccount) {
      await program.methods
        .createAmmConfig(configIndex, tradeFeeRate, protocolFeeRate, fundFeeRate, createPoolFee)
        .accounts({
          owner: payerKeypair.publicKey,
          ammConfig: ammConfig,
          systemProgram: PublicKey.default,
        })
        .signers([payerKeypair])
        .rpc();
      console.log('AMM Config created:', ammConfig.toBase58());
    } else {
      console.log('AMM Config already exists:', ammConfig.toBase58());
    }
  } catch (err) {
    console.error('Error with AMM config:', err);
  }

  // Step 4: Derive pool addresses
  console.log('\n🏊 Step 4: Deriving pool addresses...');
  
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_and_lp_mint_auth_seed')],
    program.programId
  );
  
  const [poolState] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('pool'),
      ammConfig.toBuffer(),
      token0Mint.toBuffer(),
      token1Mint.toBuffer(),
    ],
    program.programId
  );
  
  const [lpMint] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_lp_mint'), poolState.toBuffer()],
    program.programId
  );
  
  const [token0Vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_vault'), poolState.toBuffer(), token0Mint.toBuffer()],
    program.programId
  );
  
  const [token1Vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_vault'), poolState.toBuffer(), token1Mint.toBuffer()],
    program.programId
  );
  
  const [observationState] = PublicKey.findProgramAddressSync(
    [Buffer.from('observation'), poolState.toBuffer()],
    program.programId
  );

  console.log('Pool State:', poolState.toBase58());
  console.log('Authority:', authority.toBase58());
  console.log('LP Mint:', lpMint.toBase58());
  console.log('Token0 Vault:', token0Vault.toBase58());
  console.log('Token1 Vault:', token1Vault.toBase58());

  // Step 5: Initialize pool
  console.log('\n🎯 Step 5: Initializing pool...');
  
  const creatorToken0 = await getAssociatedTokenAddress(token0Mint, payerKeypair.publicKey);
  const creatorToken1 = await getAssociatedTokenAddress(token1Mint, payerKeypair.publicKey);
  const creatorLpToken = await getAssociatedTokenAddress(lpMint, payerKeypair.publicKey);
  
  // Create fee receiver account
  const feeOwner = new PublicKey('GsV1jugD8ftfWBYNykA9SLK2V4mQqUW2sLop8MAfjVRq');
  const createPoolFeeAccount = await getAssociatedTokenAddress(
    token0Mint, // Using token0 as fee token
    feeOwner,
    false,
    TOKEN_PROGRAM_ID
  );
  
  // Check if fee account exists, if not create it
  const feeAccountInfo = await connection.getAccountInfo(createPoolFeeAccount);
  if (!feeAccountInfo) {
    const createFeeAccountIx = createAssociatedTokenAccountInstruction(
      payerKeypair.publicKey,
      createPoolFeeAccount,
      feeOwner,
      token0Mint,
      TOKEN_PROGRAM_ID
    );
    
    const tx = new Transaction().add(createFeeAccountIx);
    await sendAndConfirmTransaction(connection, tx, [payerKeypair]);
    console.log('Created fee account');
  }

  try {
    const poolAccount = await connection.getAccountInfo(poolState);
    if (!poolAccount) {
      // Initial amounts for liquidity
      const initAmount0 = new BN(10000 * 10 ** (token0Symbol === 'USDC' ? 6 : 9)); // 10,000 token0
      const initAmount1 = new BN(10000 * 10 ** (token1Symbol === 'USDC' ? 6 : 9)); // 10,000 token1
      
      await program.methods
        .initialize(initAmount0, initAmount1, new BN(0), 0, null)
        .accountsPartial({
          creator: payerKeypair.publicKey,
          ammConfig: ammConfig,
          poolState: poolState,
          token0Mint: token0Mint,
          token1Mint: token1Mint,
          lpMint: lpMint,
          creatorToken0: creatorToken0,
          creatorToken1: creatorToken1,
          creatorLpToken: creatorLpToken,
          token0Vault: token0Vault,
          token1Vault: token1Vault,
          createPoolFee: createPoolFeeAccount,
          observationState: observationState,
          tokenProgram: TOKEN_PROGRAM_ID,
          token0Program: TOKEN_PROGRAM_ID,
          token1Program: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: PublicKey.default,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([payerKeypair])
        .rpc({ skipPreflight: true });
        
      console.log('✅ Pool initialized successfully!');
      
      // Fetch pool state
      const poolStateAccount = await program.account.poolState.fetch(poolState);
      console.log('\nPool State:');
      console.log('  Status:', poolStateAccount.status);
      console.log('  LP Supply:', poolStateAccount.lpSupply.toString());
      console.log('  Token0 Vault:', poolStateAccount.token0Vault.toBase58());
      console.log('  Token1 Vault:', poolStateAccount.token1Vault.toBase58());
      
      // Save pool configuration
      const poolConfig: PoolConfig = {
        poolId: poolState.toBase58(),
        ammConfig: ammConfig.toBase58(),
        token0Mint: token0Mint.toBase58(),
        token1Mint: token1Mint.toBase58(),
        token0Vault: token0Vault.toBase58(),
        token1Vault: token1Vault.toBase58(),
        lpMint: lpMint.toBase58(),
        observationState: observationState.toBase58(),
        authority: authority.toBase58(),
        tradeFeeRate: tradeFeeRate.toNumber(),
        token0Symbol,
        token1Symbol,
        initialLiquidity: {
          token0: initAmount0.toString(),
          token1: initAmount1.toString()
        }
      };
      
      fs.writeFileSync(POOL_CONFIG_FILE, JSON.stringify(poolConfig, null, 2));
      console.log('\n✅ Pool configuration saved to:', POOL_CONFIG_FILE);
      
    } else {
      console.log('Pool already exists');
    }
  } catch (err) {
    console.error('Error initializing pool:', err);
    if (err.logs) {
      console.error('Transaction logs:', err.logs);
    }
    throw err;
  }

  console.log('\n🎉 Fresh tokens and pool created successfully!');
  console.log('\nNext steps:');
  console.log('1. Register the pool with Continuum wrapper');
  console.log('2. Test swaps through the wrapper');
}

// Run the script
if (require.main === module) {
  createFreshTokensAndPool()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

export { createFreshTokensAndPool };