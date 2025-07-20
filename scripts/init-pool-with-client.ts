#!/usr/bin/env ts-node
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import fs from 'fs';
import path from 'path';
import { RaydiumCpSwap } from "../raydium-cp-swap/target/types/raydium_cp_swap";

// Configuration
const TOKEN_CONFIG_FILE = path.join(__dirname, '../config/tokens.json');
const POOL_CONFIG_FILE = path.join(__dirname, '../config/pool-final.json');
const CONTINUUM_PROGRAM_ID = new PublicKey('9tcAhE4XGcZZTE8ez1EW8FF7rxyBN8uat2kkepgaeyEa');

async function initializePoolWithClient() {
  console.log('Initializing CP-Swap pool using Raydium client libraries...\n');

  // Load configuration
  const tokenConfig = JSON.parse(fs.readFileSync(TOKEN_CONFIG_FILE, 'utf8'));
  const usdcMint = new PublicKey(tokenConfig.usdcMint);
  const wsolMint = new PublicKey(tokenConfig.wsolMint);

  // Setup provider
  const connection = new Connection('http://localhost:8899', 'confirmed');
  const wallet = new anchor.Wallet(
    Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(fs.readFileSync('/home/ubuntu/.config/solana/id.json', 'utf8')))
    )
  );
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    skipPreflight: false,
  });
  anchor.setProvider(provider);

  // Load the program
  const idl = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '../raydium-cp-swap/target/idl/raydium_cp_swap.json'),
      'utf8'
    )
  );
  const program = new anchor.Program<RaydiumCpSwap>(
    idl,
    provider
  );

  console.log('Wallet:', wallet.publicKey.toBase58());

  // Sort tokens (CP-Swap requires token0 < token1)
  let token0Mint: PublicKey;
  let token1Mint: PublicKey;
  let token0Decimals: number;
  let token1Decimals: number;
  if (usdcMint.toBuffer().compare(wsolMint.toBuffer()) < 0) {
    token0Mint = usdcMint;
    token1Mint = wsolMint;
    token0Decimals = tokenConfig.decimals.usdc;
    token1Decimals = tokenConfig.decimals.wsol;
    console.log('Token ordering: USDC is token0, WSOL is token1');
  } else {
    token0Mint = wsolMint;
    token1Mint = usdcMint;
    token0Decimals = tokenConfig.decimals.wsol;
    token1Decimals = tokenConfig.decimals.usdc;
    console.log('Token ordering: WSOL is token0, USDC is token1');
  }

  // Step 1: Create AMM config
  const configIndex = 4; // Use a fresh index
  const tradeFeeRate = new BN(2500); // 0.25%
  const protocolFeeRate = new BN(0);
  const fundFeeRate = new BN(0);
  const createPoolFee = new BN(0);

  // Derive AMM config address
  const [ammConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from('amm_config'), new BN(configIndex).toArrayLike(Buffer, 'be', 2)],
    program.programId
  );

  console.log('\nCreating AMM config...');
  console.log('Config index:', configIndex);
  console.log('AMM config address:', ammConfig.toBase58());

  // Check if AMM config exists
  const ammConfigAccount = await connection.getAccountInfo(ammConfig);
  if (!ammConfigAccount) {
    try {
      console.log('Creating AMM config with:');
      console.log('- Owner:', wallet.publicKey.toBase58());
      console.log('- AMM Config Address:', ammConfig.toBase58());
      console.log('- Index:', configIndex);
      console.log('- Trade Fee Rate:', tradeFeeRate.toString());
      
      const tx = await program.methods
        .createAmmConfig(
          configIndex,
          tradeFeeRate,
          protocolFeeRate,
          fundFeeRate,
          createPoolFee
        )
        .accounts({
          owner: wallet.publicKey,
          ammConfig: ammConfig,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      console.log('AMM config creation tx:', tx);
      
      // Verify the account was created properly
      const createdAccount = await connection.getAccountInfo(ammConfig);
      if (createdAccount) {
        console.log('AMM config account created:');
        console.log('- Size:', createdAccount.data.length, 'bytes');
        console.log('- Owner:', createdAccount.owner.toBase58());
        console.log('- Data (first 32 bytes):', createdAccount.data.slice(0, 32).toString('hex'));
      }
    } catch (err) {
      console.error('Failed to create AMM config:', err);
      if (err.logs) {
        console.error('Transaction logs:', err.logs);
      }
      throw err;
    }
  } else {
    console.log('AMM config already exists');
    console.log('- Size:', ammConfigAccount.data.length, 'bytes');
    console.log('- Owner:', ammConfigAccount.owner.toBase58());
    console.log('- Data (first 32 bytes):', ammConfigAccount.data.slice(0, 32).toString('hex'));
  }

  // Step 2: Initialize pool
  const initAmount0 = new BN(10000 * Math.pow(10, token0Decimals));
  const initAmount1 = new BN(10000 * Math.pow(10, token1Decimals));

  // Derive pool addresses
  const [auth] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_and_lp_mint_auth_seed')],
    program.programId
  );

  const [poolAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), ammConfig.toBuffer(), token0Mint.toBuffer(), token1Mint.toBuffer()],
    program.programId
  );

  const [lpMintAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_lp_mint'), poolAddress.toBuffer()],
    program.programId
  );

  const [vault0] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_vault'), poolAddress.toBuffer(), token0Mint.toBuffer()],
    program.programId
  );

  const [vault1] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_vault'), poolAddress.toBuffer(), token1Mint.toBuffer()],
    program.programId
  );

  const [observationAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from('observation'), poolAddress.toBuffer()],
    program.programId
  );

  // Get creator token accounts
  const creatorToken0 = getAssociatedTokenAddressSync(token0Mint, wallet.publicKey);
  const creatorToken1 = getAssociatedTokenAddressSync(token1Mint, wallet.publicKey);
  const creatorLpToken = getAssociatedTokenAddressSync(lpMintAddress, wallet.publicKey);

  // Create fee account
  const feeOwner = wallet.publicKey; // Use same as creator for simplicity
  const createPoolFeeAccount = getAssociatedTokenAddressSync(token0Mint, feeOwner);

  // Derive Continuum's cp_pool_authority PDA
  const [cpPoolAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('cp_pool_authority'), poolAddress.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );

  console.log('\nPool details:');
  console.log('Pool address:', poolAddress.toBase58());
  console.log('LP mint:', lpMintAddress.toBase58());
  console.log('Token0 vault:', vault0.toBase58());
  console.log('Token1 vault:', vault1.toBase58());
  console.log('Observation state:', observationAddress.toBase58());
  console.log('CP Pool Authority:', cpPoolAuthority.toBase58());

  // Always try to initialize the pool
  console.log('\nInitializing pool with custom authority...');
  try {
      await program.methods
        .initialize(
          initAmount0,
          initAmount1,
          new BN(0), // open_time
          1, // authority_type: 1 for custom authority
          cpPoolAuthority // custom_authority
        )
        .accountsPartial({
          creator: wallet.publicKey,
          ammConfig: ammConfig,
          authority: auth,
          poolState: poolAddress,
          token0Mint: token0Mint,
          token1Mint: token1Mint,
          lpMint: lpMintAddress,
          creatorToken0: creatorToken0,
          creatorToken1: creatorToken1,
          creatorLpToken: creatorLpToken,
          token0Vault: vault0,
          token1Vault: vault1,
          createPoolFee: createPoolFeeAccount,
          observationState: observationAddress,
          tokenProgram: TOKEN_PROGRAM_ID,
          token0Program: TOKEN_PROGRAM_ID,
          token1Program: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      
    console.log('Pool initialized successfully!');
  } catch (err) {
    console.error('Failed to initialize pool:', err);
    throw err;
  }

  // Fetch pool state
  const poolState = await program.account.poolState.fetch(poolAddress);
  console.log('\nPool state:');
  console.log('AMM config:', poolState.ammConfig.toBase58());
  console.log('Token0 mint:', poolState.token0Mint.toBase58());
  console.log('Token1 mint:', poolState.token1Mint.toBase58());
  console.log('Token0 vault:', poolState.token0Vault.toBase58());
  console.log('Token1 vault:', poolState.token1Vault.toBase58());
  console.log('Authority type:', poolState.authorityType);
  if (poolState.authorityType === 1) {
    console.log('Custom authority:', poolState.customAuthority.toBase58());
  }

  // Save pool configuration
  const poolConfig = {
    poolId: poolAddress.toBase58(),
    ammConfig: ammConfig.toBase58(),
    ammConfigIndex: configIndex,
    tokenAMint: token0Mint.toBase58(),
    tokenBMint: token1Mint.toBase58(),
    tokenAVault: vault0.toBase58(),
    tokenBVault: vault1.toBase58(),
    lpMint: lpMintAddress.toBase58(),
    observationState: observationAddress.toBase58(),
    creatorTokenA: creatorToken0.toBase58(),
    creatorTokenB: creatorToken1.toBase58(),
    creatorLp: creatorLpToken.toBase58(),
    feeRate: tradeFeeRate.toNumber(),
    cpPoolAuthority: cpPoolAuthority.toBase58(),
    authorityType: 1,
  };

  fs.writeFileSync(POOL_CONFIG_FILE, JSON.stringify(poolConfig, null, 2));
  console.log('\nPool configuration saved to:', POOL_CONFIG_FILE);
  console.log('\n✅ Pool initialization complete!');
}

// Run if called directly
if (require.main === module) {
  initializePoolWithClient()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}

export { initializePoolWithClient };