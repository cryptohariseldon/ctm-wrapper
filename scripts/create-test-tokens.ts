#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { 
  createMint, 
  getOrCreateAssociatedTokenAccount, 
  mintTo,
  TOKEN_PROGRAM_ID 
} from '@solana/spl-token';
import fs from 'fs';
import path from 'path';

// Configuration
const CONFIG_FILE = path.join(__dirname, '../config/tokens.json');
const connection = new Connection('http://localhost:8899', 'confirmed');

interface TokenConfig {
  usdcMint: string;
  wsolMint: string;
  decimals: {
    usdc: number;
    wsol: number;
  };
}

async function createTestTokens() {
  console.log('Creating test tokens on localnet...\n');

  // Load payer keypair
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/home/ubuntu/.config/solana/id.json', 'utf8')))
  );
  console.log('Payer:', payerKeypair.publicKey.toBase58());

  // Check balance
  const balance = await connection.getBalance(payerKeypair.publicKey);
  console.log('Payer balance:', balance / 1e9, 'SOL\n');

  // Create USDC-like token
  console.log('Creating USDC-like token (6 decimals)...');
  const usdcMint = await createMint(
    connection,
    payerKeypair,
    payerKeypair.publicKey, // mint authority
    payerKeypair.publicKey, // freeze authority
    6, // decimals
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );
  console.log('USDC mint created:', usdcMint.toBase58());

  // Create WSOL-like token
  console.log('\nCreating WSOL-like token (9 decimals)...');
  const wsolMint = await createMint(
    connection,
    payerKeypair,
    payerKeypair.publicKey, // mint authority
    payerKeypair.publicKey, // freeze authority
    9, // decimals
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );
  console.log('WSOL mint created:', wsolMint.toBase58());

  // Create token accounts and mint initial supply
  console.log('\nCreating token accounts and minting initial supply...');

  // USDC account
  const usdcAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payerKeypair,
    usdcMint,
    payerKeypair.publicKey
  );
  console.log('USDC token account:', usdcAccount.address.toBase58());

  // Mint 1,000,000 USDC
  await mintTo(
    connection,
    payerKeypair,
    usdcMint,
    usdcAccount.address,
    payerKeypair.publicKey,
    1_000_000 * 10 ** 6 // 1M USDC with 6 decimals
  );
  console.log('Minted 1,000,000 USDC');

  // WSOL account
  const wsolAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payerKeypair,
    wsolMint,
    payerKeypair.publicKey
  );
  console.log('WSOL token account:', wsolAccount.address.toBase58());

  // Mint 10,000 WSOL
  await mintTo(
    connection,
    payerKeypair,
    wsolMint,
    wsolAccount.address,
    payerKeypair.publicKey,
    10_000 * 10 ** 9 // 10K WSOL with 9 decimals
  );
  console.log('Minted 10,000 WSOL');

  // Save configuration
  const config: TokenConfig = {
    usdcMint: usdcMint.toBase58(),
    wsolMint: wsolMint.toBase58(),
    decimals: {
      usdc: 6,
      wsol: 9
    }
  };

  // Create config directory if it doesn't exist
  const configDir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  console.log('\nToken configuration saved to:', CONFIG_FILE);

  console.log('\nToken creation complete!');
  console.log('USDC mint:', usdcMint.toBase58());
  console.log('WSOL mint:', wsolMint.toBase58());

  return config;
}

// Run if called directly
if (require.main === module) {
  createTestTokens()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error creating tokens:', err);
      process.exit(1);
    });
}

export { createTestTokens };