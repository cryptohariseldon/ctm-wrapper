#!/usr/bin/env ts-node
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import fs from 'fs';
import path from 'path';

async function checkTokenAccounts() {
  const connection = new Connection('http://localhost:8899', 'confirmed');
  
  // Load configurations
  const tokenConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/tokens.json'), 'utf8'));
  const poolConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/pool-final.json'), 'utf8'));
  
  const user = new PublicKey('GsV1jugD8ftfWBYNykA9SLK2V4mQqUW2sLop8MAfjVRq');
  const usdcMint = new PublicKey(tokenConfig.usdcMint);
  const wsolMint = new PublicKey(tokenConfig.wsolMint);
  
  // Get expected ATAs
  const userUsdcAta = getAssociatedTokenAddressSync(usdcMint, user);
  const userWsolAta = getAssociatedTokenAddressSync(wsolMint, user);
  
  console.log('=== TOKEN ACCOUNT CHECK ===\n');
  console.log('User:', user.toBase58());
  console.log('USDC Mint:', usdcMint.toBase58());
  console.log('WSOL Mint:', wsolMint.toBase58());
  
  // Check USDC account
  console.log('\nUSER USDC ACCOUNT:');
  console.log('Expected ATA:', userUsdcAta.toBase58());
  const usdcAccount = await connection.getParsedAccountInfo(userUsdcAta);
  if (usdcAccount.value) {
    const data = usdcAccount.value.data as any;
    console.log('- Exists: YES');
    console.log('- Owner program:', usdcAccount.value.owner.toBase58());
    console.log('- Token owner:', data.parsed.info.owner);
    console.log('- Balance:', data.parsed.info.tokenAmount.uiAmountString);
    console.log('- Mint:', data.parsed.info.mint);
  } else {
    console.log('- Exists: NO');
  }
  
  // Check WSOL account
  console.log('\nUSER WSOL ACCOUNT:');
  console.log('Expected ATA:', userWsolAta.toBase58());
  const wsolAccount = await connection.getParsedAccountInfo(userWsolAta);
  if (wsolAccount.value) {
    const data = wsolAccount.value.data as any;
    console.log('- Exists: YES');
    console.log('- Owner program:', wsolAccount.value.owner.toBase58());
    console.log('- Token owner:', data.parsed.info.owner);
    console.log('- Balance:', data.parsed.info.tokenAmount.uiAmountString);
    console.log('- Mint:', data.parsed.info.mint);
  } else {
    console.log('- Exists: NO');
  }
  
  // Check pool vaults
  console.log('\n=== POOL VAULTS ===');
  const vaults = [
    { name: 'Token A Vault (WSOL)', pubkey: new PublicKey(poolConfig.tokenAVault) },
    { name: 'Token B Vault (USDC)', pubkey: new PublicKey(poolConfig.tokenBVault) },
  ];
  
  for (const vault of vaults) {
    console.log(`\n${vault.name}:`);
    console.log('Address:', vault.pubkey.toBase58());
    const vaultAccount = await connection.getParsedAccountInfo(vault.pubkey);
    if (vaultAccount.value) {
      const data = vaultAccount.value.data as any;
      console.log('- Owner program:', vaultAccount.value.owner.toBase58());
      console.log('- Token owner:', data.parsed.info.owner);
      console.log('- Balance:', data.parsed.info.tokenAmount.uiAmountString);
      console.log('- Mint:', data.parsed.info.mint);
    }
  }
}

// Run if called directly
if (require.main === module) {
  checkTokenAccounts()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}