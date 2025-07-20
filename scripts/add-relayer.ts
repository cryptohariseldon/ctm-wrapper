#!/usr/bin/env ts-node

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

const PROGRAM_ID = '9tcAhE4XGcZZTE8ez1EW8FF7rxyBN8uat2kkepgaeyEa';

async function addRelayer() {
  console.log('🔐 Adding Authorized Relayer to Continuum CP-Swap\n');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const adminKeypairPath = args.find(arg => arg.startsWith('--admin='))?.split('=')[1];
  const relayerPubkeyStr = args.find(arg => arg.startsWith('--relayer='))?.split('=')[1];
  const cluster = args.find(arg => arg.startsWith('--cluster='))?.split('=')[1] || 'devnet';
  
  if (!adminKeypairPath || !relayerPubkeyStr) {
    console.error('Usage: ts-node add-relayer.ts --admin=<PATH> --relayer=<PUBKEY> [--cluster=devnet]');
    process.exit(1);
  }
  
  // Load admin keypair
  if (!fs.existsSync(adminKeypairPath)) {
    console.error('Admin keypair not found:', adminKeypairPath);
    process.exit(1);
  }
  
  const keypairData = JSON.parse(fs.readFileSync(adminKeypairPath, 'utf8'));
  const adminKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
  console.log(`Admin address: ${adminKeypair.publicKey.toBase58()}`);
  
  // Parse relayer public key
  let relayerPubkey: PublicKey;
  try {
    relayerPubkey = new PublicKey(relayerPubkeyStr);
    console.log(`Relayer to add: ${relayerPubkey.toBase58()}`);
  } catch (error) {
    console.error('Invalid relayer public key:', relayerPubkeyStr);
    process.exit(1);
  }
  
  console.log(`Cluster: ${cluster}\n`);

  // Setup connection and provider
  const connection = new Connection(
    cluster === 'devnet' ? 'https://api.devnet.solana.com' : 
    cluster === 'mainnet' ? 'https://api.mainnet-beta.solana.com' : 
    'http://localhost:8899'
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(adminKeypair),
    { commitment: 'confirmed' }
  );
  anchor.setProvider(provider);

  // Load the IDL
  const idlPath = path.join(__dirname, '../target/idl/continuum_cp_swap.json');
  if (!fs.existsSync(idlPath)) {
    console.error('IDL not found. Please build the program first.');
    process.exit(1);
  }
  
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
  const program = new Program(idl, PROGRAM_ID, provider);
  
  // Derive PDAs
  const [fifoState] = PublicKey.findProgramAddressSync(
    [Buffer.from('fifo_state')],
    program.programId
  );

  // Check current state
  console.log('📊 Checking current state...');
  try {
    const fifoData = await program.account.fifoState.fetch(fifoState);
    console.log('Current admin:', fifoData.admin.toBase58());
    console.log('Current authorized relayers:', fifoData.authorizedRelayers.length);
    fifoData.authorizedRelayers.forEach((relayer, index) => {
      console.log(`  ${index + 1}. ${relayer.toBase58()}`);
    });
    
    // Check if admin matches
    if (!fifoData.admin.equals(adminKeypair.publicKey)) {
      console.error('\n❌ Error: Provided keypair is not the admin');
      console.error(`Expected: ${fifoData.admin.toBase58()}`);
      console.error(`Provided: ${adminKeypair.publicKey.toBase58()}`);
      process.exit(1);
    }
    
    // Check if relayer already exists
    if (fifoData.authorizedRelayers.some(r => r.equals(relayerPubkey))) {
      console.log('\n⚠️  Relayer already authorized');
      return;
    }
    
    // Check capacity
    if (fifoData.authorizedRelayers.length >= 10) {
      console.error('\n❌ Maximum number of relayers (10) reached');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('Failed to fetch fifo state:', error);
    console.error('Is the program initialized?');
    process.exit(1);
  }

  // Add the relayer
  console.log('\n✍️  Adding relayer...');
  try {
    const tx = await program.methods
      .addRelayer()
      .accounts({
        fifoState,
        admin: adminKeypair.publicKey,
        newRelayer: relayerPubkey,
      })
      .rpc();
    
    console.log('✅ Relayer added successfully!');
    console.log('Transaction signature:', tx);
    
    // Verify the addition
    console.log('\n📊 Verifying...');
    const updatedFifoData = await program.account.fifoState.fetch(fifoState);
    console.log('Updated authorized relayers:', updatedFifoData.authorizedRelayers.length);
    updatedFifoData.authorizedRelayers.forEach((relayer, index) => {
      console.log(`  ${index + 1}. ${relayer.toBase58()}`);
    });
    
  } catch (error) {
    console.error('\n❌ Failed to add relayer:', error);
    process.exit(1);
  }
  
  console.log('\n✨ Done!');
}

addRelayer()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });