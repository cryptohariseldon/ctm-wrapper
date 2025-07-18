#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const connection = new Connection('http://localhost:8899', 'confirmed');

async function redeployCpSwap() {
  console.log('Redeploying CP-Swap program...\n');
  
  // Load payer keypair
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/home/ubuntu/.config/solana/id.json', 'utf8')))
  );
  console.log('Payer:', payerKeypair.publicKey.toBase58());
  
  // Change to raydium-cp-swap directory
  const cpSwapDir = path.join(__dirname, '../raydium-cp-swap');
  process.chdir(cpSwapDir);
  console.log('Working directory:', process.cwd());
  
  try {
    // Build the program
    console.log('\nBuilding CP-Swap program...');
    execSync('anchor build', { stdio: 'inherit' });
    
    // Deploy the program
    console.log('\nDeploying CP-Swap program...');
    execSync('anchor deploy --provider.cluster localnet', { stdio: 'inherit' });
    
    console.log('\n✅ CP-Swap program redeployed successfully!');
    
    // Get the new program ID
    const idlPath = path.join(cpSwapDir, 'target/idl/raydium_cp_swap.json');
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
    console.log('Program ID:', idl.metadata?.address || 'Check target/deploy/raydium_cp_swap-keypair.json');
    
  } catch (err) {
    console.error('Error redeploying:', err.message);
    console.log('\nAlternatively, you can manually redeploy:');
    console.log('1. cd ../raydium-cp-swap');
    console.log('2. anchor build');
    console.log('3. anchor deploy --provider.cluster localnet');
  }
}

if (require.main === module) {
  redeployCpSwap()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}