#!/usr/bin/env ts-node
import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createMint, mintTo, createAssociatedTokenAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import fs from 'fs';
import path from 'path';

// Devnet configuration
const DEVNET_URL = 'https://api.devnet.solana.com';
const connection = new Connection(DEVNET_URL, 'confirmed');

// Program IDs (update these with your devnet deployments)
const CONTINUUM_PROGRAM_ID = new PublicKey('EaeWUSam5Li1fzCcCs33oE4jCLQT4F6RJXgrPYZaoKqq');
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

// Load wallet
const walletPath = process.env.WALLET_PATH || path.join(process.env.HOME!, '.config/solana/id.json');
const wallet = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf8')))
);

async function testDevnet() {
  console.log('🚀 Testing Continuum on Devnet\n');
  console.log('Wallet:', wallet.publicKey.toBase58());
  
  // Check wallet balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log('Balance:', balance / LAMPORTS_PER_SOL, 'SOL');
  
  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    console.error('❌ Insufficient balance. Please airdrop SOL to your wallet:');
    console.error(`solana airdrop 1 ${wallet.publicKey.toBase58()} --url devnet`);
    return;
  }
  
  // Check if programs are deployed
  console.log('\n📋 Checking deployed programs...');
  
  const continuumAccount = await connection.getAccountInfo(CONTINUUM_PROGRAM_ID);
  if (continuumAccount && continuumAccount.executable) {
    console.log('✅ Continuum program deployed:', CONTINUUM_PROGRAM_ID.toBase58());
  } else {
    console.error('❌ Continuum program not found on devnet');
    return;
  }
  
  const cpSwapAccount = await connection.getAccountInfo(CP_SWAP_PROGRAM_ID);
  if (cpSwapAccount && cpSwapAccount.executable) {
    console.log('✅ CP-Swap program deployed:', CP_SWAP_PROGRAM_ID.toBase58());
  } else {
    console.error('❌ CP-Swap program not found on devnet');
    return;
  }
  
  // Check FIFO state
  const [fifoState] = PublicKey.findProgramAddressSync(
    [Buffer.from('fifo_state')],
    CONTINUUM_PROGRAM_ID
  );
  
  const fifoAccount = await connection.getAccountInfo(fifoState);
  if (fifoAccount) {
    console.log('✅ FIFO state initialized:', fifoState.toBase58());
  } else {
    console.log('⚠️  FIFO state not initialized. Run initialization first.');
  }
  
  console.log('\n✅ Devnet setup verified!');
  console.log('\nNext steps:');
  console.log('1. Create test tokens on devnet');
  console.log('2. Create CP-Swap pool with test tokens');
  console.log('3. Test swaps through Continuum wrapper');
}

// Run the test
testDevnet()
  .then(() => {
    console.log('\n✅ Test completed');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Error:', err);
    process.exit(1);
  });