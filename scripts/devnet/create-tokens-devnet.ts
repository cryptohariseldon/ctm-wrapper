#!/usr/bin/env ts-node
import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createMint, mintTo, getAssociatedTokenAddressSync, createAssociatedTokenAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import fs from 'fs';
import path from 'path';

// Devnet configuration
const DEVNET_URL = 'https://api.devnet.solana.com';
const connection = new Connection(DEVNET_URL, 'confirmed');

async function createTokensOnDevnet() {
  console.log('🚀 Creating test tokens on Devnet\n');
  
  // Load wallet
  const walletPath = process.env.WALLET_PATH || path.join(process.env.HOME!, '.config/solana/id.json');
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf8')))
  );
  
  console.log('Wallet:', wallet.publicKey.toBase58());
  
  // Check balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log('Balance:', balance / LAMPORTS_PER_SOL, 'SOL');
  
  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    console.error('❌ Insufficient balance. Please airdrop SOL:');
    console.error(`solana airdrop 2 ${wallet.publicKey.toBase58()} --url devnet`);
    process.exit(1);
  }
  
  try {
    // Create USDC-like token
    console.log('\n📋 Creating USDC-like token...');
    const usdcMint = await createMint(
      connection,
      wallet,
      wallet.publicKey,
      wallet.publicKey,
      6,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );
    console.log('✅ USDC mint created:', usdcMint.toBase58());
    
    // Create WSOL-like token
    console.log('\n📋 Creating WSOL-like token...');
    const wsolMint = await createMint(
      connection,
      wallet,
      wallet.publicKey,
      wallet.publicKey,
      9,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );
    console.log('✅ WSOL mint created:', wsolMint.toBase58());
    
    // Create token accounts
    console.log('\n📋 Creating token accounts...');
    const usdcAta = getAssociatedTokenAddressSync(usdcMint, wallet.publicKey);
    const wsolAta = getAssociatedTokenAddressSync(wsolMint, wallet.publicKey);
    
    await createAssociatedTokenAccount(
      connection,
      wallet,
      usdcMint,
      wallet.publicKey
    );
    console.log('✅ USDC ATA:', usdcAta.toBase58());
    
    await createAssociatedTokenAccount(
      connection,
      wallet,
      wsolMint,
      wallet.publicKey
    );
    console.log('✅ WSOL ATA:', wsolAta.toBase58());
    
    // Mint tokens
    console.log('\n📋 Minting tokens...');
    
    // Mint 10,000 USDC
    await mintTo(
      connection,
      wallet,
      usdcMint,
      usdcAta,
      wallet.publicKey,
      10000 * 10 ** 6
    );
    console.log('✅ Minted 10,000 USDC');
    
    // Mint 100 WSOL
    await mintTo(
      connection,
      wallet,
      wsolMint,
      wsolAta,
      wallet.publicKey,
      100 * 10 ** 9
    );
    console.log('✅ Minted 100 WSOL');
    
    // Save token info
    const tokenInfo = {
      network: 'devnet',
      usdcMint: usdcMint.toBase58(),
      wsolMint: wsolMint.toBase58(),
      usdcAta: usdcAta.toBase58(),
      wsolAta: wsolAta.toBase58(),
      owner: wallet.publicKey.toBase58(),
      createdAt: new Date().toISOString()
    };
    
    const outputPath = path.join(__dirname, 'devnet-tokens.json');
    fs.writeFileSync(outputPath, JSON.stringify(tokenInfo, null, 2));
    console.log('\n✅ Token info saved to:', outputPath);
    
    // Display summary
    console.log('\n📊 Summary:');
    console.log('='.repeat(50));
    console.log('USDC Mint:', usdcMint.toBase58());
    console.log('WSOL Mint:', wsolMint.toBase58());
    console.log('USDC Balance: 10,000');
    console.log('WSOL Balance: 100');
    console.log('='.repeat(50));
    
    console.log('\n✨ Tokens created successfully!');
    console.log('Use these mints for creating CP-Swap pools on devnet.');
    
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

// Run the script
createTokensOnDevnet()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });