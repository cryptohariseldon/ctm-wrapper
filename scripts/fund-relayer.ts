#!/usr/bin/env ts-node

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { mintTo, getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_RPC = 'https://api.devnet.solana.com';
const RELAYER_ADDRESS = '785Bgkii28SRfWSShrYZ6wmGZRgVBpHwd38WAbjU6B4Z';

// Token mints from devnet-tokens.json
const USDC_MINT = '8eLeJssGBw8Z2z1y3uz1xCwzrWa2QjCqAtH7Y88MjTND';
const WSOL_MINT = '99dB8f37b5n9rnU8Yc7D4Ey5XubJuCDDSacYwE4GPEtV';

// Amount to mint (1000 USDC and 10 SOL worth of WSOL)
const USDC_AMOUNT = 1000 * 10**6; // 1000 USDC (6 decimals)
const WSOL_AMOUNT = 10 * 10**9; // 10 SOL worth of WSOL (9 decimals)

async function fundRelayer() {
  console.log('🚀 Funding relayer wallet:', RELAYER_ADDRESS);
  
  const connection = new Connection(DEVNET_RPC, 'confirmed');
  
  // Load default keypair (mint authority)
  const defaultKeypairPath = path.join(process.env.HOME!, '.config/solana/id.json');
  const secretKey = JSON.parse(fs.readFileSync(defaultKeypairPath, 'utf-8'));
  const mintAuthority = Keypair.fromSecretKey(new Uint8Array(secretKey));
  
  console.log('Using mint authority:', mintAuthority.publicKey.toBase58());
  
  const relayerPubkey = new PublicKey(RELAYER_ADDRESS);
  const usdcMintPubkey = new PublicKey(USDC_MINT);
  const wsolMintPubkey = new PublicKey(WSOL_MINT);
  
  try {
    // First airdrop some SOL for transaction fees
    console.log('\n💸 Airdropping SOL for transaction fees...');
    const airdropSig = await connection.requestAirdrop(relayerPubkey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdropSig);
    console.log('✅ Airdropped 2 SOL');
    
    // Get or create USDC token account for relayer
    console.log('\n💰 Creating/getting USDC token account...');
    const usdcTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      mintAuthority,
      usdcMintPubkey,
      relayerPubkey
    );
    console.log('USDC token account:', usdcTokenAccount.address.toBase58());
    
    // Mint USDC to relayer
    console.log('\n🏭 Minting USDC to relayer...');
    const usdcMintSig = await mintTo(
      connection,
      mintAuthority,
      usdcMintPubkey,
      usdcTokenAccount.address,
      mintAuthority,
      USDC_AMOUNT
    );
    await connection.confirmTransaction(usdcMintSig);
    console.log(`✅ Minted ${USDC_AMOUNT / 10**6} USDC`);
    console.log('Transaction:', usdcMintSig);
    
    // Get or create WSOL token account for relayer
    console.log('\n💰 Creating/getting WSOL token account...');
    const wsolTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      mintAuthority,
      wsolMintPubkey,
      relayerPubkey
    );
    console.log('WSOL token account:', wsolTokenAccount.address.toBase58());
    
    // Mint WSOL to relayer
    console.log('\n🏭 Minting WSOL to relayer...');
    const wsolMintSig = await mintTo(
      connection,
      mintAuthority,
      wsolMintPubkey,
      wsolTokenAccount.address,
      mintAuthority,
      WSOL_AMOUNT
    );
    await connection.confirmTransaction(wsolMintSig);
    console.log(`✅ Minted ${WSOL_AMOUNT / 10**9} WSOL`);
    console.log('Transaction:', wsolMintSig);
    
    // Check final balances
    console.log('\n📊 Final balances:');
    const solBalance = await connection.getBalance(relayerPubkey);
    console.log(`SOL: ${solBalance / LAMPORTS_PER_SOL}`);
    
    const usdcBalance = await connection.getTokenAccountBalance(usdcTokenAccount.address);
    console.log(`USDC: ${usdcBalance.value.uiAmount}`);
    
    const wsolBalance = await connection.getTokenAccountBalance(wsolTokenAccount.address);
    console.log(`WSOL: ${wsolBalance.value.uiAmount}`);
    
    console.log('\n✅ Relayer funded successfully!');
    
  } catch (error) {
    console.error('❌ Error funding relayer:', error);
    process.exit(1);
  }
}

fundRelayer()
  .then(() => process.exit(0))
  .catch(console.error);