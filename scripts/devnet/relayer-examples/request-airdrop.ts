#!/usr/bin/env ts-node
import { PublicKey, Keypair } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:8085';

async function requestAirdrop(walletAddress: string, token: 'SOL' | 'USDC' | 'WSOL', amount?: number) {
  console.log(`\nRequesting ${token} airdrop for ${walletAddress}...`);
  
  const payload = {
    address: walletAddress,
    token,
    ...(amount && { amount })
  };

  try {
    const response = await fetch(`${RELAYER_URL}/api/v1/airdrop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json() as any;
    
    if (!response.ok) {
      throw new Error(data.error || 'Airdrop request failed');
    }

    console.log('✅ Airdrop successful!');
    console.log(`Token: ${data.token}`);
    console.log(`Amount: ${data.amount}`);
    console.log(`Signature: ${data.signature}`);
    console.log(`New Balance: ${data.newBalance}`);
    if (data.tokenAccount) {
      console.log(`Token Account: ${data.tokenAccount}`);
    }
    
    return data;
  } catch (error: any) {
    console.error('❌ Airdrop failed:', error.message);
    throw error;
  }
}

async function main() {
  // Load wallet
  const walletPath = process.env.WALLET_PATH || '/home/ubuntu/.config/solana/id.json';
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf8')))
  );
  const walletAddress = walletKeypair.publicKey.toBase58();
  
  console.log('Wallet address:', walletAddress);
  console.log('Relayer URL:', RELAYER_URL);

  try {
    // Request SOL airdrop (0.1 SOL)
    await requestAirdrop(walletAddress, 'SOL', 0.1);
    
    // Wait a bit to avoid rate limiting
    console.log('\nWaiting 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Request USDC airdrop (1000 USDC - default)
    await requestAirdrop(walletAddress, 'USDC');
    
    // Wait again
    console.log('\nWaiting 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Request WSOL airdrop (10 WSOL - default)
    await requestAirdrop(walletAddress, 'WSOL');
    
    console.log('\n✅ All airdrops completed!');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { requestAirdrop };