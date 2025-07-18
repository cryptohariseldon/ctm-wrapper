#!/usr/bin/env ts-node
import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from "@coral-xyz/anchor";
import fs from 'fs';
import path from 'path';

async function debugAmmConfig() {
  const connection = new Connection('http://localhost:8899', 'confirmed');
  
  // Load pool config
  const poolConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/pool-final.json'), 'utf8'));
  const ammConfigPubkey = new PublicKey(poolConfig.ammConfig);
  
  console.log('=== AMM CONFIG DEBUG ===\n');
  console.log('AMM Config Address:', ammConfigPubkey.toBase58());
  
  // Get account info
  const accountInfo = await connection.getAccountInfo(ammConfigPubkey);
  if (!accountInfo) {
    console.log('Account not found!');
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
  
  // Compare with expected Anchor account discriminator
  // Anchor calculates discriminator as first 8 bytes of SHA256("account:AmmConfig")
  const crypto = require('crypto');
  const expectedDiscriminator = crypto.createHash('sha256')
    .update('account:AmmConfig')
    .digest()
    .slice(0, 8);
  
  console.log('\nExpected Anchor discriminator:', Array.from(expectedDiscriminator));
  console.log('Expected discriminator (hex):', expectedDiscriminator.toString('hex'));
  console.log('Match:', discriminator.equals(expectedDiscriminator));
  
  // Try to deserialize manually
  if (accountInfo.data.length >= 236) {
    console.log('\n=== Manual Deserialization ===');
    let offset = 8; // Skip discriminator
    
    const bump = accountInfo.data.readUInt8(offset);
    offset += 1;
    
    const disableCreatePool = accountInfo.data.readUInt8(offset) === 1;
    offset += 1;
    
    const index = accountInfo.data.readUInt16LE(offset);
    offset += 2;
    
    const tradeFeeRate = accountInfo.data.readBigUInt64LE(offset);
    offset += 8;
    
    const protocolFeeRate = accountInfo.data.readBigUInt64LE(offset);
    offset += 8;
    
    const fundFeeRate = accountInfo.data.readBigUInt64LE(offset);
    offset += 8;
    
    const createPoolFee = accountInfo.data.readBigUInt64LE(offset);
    offset += 8;
    
    const protocolOwner = new PublicKey(accountInfo.data.slice(offset, offset + 32));
    offset += 32;
    
    const fundOwner = new PublicKey(accountInfo.data.slice(offset, offset + 32));
    
    console.log('Parsed data:');
    console.log('- bump:', bump);
    console.log('- disableCreatePool:', disableCreatePool);
    console.log('- index:', index);
    console.log('- tradeFeeRate:', tradeFeeRate.toString());
    console.log('- protocolFeeRate:', protocolFeeRate.toString());
    console.log('- fundFeeRate:', fundFeeRate.toString());
    console.log('- createPoolFee:', createPoolFee.toString());
    console.log('- protocolOwner:', protocolOwner.toBase58());
    console.log('- fundOwner:', fundOwner.toBase58());
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
  debugAmmConfig()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}