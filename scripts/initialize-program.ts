#!/usr/bin/env ts-node

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

const PROGRAM_ID = 'EaeWUSam5Li1fzCcCs33oE4jCLQT4F6RJXgrPYZaoKqq';

async function initializeProgram() {
  console.log('🚀 Initializing Continuum CP-Swap Program\n');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const adminKeypairPath = args.find(arg => arg.startsWith('--admin='))?.split('=')[1];
  const cluster = args.find(arg => arg.startsWith('--cluster='))?.split('=')[1] || 'devnet';
  
  if (!adminKeypairPath) {
    console.error('Usage: ts-node initialize-program.ts --admin=<PATH> [--cluster=devnet]');
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
  console.log(`Cluster: ${cluster}\n`);

  // Setup connection and provider
  const connection = new Connection(
    cluster === 'devnet' ? 'https://api.devnet.solana.com' : 
    cluster === 'mainnet' ? 'https://api.mainnet-beta.solana.com' : 
    'http://localhost:8899'
  );

  // Check admin balance
  const balance = await connection.getBalance(adminKeypair.publicKey);
  console.log(`Admin balance: ${balance / 1e9} SOL`);
  
  if (balance < 0.1 * 1e9) {
    console.error('Insufficient balance. Admin needs at least 0.1 SOL.');
    if (cluster === 'devnet') {
      console.log('\nRequest airdrop:');
      console.log(`solana airdrop 2 ${adminKeypair.publicKey.toBase58()} --url devnet`);
    }
    process.exit(1);
  }

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(adminKeypair),
    { commitment: 'confirmed' }
  );
  anchor.setProvider(provider);

  // Load the IDL
  const idlPath = path.join(__dirname, '../target/idl/continuum_cp_swap.json');
  if (!fs.existsSync(idlPath)) {
    console.error('IDL not found. Please build the program first:');
    console.error('cd programs/continuum-cp-swap && anchor build');
    process.exit(1);
  }
  
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
  const program = new Program(idl, PROGRAM_ID, provider);
  
  // Derive PDAs
  const [fifoState] = PublicKey.findProgramAddressSync(
    [Buffer.from('fifo_state')],
    program.programId
  );

  console.log(`Program ID: ${PROGRAM_ID}`);
  console.log(`FifoState PDA: ${fifoState.toBase58()}\n`);

  // Check if already initialized
  const accountInfo = await connection.getAccountInfo(fifoState);
  if (accountInfo) {
    console.log('⚠️  Program already initialized!');
    
    try {
      const fifoData = await program.account.fifoState.fetch(fifoState);
      console.log('\nCurrent state:');
      console.log('- Admin:', fifoData.admin.toBase58());
      console.log('- Current sequence:', fifoData.currentSequence.toString());
      console.log('- Emergency pause:', fifoData.emergencyPause);
      console.log('- Authorized relayers:', fifoData.authorizedRelayers.length);
      
      if (fifoData.authorizedRelayers.length > 0) {
        console.log('\nAuthorized relayers:');
        fifoData.authorizedRelayers.forEach((relayer: PublicKey, index: number) => {
          console.log(`  ${index + 1}. ${relayer.toBase58()}`);
        });
      }
    } catch (error) {
      console.error('Failed to fetch state:', error);
    }
    
    return;
  }

  // Initialize the program
  console.log('📝 Initializing program...');
  
  try {
    const tx = await program.methods
      .initialize()
      .accounts({
        fifoState,
        admin: adminKeypair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    
    console.log('✅ Program initialized successfully!');
    console.log('Transaction signature:', tx);
    
    // Verify initialization
    const fifoData = await program.account.fifoState.fetch(fifoState);
    console.log('\nInitialized state:');
    console.log('- Admin:', fifoData.admin.toBase58());
    console.log('- Current sequence:', fifoData.currentSequence.toString());
    console.log('- Emergency pause:', fifoData.emergencyPause);
    console.log('- Authorized relayers:', fifoData.authorizedRelayers.length);
    
  } catch (error: any) {
    console.error('\n❌ Initialization failed:', error);
    
    if (error.logs) {
      console.error('\nProgram logs:');
      error.logs.forEach((log: string) => console.error(log));
    }
    
    process.exit(1);
  }
  
  // Save initialization info
  const initInfo = {
    programId: PROGRAM_ID,
    adminPublicKey: adminKeypair.publicKey.toBase58(),
    fifoState: fifoState.toBase58(),
    cluster,
    initializedAt: new Date().toISOString(),
  };
  
  const initPath = path.join(__dirname, `../initialization-${cluster}.json`);
  fs.writeFileSync(initPath, JSON.stringify(initInfo, null, 2));
  console.log(`\n📄 Initialization info saved to: ${initPath}`);
  
  console.log('\n✨ Done!');
  console.log('\nNext steps:');
  console.log('1. Add authorized relayers:');
  console.log(`   ts-node scripts/add-relayer.ts --admin=${adminKeypairPath} --relayer=<RELAYER_PUBKEY>`);
  console.log('2. Configure and start the relayer service');
}

initializeProgram()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });