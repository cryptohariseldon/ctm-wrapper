#!/usr/bin/env ts-node
import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount } from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';

const connection = new Connection('http://localhost:8899', 'confirmed');

// Known accounts
const POOL_ID = new PublicKey('Gdpa1W2qH8Q5XxXmt5pm3VNwcYdgtAzT7GfFNxpLu683');
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

async function checkPoolState() {
  console.log('Checking pool state...\n');
  
  // Check pool account
  const poolAccount = await connection.getAccountInfo(POOL_ID);
  if (!poolAccount) {
    console.error('Pool account not found!');
    return;
  }
  
  console.log('Pool Account:');
  console.log('Owner:', poolAccount.owner.toBase58());
  console.log('Length:', poolAccount.data.length);
  console.log('Lamports:', poolAccount.lamports);
  
  // Parse pool data
  const data = poolAccount.data;
  let offset = 8; // Skip discriminator
  
  // Try to parse key fields
  console.log('\nPool Data (parsed):');
  
  // amm_config: Pubkey (32 bytes)
  const ammConfig = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('AMM Config:', ammConfig.toBase58());
  
  // pool_creator: Pubkey (32 bytes)
  const poolCreator = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('Pool Creator:', poolCreator.toBase58());
  
  // token_0_vault: Pubkey (32 bytes)
  const token0Vault = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('Token 0 Vault:', token0Vault.toBase58());
  
  // token_1_vault: Pubkey (32 bytes)
  const token1Vault = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('Token 1 Vault:', token1Vault.toBase58());
  
  // lp_mint: Pubkey (32 bytes)
  const lpMint = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('LP Mint:', lpMint.toBase58());
  
  // token_0_mint: Pubkey (32 bytes)
  const token0Mint = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('Token 0 Mint:', token0Mint.toBase58());
  
  // token_1_mint: Pubkey (32 bytes)
  const token1Mint = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log('Token 1 Mint:', token1Mint.toBase58());
  
  // Check vault balances
  console.log('\nChecking vault balances...');
  try {
    const vault0Account = await getAccount(connection, token0Vault);
    console.log('Token 0 Vault balance:', vault0Account.amount.toString());
    
    const vault1Account = await getAccount(connection, token1Vault);
    console.log('Token 1 Vault balance:', vault1Account.amount.toString());
  } catch (e) {
    console.log('Error checking vault balances:', e.message);
  }
  
  // Check if this matches our expected pool
  console.log('\nExpected values:');
  console.log('Expected pool:', POOL_ID.toBase58());
  console.log('AMM Config match:', ammConfig.toBase58() === '5XoBUe5w3xSjRMgaPSwyA2ujH7eBBH5nD5L9H2ws841B');
}

if (require.main === module) {
  checkPoolState()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}