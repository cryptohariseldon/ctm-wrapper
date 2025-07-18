#!/usr/bin/env ts-node
import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from "@coral-xyz/anchor";
import fs from 'fs';
import path from 'path';

async function debugPoolState() {
  const connection = new Connection('http://localhost:8899', 'confirmed');
  
  // Load pool config
  const poolConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/pool-final.json'), 'utf8'));
  const poolId = new PublicKey(poolConfig.poolId);
  
  console.log('=== POOL STATE DEBUG ===\n');
  console.log('Pool ID:', poolId.toBase58());
  
  // Get account info
  const accountInfo = await connection.getAccountInfo(poolId);
  if (!accountInfo) {
    console.log('Pool account not found!');
    return;
  }
  
  console.log('\nAccount Info:');
  console.log('- Owner:', accountInfo.owner.toBase58());
  console.log('- Size:', accountInfo.data.length, 'bytes');
  console.log('- Lamports:', accountInfo.lamports);
  
  // Show raw data
  console.log('\nRaw data (first 64 bytes):');
  console.log(accountInfo.data.slice(0, 64).toString('hex'));
  
  // Parse discriminator
  const discriminator = accountInfo.data.slice(0, 8);
  console.log('\nDiscriminator:', Array.from(discriminator));
  console.log('Discriminator (hex):', discriminator.toString('hex'));
  
  // Expected discriminator for PoolState
  const crypto = require('crypto');
  const expectedDiscriminator = crypto.createHash('sha256')
    .update('account:PoolState')
    .digest()
    .slice(0, 8);
  
  console.log('\nExpected Anchor discriminator:', Array.from(expectedDiscriminator));
  console.log('Expected discriminator (hex):', expectedDiscriminator.toString('hex'));
  console.log('Match:', discriminator.equals(expectedDiscriminator));
  
  // Try to read AMM config from pool state
  if (accountInfo.data.length >= 40) {
    console.log('\n=== Checking AMM Config Reference ===');
    // Skip discriminator (8 bytes) and read amm_config pubkey at offset 8
    const ammConfigBytes = accountInfo.data.slice(8, 8 + 32);
    const ammConfigPubkey = new PublicKey(ammConfigBytes);
    console.log('AMM Config in pool state:', ammConfigPubkey.toBase58());
    console.log('Expected AMM Config:', poolConfig.ammConfig);
    console.log('Match:', ammConfigPubkey.toBase58() === poolConfig.ammConfig);
  }
  
  // Check if this is the CP-Swap program
  const CP_SWAP_PROGRAM = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');
  console.log('\n=== Program Check ===');
  console.log('Account owner:', accountInfo.owner.toBase58());
  console.log('CP-Swap program:', CP_SWAP_PROGRAM.toBase58());
  console.log('Is CP-Swap account:', accountInfo.owner.equals(CP_SWAP_PROGRAM));
}

// Run if called directly
if (require.main === module) {
  debugPoolState()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}