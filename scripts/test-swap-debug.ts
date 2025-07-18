#!/usr/bin/env ts-node
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram, 
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram
} from '@solana/web3.js';
import { 
  getAssociatedTokenAddressSync, 
  TOKEN_PROGRAM_ID 
} from '@solana/spl-token';
import fs from 'fs';
import path from 'path';
import { ContinuumCpSwap } from "../target/types/continuum_cp_swap";

const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

async function testSwapDebug() {
  console.log('Testing swap through Continuum wrapper with debugging...\n');

  // Load configurations
  const tokenConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/tokens.json'), 'utf8'));
  const poolConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/pool-final.json'), 'utf8'));
  
  const usdcMint = new PublicKey(tokenConfig.usdcMint);
  const wsolMint = new PublicKey(tokenConfig.wsolMint);
  const poolId = new PublicKey(poolConfig.poolId);
  const ammConfig = new PublicKey(poolConfig.ammConfig);

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
  const program = anchor.workspace.ContinuumCpSwap as Program<ContinuumCpSwap>;
  
  // Derive PDAs
  const [fifoState] = PublicKey.findProgramAddressSync(
    [Buffer.from('fifo_state')],
    program.programId
  );

  const [poolAuthority, poolAuthorityBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('cp_pool_authority'), poolId.toBuffer()],
    program.programId
  );

  const [cpSwapAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_and_lp_mint_auth_seed')],
    CP_SWAP_PROGRAM_ID
  );

  // User token accounts
  const userUsdcAccount = getAssociatedTokenAddressSync(usdcMint, wallet.publicKey);
  const userWsolAccount = getAssociatedTokenAddressSync(wsolMint, wallet.publicKey);

  console.log('Key accounts:');
  console.log('- User:', wallet.publicKey.toBase58());
  console.log('- Pool ID:', poolId.toBase58());
  console.log('- AMM Config:', ammConfig.toBase58());
  console.log('- Pool Authority:', poolAuthority.toBase58());
  console.log('- Pool Authority Bump:', poolAuthorityBump);

  // Check all accounts exist
  console.log('\nVerifying accounts exist:');
  const accounts = [
    { name: 'fifoState', pubkey: fifoState },
    { name: 'ammConfig', pubkey: ammConfig },
    { name: 'poolId', pubkey: poolId },
    { name: 'userUsdcAccount', pubkey: userUsdcAccount },
    { name: 'userWsolAccount', pubkey: userWsolAccount },
  ];

  for (const acc of accounts) {
    const info = await connection.getAccountInfo(acc.pubkey);
    console.log(`- ${acc.name}: ${info ? 'exists' : 'NOT FOUND'} (${info?.data.length || 0} bytes)`);
  }

  // Test swap: 100 USDC for WSOL
  const amountIn = new BN(100 * Math.pow(10, tokenConfig.decimals.usdc));
  const minAmountOut = new BN(0); // Accept any amount for testing

  console.log('\nSwap parameters:');
  console.log('- Amount in:', amountIn.toString(), 'USDC units');
  console.log('- Min amount out:', minAmountOut.toString());
  console.log('- Is base input:', true);

  try {
    console.log('\nBuilding transaction...');
    
    // Create transaction with increased compute budget
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ 
      units: 300000 
    });

    const ix = await program.methods
      .swapImmediate(
        amountIn,
        minAmountOut,
        true, // is_base_input
        poolId,
        poolAuthorityBump
      )
      .accountsPartial({
        fifoState: fifoState,
        cpSwapProgram: CP_SWAP_PROGRAM_ID,
      })
      .remainingAccounts([
        // Accounts for CP-Swap CPI
        { pubkey: poolAuthority, isSigner: false, isWritable: false }, // Will be signed by CPI
        { pubkey: cpSwapAuthority, isSigner: false, isWritable: false },
        { pubkey: ammConfig, isSigner: false, isWritable: false },
        { pubkey: poolId, isSigner: false, isWritable: true },
        { pubkey: userUsdcAccount, isSigner: false, isWritable: true },
        { pubkey: userWsolAccount, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(poolConfig.tokenBVault), isSigner: false, isWritable: true }, // USDC vault
        { pubkey: new PublicKey(poolConfig.tokenAVault), isSigner: false, isWritable: true }, // WSOL vault
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: usdcMint, isSigner: false, isWritable: false },
        { pubkey: wsolMint, isSigner: false, isWritable: false },
        { pubkey: new PublicKey(poolConfig.observationState), isSigner: false, isWritable: true },
      ])
      .instruction();

    console.log('\nSending transaction with simulate...');
    
    const tx = new anchor.web3.Transaction()
      .add(modifyComputeUnits)
      .add(ix);
    
    // First simulate to get detailed logs
    const simulation = await connection.simulateTransaction(tx, [wallet.payer]);
    console.log('\nSimulation result:', simulation.value.err ? 'FAILED' : 'SUCCESS');
    if (simulation.value.logs) {
      console.log('\nTransaction logs:');
      simulation.value.logs.forEach(log => console.log(log));
    }
    
    if (!simulation.value.err) {
      // If simulation passed, send the actual transaction
      const txSig = await provider.sendAndConfirm(tx);
      console.log('\n✅ Swap successful!');
      console.log('Transaction:', txSig);
    }

  } catch (err) {
    console.error('\n❌ Swap failed:', err);
    if (err.logs) {
      console.error('\nTransaction logs:');
      err.logs.forEach(log => console.error(log));
    }
  }
}

// Run if called directly
if (require.main === module) {
  testSwapDebug()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}