#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, BN, Wallet } from '@coral-xyz/anchor';
import { 
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount
} from '@solana/spl-token';
import fs from 'fs';
import path from 'path';

// Load the raydium-cp-swap IDL
const idl = JSON.parse(fs.readFileSync(path.join(__dirname, '../raydium-cp-swap/target/idl/raydium_cp_swap.json'), 'utf8'));

// Configuration
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');
const CONTINUUM_PROGRAM_ID = new PublicKey('9tcAhE4XGcZZTE8ez1EW8FF7rxyBN8uat2kkepgaeyEa');

// Seeds from raydium-cp-swap
const AMM_CONFIG_SEED = Buffer.from('amm_config');
const POOL_SEED = Buffer.from('pool');
const POOL_VAULT_SEED = Buffer.from('pool_vault');
const POOL_LP_MINT_SEED = Buffer.from('pool_lp_mint');
const OBSERVATION_SEED = Buffer.from('observation');
const AUTH_SEED = Buffer.from('vault_and_lp_mint_auth_seed');

async function setupPoolWithClient() {
  console.log('Setting up CP-Swap pool using client libraries...\n');

  const connection = new Connection('http://localhost:8899', 'confirmed');
  
  // Load payer keypair
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/home/ubuntu/.config/solana/id.json', 'utf8')))
  );
  
  const wallet = new Wallet(payerKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(idl, CP_SWAP_PROGRAM_ID, provider);
  
  console.log('Payer:', payerKeypair.publicKey.toBase58());

  // Load token configuration
  const tokenConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/tokens.json'), 'utf8'));
  const usdcMint = new PublicKey(tokenConfig.usdcMint);
  const wsolMint = new PublicKey(tokenConfig.wsolMint);

  // Sort tokens
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

  // Step 1: Create AMM Config using index 0
  const ammConfigIndex = 0;
  const [ammConfig] = PublicKey.findProgramAddressSync(
    [AMM_CONFIG_SEED, new BN(ammConfigIndex).toArrayLike(Buffer, 'le', 2)],
    CP_SWAP_PROGRAM_ID
  );
  
  console.log('\nStep 1: Creating AMM Config...');
  console.log('AMM Config PDA:', ammConfig.toBase58());
  
  try {
    // Check if AMM config exists
    const ammConfigAccount = await connection.getAccountInfo(ammConfig);
    
    if (!ammConfigAccount || ammConfigAccount.data.length < 100) {
      console.log('Creating new AMM config...');
      
      const tx = await program.methods
        .createAmmConfig(
          ammConfigIndex,
          new BN(2500),  // 0.25% trade fee
          new BN(0),     // no protocol fee
          new BN(0),     // no fund fee
          new BN(0)      // no create pool fee
        )
        .accounts({
          owner: payerKeypair.publicKey,
          ammConfig: ammConfig,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      console.log('AMM Config created:', tx);
    } else {
      console.log('AMM Config already exists');
      
      // Try to fetch it
      try {
        const config = await program.account.ammConfig.fetch(ammConfig);
        console.log('Config index:', config.index);
        console.log('Trade fee rate:', config.tradeFeeRate.toString());
      } catch (e) {
        console.log('Could not fetch AMM config details');
      }
    }
  } catch (err) {
    console.error('Error with AMM config:', err.message);
  }

  // Step 2: Initialize Pool
  console.log('\nStep 2: Initializing Pool...');
  
  // Derive pool PDA
  const [poolId] = PublicKey.findProgramAddressSync(
    [POOL_SEED, ammConfig.toBuffer(), token0Mint.toBuffer(), token1Mint.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );
  
  // Derive authority
  const [authority] = PublicKey.findProgramAddressSync(
    [AUTH_SEED],
    CP_SWAP_PROGRAM_ID
  );
  
  // Derive vaults
  const [token0Vault] = PublicKey.findProgramAddressSync(
    [POOL_VAULT_SEED, poolId.toBuffer(), token0Mint.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );
  
  const [token1Vault] = PublicKey.findProgramAddressSync(
    [POOL_VAULT_SEED, poolId.toBuffer(), token1Mint.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );
  
  // Derive LP mint
  const [lpMint] = PublicKey.findProgramAddressSync(
    [POOL_LP_MINT_SEED, poolId.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );
  
  // Derive observation state
  const [observationState] = PublicKey.findProgramAddressSync(
    [OBSERVATION_SEED, poolId.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );
  
  console.log('Pool ID:', poolId.toBase58());
  console.log('Authority:', authority.toBase58());
  console.log('Token0 Vault:', token0Vault.toBase58());
  console.log('Token1 Vault:', token1Vault.toBase58());
  console.log('LP Mint:', lpMint.toBase58());
  
  // Get user token accounts
  const userToken0 = await getAssociatedTokenAddress(token0Mint, payerKeypair.publicKey);
  const userToken1 = await getAssociatedTokenAddress(token1Mint, payerKeypair.publicKey);
  const userLp = await getAssociatedTokenAddress(lpMint, payerKeypair.publicKey);
  
  // Create pool fee account
  const feeOwner = payerKeypair.publicKey; // Use payer as fee owner for simplicity
  const createPoolFee = await getAssociatedTokenAddress(token0Mint, feeOwner);
  
  try {
    const poolAccount = await connection.getAccountInfo(poolId);
    if (!poolAccount) {
      console.log('Creating pool...');
      
      // Initial amounts
      const initAmount0 = new BN(10000 * Math.pow(10, 9)); // Adjust based on decimals
      const initAmount1 = new BN(10000 * Math.pow(10, 6));
      
      // Derive Continuum's cp_pool_authority PDA
      const [cpPoolAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from('cp_pool_authority'), poolId.toBuffer()],
        CONTINUUM_PROGRAM_ID
      );
      
      const tx = await program.methods
        .initialize(
          initAmount0,
          initAmount1,
          new BN(0), // open_time
          1,         // authority_type: 1 for custom
          cpPoolAuthority // custom_authority
        )
        .accounts({
          creator: payerKeypair.publicKey,
          ammConfig: ammConfig,
          authority: authority,
          poolState: poolId,
          token0Mint: token0Mint,
          token1Mint: token1Mint,
          lpMint: lpMint,
          creatorToken0: userToken0,
          creatorToken1: userToken1,
          creatorLpToken: userLp,
          token0Vault: token0Vault,
          token1Vault: token1Vault,
          createPoolFee: createPoolFee,
          observationState: observationState,
          tokenProgram: TOKEN_PROGRAM_ID,
          token0Program: TOKEN_PROGRAM_ID,
          token1Program: TOKEN_PROGRAM_ID,
          associatedTokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: PublicKey.default,
        })
        .rpc();
      
      console.log('Pool initialized:', tx);
      
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
        authority: authority.toBase58(),
        cpPoolAuthority: cpPoolAuthority.toBase58(),
        createdAt: new Date().toISOString()
      };
      
      fs.writeFileSync(
        path.join(__dirname, '../config/pool-with-client.json'),
        JSON.stringify(poolConfig, null, 2)
      );
      
      console.log('\n✅ Pool setup complete!');
      console.log('Configuration saved to config/pool-with-client.json');
      
    } else {
      console.log('Pool already exists');
    }
  } catch (err) {
    console.error('Error creating pool:', err);
    if (err.logs) {
      console.error('Logs:', err.logs);
    }
  }
}

if (require.main === module) {
  setupPoolWithClient()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}