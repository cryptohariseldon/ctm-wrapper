#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';
import { ContinuumCpSwap, IDL } from '../target/types/continuum_cp_swap';

// Configuration
const POOL_CONFIG_FILE = path.join(__dirname, '../config/pool.json');
const connection = new Connection('http://localhost:8899', 'confirmed');

// Continuum program ID
const CONTINUUM_PROGRAM_ID = new PublicKey('9tcAhE4XGcZZTE8ez1EW8FF7rxyBN8uat2kkepgaeyEa');

async function registerPool() {
  console.log('Registering pool with Continuum...\n');

  // Load pool configuration
  const poolConfig = JSON.parse(fs.readFileSync(POOL_CONFIG_FILE, 'utf8'));
  const poolId = new PublicKey(poolConfig.poolId);

  // Load payer keypair
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/home/ubuntu/.config/solana/id.json', 'utf8')))
  );
  console.log('Payer:', payerKeypair.publicKey.toBase58());

  // Create provider
  const wallet = new Wallet(payerKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });

  // Create program interface
  const program = new Program<ContinuumCpSwap>(
    IDL,
    CONTINUUM_PROGRAM_ID,
    provider
  );

  // Derive pool registry PDA
  const [poolRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_registry'), poolId.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );
  console.log('Pool registry PDA:', poolRegistry.toBase58());

  // Initialize FIFO state if needed
  const [fifoState] = PublicKey.findProgramAddressSync(
    [Buffer.from('fifo_state')],
    CONTINUUM_PROGRAM_ID
  );

  try {
    // Check if FIFO state exists
    const fifoAccount = await connection.getAccountInfo(fifoState);
    if (!fifoAccount) {
      console.log('Initializing FIFO state...');
      const tx = await program.methods
        .initialize()
        .accounts({
          fifoState,
          owner: payerKeypair.publicKey,
        })
        .rpc();
      console.log('FIFO state initialized:', tx);
    }
  } catch (err) {
    console.log('FIFO state already exists or error:', err.message);
  }

  // Register the pool
  console.log('\nRegistering pool...');
  try {
    const tx = await program.methods
      .registerPool(
        new PublicKey(poolConfig.tokenAMint),
        new PublicKey(poolConfig.tokenBMint)
      )
      .accounts({
        poolRegistry,
        poolId,
        owner: payerKeypair.publicKey,
        fifoState,
      })
      .rpc();
    
    console.log('Pool registered successfully!');
    console.log('Transaction:', tx);
    
    // Fetch and display the pool registry data
    const registryData = await program.account.cpSwapPoolRegistry.fetch(poolRegistry);
    console.log('\nPool Registry Data:');
    console.log('- Pool ID:', registryData.poolId.toBase58());
    console.log('- Token 0:', registryData.token0.toBase58());
    console.log('- Token 1:', registryData.token1.toBase58());
    console.log('- Continuum Authority:', registryData.continuumAuthority.toBase58());
    console.log('- Is Active:', registryData.isActive);
    
  } catch (err) {
    console.error('Error registering pool:', err);
    if (err.logs) {
      console.error('Transaction logs:', err.logs);
    }
  }
}

// Run if called directly
if (require.main === module) {
  registerPool()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}

export { registerPool };