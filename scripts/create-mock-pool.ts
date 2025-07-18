#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

// Configuration
const CONFIG_FILE = path.join(__dirname, '../config/tokens.json');
const POOL_CONFIG_FILE = path.join(__dirname, '../config/pool.json');

interface PoolConfig {
  poolId: string;
  ammConfig: string;
  tokenAMint: string;
  tokenBMint: string;
  tokenAVault: string;
  tokenBVault: string;
  lpMint: string;
  continuum_authority: string;
  cpSwapProgram: string;
}

async function createMockPool() {
  console.log('Creating mock pool configuration...\n');

  // Load token configuration
  const tokenConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const usdcMint = new PublicKey(tokenConfig.usdcMint);
  const wsolMint = new PublicKey(tokenConfig.wsolMint);

  // Generate random pool ID for testing
  const poolKeypair = Keypair.generate();
  const poolId = poolKeypair.publicKey;

  // CP-Swap program ID (provided by user)
  const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');
  
  // Continuum program ID
  const CONTINUUM_PROGRAM_ID = new PublicKey('EaeWUSam5Li1fzCcCs33oE4jCLQT4F6RJXgrPYZaoKqq');

  // Sort tokens (CP-Swap requires token0 < token1)
  let token0Mint: PublicKey;
  let token1Mint: PublicKey;
  if (usdcMint.toBuffer().compare(wsolMint.toBuffer()) < 0) {
    token0Mint = usdcMint;
    token1Mint = wsolMint;
    console.log('Token ordering: USDC is token0, WSOL is token1');
  } else {
    token0Mint = wsolMint;
    token1Mint = usdcMint;
    console.log('Token ordering: WSOL is token0, USDC is token1');
  }

  // Generate mock vaults and LP mint
  const token0Vault = Keypair.generate().publicKey;
  const token1Vault = Keypair.generate().publicKey;
  const lpMint = Keypair.generate().publicKey;
  const ammConfig = Keypair.generate().publicKey;

  // Derive Continuum pool authority
  const [continuumAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('cp_pool_authority'), poolId.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );

  // Save pool configuration
  const poolConfig: PoolConfig = {
    poolId: poolId.toBase58(),
    ammConfig: ammConfig.toBase58(),
    tokenAMint: token0Mint.toBase58(),
    tokenBMint: token1Mint.toBase58(),
    tokenAVault: token0Vault.toBase58(),
    tokenBVault: token1Vault.toBase58(),
    lpMint: lpMint.toBase58(),
    continuum_authority: continuumAuthority.toBase58(),
    cpSwapProgram: CP_SWAP_PROGRAM_ID.toBase58()
  };

  fs.writeFileSync(POOL_CONFIG_FILE, JSON.stringify(poolConfig, null, 2));
  console.log('\nMock pool configuration saved to:', POOL_CONFIG_FILE);

  console.log('\nMock pool configuration:');
  console.log('Pool ID:', poolId.toBase58());
  console.log('Token A (', token0Mint.equals(usdcMint) ? 'USDC' : 'WSOL', '):', token0Mint.toBase58());
  console.log('Token B (', token1Mint.equals(usdcMint) ? 'USDC' : 'WSOL', '):', token1Mint.toBase58());
  console.log('Token A Vault:', token0Vault.toBase58());
  console.log('Token B Vault:', token1Vault.toBase58());
  console.log('LP Mint:', lpMint.toBase58());
  console.log('Continuum authority:', continuumAuthority.toBase58());
  console.log('CP-Swap program:', CP_SWAP_PROGRAM_ID.toBase58());

  console.log('\nNOTE: This is a mock configuration for testing. Real pool deployment requires proper CP-Swap integration.');

  return poolConfig;
}

// Run if called directly
if (require.main === module) {
  createMockPool()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error creating mock pool:', err);
      process.exit(1);
    });
}

export { createMockPool };