#!/usr/bin/env npx ts-node

import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, workspace } from '@coral-xyz/anchor';
import { RaydiumCpSwap } from './raydium-cp-swap/target/types/raydium_cp_swap';
import * as fs from 'fs';
import chalk from 'chalk';

async function main() {
  // Connect to localnet
  const connection = new Connection('http://localhost:8899', 'confirmed');
  const provider = AnchorProvider.env();
  const program = workspace.RaydiumCpSwap as Program<RaydiumCpSwap>;

  // Load pool configuration
  const poolConfig = JSON.parse(fs.readFileSync('./config/cp-pool.json', 'utf-8'));
  const poolId = new PublicKey(poolConfig.poolId);

  console.log(chalk.blue('🔍 Verifying Raydium CP-Swap Pool...\n'));
  console.log(chalk.gray('Pool ID:'), poolId.toString());

  try {
    // Fetch pool state
    const poolState = await program.account.poolState.fetch(poolId);
    
    console.log(chalk.green('\n✅ Pool found on chain!\n'));
    console.log(chalk.white('Pool Details:'));
    console.log(chalk.gray('  AMM Config:'), poolState.ammConfig.toString());
    console.log(chalk.gray('  Token 0 Mint:'), poolState.token0Mint.toString());
    console.log(chalk.gray('  Token 1 Mint:'), poolState.token1Mint.toString());
    console.log(chalk.gray('  Token 0 Vault:'), poolState.token0Vault.toString());
    console.log(chalk.gray('  Token 1 Vault:'), poolState.token1Vault.toString());
    console.log(chalk.gray('  LP Mint:'), poolState.lpMint.toString());
    console.log(chalk.gray('  Authority Type:'), poolState.authorityType);
    
    if (poolState.authorityType === 1 && poolState.customAuthority) {
      console.log(chalk.gray('  Custom Authority:'), poolState.customAuthority.toString());
    }
    
    console.log(chalk.gray('\n  Status:'), poolState.status);
    console.log(chalk.gray('  LP Supply:'), poolState.lpSupply.toString());
    console.log(chalk.gray('  Protocol Fees Token 0:'), poolState.protocolFeesToken0.toString());
    console.log(chalk.gray('  Protocol Fees Token 1:'), poolState.protocolFeesToken1.toString());
    console.log(chalk.gray('  Fund Fees Token 0:'), poolState.fundFeesToken0.toString());
    console.log(chalk.gray('  Fund Fees Token 1:'), poolState.fundFeesToken1.toString());
    
    console.log(chalk.green('\n🎉 Pool is properly initialized and ready for use!'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Error fetching pool:'), error);
    console.log(chalk.yellow('\nPool may not exist. You need to create it first.'));
  }
}

main().catch(console.error);