#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

// Configuration
const POOL_CONFIG_FILE = path.join(__dirname, '../config/pool.json');
const connection = new Connection('http://localhost:8899', 'confirmed');

// Continuum program ID
const CONTINUUM_PROGRAM_ID = new PublicKey('9tcAhE4XGcZZTE8ez1EW8FF7rxyBN8uat2kkepgaeyEa');

async function initAndRegister() {
  console.log('Initializing FIFO state and registering pool...\n');

  // Load pool configuration
  const poolConfig = JSON.parse(fs.readFileSync(POOL_CONFIG_FILE, 'utf8'));
  const poolId = new PublicKey(poolConfig.poolId);

  // Load payer keypair
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/home/ubuntu/.config/solana/id.json', 'utf8')))
  );
  console.log('Payer:', payerKeypair.publicKey.toBase58());

  // Derive PDAs
  const [fifoState] = PublicKey.findProgramAddressSync(
    [Buffer.from('fifo_state')],
    CONTINUUM_PROGRAM_ID
  );
  
  const [poolRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_registry'), poolId.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );

  console.log('FIFO State PDA:', fifoState.toBase58());
  console.log('Pool Registry PDA:', poolRegistry.toBase58());

  // Step 1: Initialize FIFO state
  try {
    const fifoAccount = await connection.getAccountInfo(fifoState);
    if (!fifoAccount) {
      console.log('\n1. Initializing FIFO state...');
      
      // Build initialize instruction
      const initIx = buildInitializeInstruction(
        CONTINUUM_PROGRAM_ID,
        fifoState,
        payerKeypair.publicKey
      );

      const tx = new Transaction().add(initIx);
      const sig = await sendAndConfirmTransaction(connection, tx, [payerKeypair]);
      console.log('FIFO state initialized:', sig);
    } else {
      console.log('\n1. FIFO state already exists');
    }
  } catch (err) {
    console.error('Error initializing FIFO state:', err);
  }

  // Step 2: Register the pool
  try {
    const registryAccount = await connection.getAccountInfo(poolRegistry);
    if (!registryAccount) {
      console.log('\n2. Registering pool...');
      
      // Build register pool instruction
      const registerIx = buildRegisterPoolInstruction(
        CONTINUUM_PROGRAM_ID,
        poolRegistry,
        poolId,
        payerKeypair.publicKey,
        fifoState,
        new PublicKey(poolConfig.tokenAMint),
        new PublicKey(poolConfig.tokenBMint)
      );

      const tx = new Transaction().add(registerIx);
      const sig = await sendAndConfirmTransaction(connection, tx, [payerKeypair]);
      console.log('Pool registered:', sig);
      
      console.log('\n✅ Pool registration complete!');
      console.log('Pool ID:', poolId.toBase58());
      console.log('Registry:', poolRegistry.toBase58());
    } else {
      console.log('\n2. Pool already registered');
    }
  } catch (err) {
    console.error('Error registering pool:', err);
    if (err.logs) {
      console.error('Transaction logs:', err.logs);
    }
  }
}

// Helper function to build initialize instruction
function buildInitializeInstruction(
  programId: PublicKey,
  fifoState: PublicKey,
  admin: PublicKey
): anchor.web3.TransactionInstruction {
  // initialize instruction discriminator
  const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);
  
  return new anchor.web3.TransactionInstruction({
    keys: [
      { pubkey: fifoState, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data: discriminator,
  });
}

// Helper function to build register pool instruction
function buildRegisterPoolInstruction(
  programId: PublicKey,
  poolRegistry: PublicKey,
  poolId: PublicKey,
  owner: PublicKey,
  fifoState: PublicKey,
  token0: PublicKey,
  token1: PublicKey
): anchor.web3.TransactionInstruction {
  // register_pool instruction discriminator
  const discriminator = Buffer.from([129, 80, 193, 18, 248, 119, 225, 73]);
  
  // Encode token mints as instruction data
  const data = Buffer.concat([
    discriminator,
    token0.toBuffer(),
    token1.toBuffer(),
  ]);

  return new anchor.web3.TransactionInstruction({
    keys: [
      { pubkey: poolRegistry, isSigner: false, isWritable: true },
      { pubkey: poolId, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: fifoState, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

// Run if called directly
if (require.main === module) {
  initAndRegister()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}

export { initAndRegister };