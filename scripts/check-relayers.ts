#!/usr/bin/env ts-node

import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

const PROGRAM_ID = 'EaeWUSam5Li1fzCcCs33oE4jCLQT4F6RJXgrPYZaoKqq';

async function checkRelayers() {
  console.log('🔍 Checking Authorized Relayers\n');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const cluster = args.find(arg => arg.startsWith('--cluster='))?.split('=')[1] || 'devnet';
  
  console.log(`Program ID: ${PROGRAM_ID}`);
  console.log(`Cluster: ${cluster}\n`);

  // Setup connection
  const connection = new Connection(
    cluster === 'devnet' ? 'https://api.devnet.solana.com' : 
    cluster === 'mainnet' ? 'https://api.mainnet-beta.solana.com' : 
    'http://localhost:8899'
  );

  // Create a dummy provider (we're just reading, no signing needed)
  const dummyKeypair = anchor.web3.Keypair.generate();
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(dummyKeypair),
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
  
  console.log(`FifoState PDA: ${fifoState.toBase58()}\n`);

  // Fetch state
  try {
    const fifoData = await program.account.fifoState.fetch(fifoState);
    
    console.log('📊 Program State:');
    console.log('================');
    console.log(`Admin: ${fifoData.admin.toBase58()}`);
    console.log(`Current Sequence: ${fifoData.currentSequence.toString()}`);
    console.log(`Emergency Pause: ${fifoData.emergencyPause}`);
    console.log(`\nAuthorized Relayers (${fifoData.authorizedRelayers.length}):`);
    
    if (fifoData.authorizedRelayers.length === 0) {
      console.log('  (none)');
    } else {
      fifoData.authorizedRelayers.forEach((relayer, index) => {
        console.log(`  ${index + 1}. ${relayer.toBase58()}`);
      });
    }
    
    // Check if any known relayers are running
    console.log('\n🔗 Checking Known Relayers:');
    
    // Try to fetch relayer info from common ports
    const relayerPorts = [8085, 8086, 8080];
    for (const port of relayerPorts) {
      try {
        const response = await fetch(`http://localhost:${port}/api/v1/info`);
        if (response.ok) {
          const info = await response.json();
          const relayerAddress = new PublicKey(info.relayerAddress);
          const isAuthorized = fifoData.authorizedRelayers.some(r => r.equals(relayerAddress));
          
          console.log(`\n  Port ${port}: ${info.relayerAddress}`);
          console.log(`  Status: ${isAuthorized ? '✅ Authorized' : '❌ Not Authorized'}`);
        }
      } catch (error) {
        // Relayer not running on this port
      }
    }
    
  } catch (error) {
    console.error('Failed to fetch program state:', error);
    console.error('\nPossible reasons:');
    console.error('1. Program not initialized');
    console.error('2. Wrong program ID');
    console.error('3. Network issues');
    process.exit(1);
  }
  
  console.log('\n✨ Done!');
}

checkRelayers()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });