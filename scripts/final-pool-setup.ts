#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction, 
  SystemProgram, 
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

// Configuration
const TOKEN_CONFIG_FILE = path.join(__dirname, '../config/tokens.json');
const POOL_CONFIG_FILE = path.join(__dirname, '../config/final-pool.json');
const connection = new Connection('http://localhost:8899', 'confirmed');

// Program IDs
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');
const CONTINUUM_PROGRAM_ID = new PublicKey('9tcAhE4XGcZZTE8ez1EW8FF7rxyBN8uat2kkepgaeyEa');

// Constants for CP-Swap
const AMM_CONFIG_SEED = Buffer.from('amm_config');
const POOL_SEED = Buffer.from('pool');
const POOL_VAULT_SEED = Buffer.from('pool_vault');
const POOL_LP_MINT_SEED = Buffer.from('pool_lp_mint');
const POOL_OBSERVATION_SEED = Buffer.from('observation');

async function finalPoolSetup() {
  console.log('Final CP-Swap pool setup...\n');

  // Load token configuration
  const tokenConfig = JSON.parse(fs.readFileSync(TOKEN_CONFIG_FILE, 'utf8'));
  const usdcMint = new PublicKey(tokenConfig.usdcMint);
  const wsolMint = new PublicKey(tokenConfig.wsolMint);

  // Load payer keypair
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/home/ubuntu/.config/solana/id.json', 'utf8')))
  );
  console.log('Payer:', payerKeypair.publicKey.toBase58());

  // Sort tokens
  let token0Mint: PublicKey;
  let token1Mint: PublicKey;
  let token0Decimals: number;
  let token1Decimals: number;
  if (usdcMint.toBuffer().compare(wsolMint.toBuffer()) < 0) {
    token0Mint = usdcMint;
    token1Mint = wsolMint;
    token0Decimals = tokenConfig.decimals.usdc;
    token1Decimals = tokenConfig.decimals.wsol;
    console.log('Token ordering: USDC is token0, WSOL is token1');
  } else {
    token0Mint = wsolMint;
    token1Mint = usdcMint;
    token0Decimals = tokenConfig.decimals.wsol;
    token1Decimals = tokenConfig.decimals.usdc;
    console.log('Token ordering: WSOL is token0, USDC is token1');
  }

  // Look for an existing valid AMM config
  console.log('\nSearching for valid AMM configs...');
  let ammConfig: PublicKey | null = null;
  let ammConfigIndex = -1;
  
  // Check indices 0-20
  for (let i = 0; i <= 20; i++) {
    const [testConfig] = PublicKey.findProgramAddressSync(
      [AMM_CONFIG_SEED, new BN(i).toArrayLike(Buffer, 'le', 2)],
      CP_SWAP_PROGRAM_ID
    );
    
    const accountInfo = await connection.getAccountInfo(testConfig);
    if (accountInfo && accountInfo.data.length >= 64) {
      console.log(`Found existing AMM config at index ${i}:`, testConfig.toBase58());
      console.log('Data length:', accountInfo.data.length);
      ammConfig = testConfig;
      ammConfigIndex = i;
      break;
    }
  }

  // If no valid config found, we need to figure out why creation is failing
  if (!ammConfig) {
    console.log('\nNo valid AMM config found. The issue might be:');
    console.log('1. The program expects a specific admin/owner to create configs');
    console.log('2. The AMM config seeds calculation might be different');
    console.log('3. There might be a deployment issue with the CP-Swap program');
    
    // Let's try using the same approach as the mock pool with a predefined config
    console.log('\nUsing a mock AMM config approach...');
    ammConfigIndex = 0;
    ammConfig = new PublicKey('5XoBUe5w3xSjRMgaPSwyA2ujH7eBBH5nD5L9H2ws841B');
  }

  // Derive pool PDA
  const [poolId] = PublicKey.findProgramAddressSync(
    [POOL_SEED, ammConfig.toBuffer(), token0Mint.toBuffer(), token1Mint.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );
  console.log('\nPool PDA:', poolId.toBase58());

  // Check if pool exists
  const poolAccount = await connection.getAccountInfo(poolId);
  if (poolAccount && poolAccount.data.length > 100) {
    console.log('Pool already exists with data length:', poolAccount.data.length);
    
    // Save the existing pool config
    const [token0Vault] = PublicKey.findProgramAddressSync(
      [POOL_VAULT_SEED, poolId.toBuffer(), token0Mint.toBuffer()],
      CP_SWAP_PROGRAM_ID
    );
    const [token1Vault] = PublicKey.findProgramAddressSync(
      [POOL_VAULT_SEED, poolId.toBuffer(), token1Mint.toBuffer()],
      CP_SWAP_PROGRAM_ID
    );
    const [lpMint] = PublicKey.findProgramAddressSync(
      [POOL_LP_MINT_SEED, poolId.toBuffer()],
      CP_SWAP_PROGRAM_ID
    );
    const [observationState] = PublicKey.findProgramAddressSync(
      [POOL_OBSERVATION_SEED, poolId.toBuffer()],
      CP_SWAP_PROGRAM_ID
    );
    const [cpPoolAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('cp_pool_authority'), poolId.toBuffer()],
      CONTINUUM_PROGRAM_ID
    );
    
    const poolConfig = {
      poolId: poolId.toBase58(),
      ammConfig: ammConfig.toBase58(),
      ammConfigIndex: ammConfigIndex,
      tokenAMint: token0Mint.toBase58(),
      tokenBMint: token1Mint.toBase58(),
      tokenAVault: token0Vault.toBase58(),
      tokenBVault: token1Vault.toBase58(),
      lpMint: lpMint.toBase58(),
      observationState: observationState.toBase58(),
      cpPoolAuthority: cpPoolAuthority.toBase58(),
      status: 'existing'
    };
    
    fs.writeFileSync(POOL_CONFIG_FILE, JSON.stringify(poolConfig, null, 2));
    console.log('\nExisting pool configuration saved to:', POOL_CONFIG_FILE);
    console.log('\n✅ Using existing pool!');
    
    return;
  }

  console.log('\nPool does not exist or is invalid.');
  console.log('\nRecommendation:');
  console.log('1. The AMM config issue needs to be resolved first');
  console.log('2. Check if the deployed CP-Swap program matches the expected version');
  console.log('3. Consider using the mock pool approach for testing the CPI flow');
  
  // For now, let's save a config that uses the mock approach
  const mockPoolConfig = {
    poolId: 'MOCK_POOL_ID',
    ammConfig: ammConfig.toBase58(),
    status: 'mock',
    note: 'Using mock pool due to AMM config initialization issues',
    tokenAMint: token0Mint.toBase58(),
    tokenBMint: token1Mint.toBase58()
  };
  
  fs.writeFileSync(POOL_CONFIG_FILE, JSON.stringify(mockPoolConfig, null, 2));
  console.log('\nMock pool configuration saved to:', POOL_CONFIG_FILE);
}

// Run if called directly
if (require.main === module) {
  finalPoolSetup()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}

export { finalPoolSetup };