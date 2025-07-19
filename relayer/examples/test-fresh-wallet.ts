#!/usr/bin/env ts-node

import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { submitSwap } from './submit-swap';

async function testWithFreshWallet() {
  console.log('🆕 Creating fresh wallet for testing...\n');
  
  // Generate new keypair
  const freshWallet = Keypair.generate();
  console.log('Fresh wallet public key:', freshWallet.publicKey.toBase58());
  console.log('Please fund this wallet with SOL and USDC tokens.\n');
  
  // Try to airdrop SOL
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  console.log('💰 Attempting to airdrop SOL...');
  try {
    const airdropSig = await connection.requestAirdrop(
      freshWallet.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig);
    console.log('✅ Airdrop successful!');
  } catch (error) {
    console.log('❌ Airdrop failed. Please manually fund the wallet.');
    console.log('\nWallet address to fund:');
    console.log(freshWallet.publicKey.toBase58());
    console.log('\nPress Ctrl+C to exit and fund the wallet, then run again with the same keypair.');
    
    // Save keypair for next run
    const fs = require('fs');
    fs.writeFileSync('test-wallet.json', JSON.stringify(Array.from(freshWallet.secretKey)));
    console.log('\nKeypair saved to test-wallet.json for future use.');
    return;
  }
  
  // Check balance
  const balance = await connection.getBalance(freshWallet.publicKey);
  console.log(`Current balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  
  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    console.log('\n⚠️  Insufficient SOL balance. Please fund the wallet:');
    console.log(freshWallet.publicKey.toBase58());
    return;
  }
  
  // Wait a bit for account to be ready
  console.log('\n⏳ Waiting for account to be ready...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Test swap
  console.log('\n🔄 Testing swap with fresh wallet...');
  
  const swapParams = {
    poolId: '9AJUf9ZQ2sWq93ose12BePBn4sq36cyqE98MiZraFLJT',
    amountIn: '1000000', // 1 USDC
    minAmountOut: '0',
    isBaseInput: true,
    userWallet: freshWallet
  };
  
  try {
    const result = await submitSwap(swapParams);
    console.log('\n✅ Swap test completed successfully!');
    console.log('Result:', result);
  } catch (error) {
    console.error('\n❌ Swap test failed:', error);
  }
}

// Check if we have a saved wallet from previous run
async function main() {
  const fs = require('fs');
  let wallet: Keypair;
  
  if (fs.existsSync('test-wallet.json')) {
    console.log('📂 Found existing test wallet, loading...');
    const walletData = JSON.parse(fs.readFileSync('test-wallet.json', 'utf8'));
    wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    console.log('Wallet address:', wallet.publicKey.toBase58());
    
    // Check if it has balance
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    const balance = await connection.getBalance(wallet.publicKey);
    console.log(`Current balance: ${balance / LAMPORTS_PER_SOL} SOL`);
    
    if (balance > 0.1 * LAMPORTS_PER_SOL) {
      // Use existing wallet
      console.log('\n🔄 Testing swap with existing wallet...');
      
      const swapParams = {
        poolId: '9AJUf9ZQ2sWq93ose12BePBn4sq36cyqE98MiZraFLJT',
        amountIn: '1000000', // 1 USDC
        minAmountOut: '0',
        isBaseInput: true,
        userWallet: wallet
      };
      
      try {
        const result = await submitSwap(swapParams);
        console.log('\n✅ Swap test completed successfully!');
        console.log('Result:', result);
      } catch (error) {
        console.error('\n❌ Swap test failed:', error);
      }
      return;
    }
  }
  
  // Create new wallet
  await testWithFreshWallet();
}

main()
  .then(() => process.exit(0))
  .catch(console.error);