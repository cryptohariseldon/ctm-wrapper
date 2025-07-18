#!/usr/bin/env npx ts-node
/**
 * Script 2: Create Pool (Simplified for testing)
 * Creates a mock pool configuration for testing swaps
 * 
 * Usage:
 *   ./2-create-pool-simple.ts --localnet
 *   ./2-create-pool-simple.ts --devnet
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getAccount,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';

const program = new Command();
program
  .description('Create pool configuration for testing')
  .option('--localnet', 'Use localnet')
  .option('--devnet', 'Use devnet')
  .parse(process.argv);

const options = program.opts();

const CONTINUUM_PROGRAM_ID = new PublicKey('8aDrUfRYhdK1EdXuh4MtjV71vr9a7HQ8pv4qxLqv5gu3');

async function main() {
  if (!options.localnet && !options.devnet) {
    console.error(chalk.red('Error: Please specify --localnet or --devnet'));
    process.exit(1);
  }

  const network = options.localnet ? 'localnet' : 'devnet';
  const rpcUrl = options.localnet 
    ? 'http://127.0.0.1:8899' 
    : 'https://api.devnet.solana.com';

  console.log(chalk.green(`🚀 Creating Pool Configuration on ${network}\n`));

  const connection = new Connection(rpcUrl, 'confirmed');

  // Load wallet
  const walletPath = path.join(process.env.HOME!, '.config/solana/id.json');
  const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
  console.log(chalk.cyan('💳 Wallet:'), wallet.publicKey.toString());

  // Load token info
  const tokenInfoPath = path.join(__dirname, `tokens-${network}.json`);
  if (!fs.existsSync(tokenInfoPath)) {
    console.error(chalk.red('Error: Token info not found. Run ./1-create-tokens.ts first'));
    process.exit(1);
  }

  const tokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, 'utf-8'));
  const tokenA = new PublicKey(tokenInfo.tokenA.mint);
  const tokenB = new PublicKey(tokenInfo.tokenB.mint);
  const userTokenA = new PublicKey(tokenInfo.tokenA.account);
  const userTokenB = new PublicKey(tokenInfo.tokenB.account);

  console.log(chalk.blue('📊 Token Information:'));
  console.log(chalk.gray('Token A:'), tokenA.toString());
  console.log(chalk.gray('Token B:'), tokenB.toString());

  try {
    // Check balances
    console.log(chalk.blue('\n💰 Checking balances...'));
    const balanceA = await getAccount(connection, userTokenA);
    const balanceB = await getAccount(connection, userTokenB);
    
    console.log(chalk.gray('Token A balance:'), Number(balanceA.amount) / 1e9);
    console.log(chalk.gray('Token B balance:'), Number(balanceB.amount) / 1e9);

    // Check FIFO state
    console.log(chalk.blue('\n📝 Checking Continuum FIFO state...'));
    const [fifoState] = PublicKey.findProgramAddressSync(
      [Buffer.from('fifo_state')],
      CONTINUUM_PROGRAM_ID
    );

    const fifoAccount = await connection.getAccountInfo(fifoState);
    if (!fifoAccount) {
      console.error(chalk.red('Error: FIFO state not initialized. Run ./init-fifo.ts first'));
      process.exit(1);
    }
    console.log(chalk.green('✅ FIFO state verified'));

    // Generate mock pool ID for testing
    const poolKeypair = Keypair.generate();
    const poolId = poolKeypair.publicKey;
    
    console.log(chalk.blue('\n📝 Creating test pool configuration...'));
    console.log(chalk.gray('Pool ID:'), poolId.toString());

    // Calculate Continuum pool authority
    const [poolAuthorityState] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool_authority_state'), poolId.toBuffer()],
      CONTINUUM_PROGRAM_ID
    );

    const [continuumPoolAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool_authority'), poolId.toBuffer()],
      CONTINUUM_PROGRAM_ID
    );

    console.log(chalk.gray('Continuum Authority:'), continuumPoolAuthority.toString());

    // Save pool configuration
    const poolConfig = {
      network,
      createdAt: new Date().toISOString(),
      poolId: poolId.toBase58(),
      
      // Token info
      tokenA: tokenA.toBase58(),
      tokenB: tokenB.toBase58(),
      tokenADecimals: 9,
      tokenBDecimals: 9,
      
      // Initial liquidity (mock)
      tokenAAmount: '100000',
      tokenBAmount: '100000',
      
      // Mock pool accounts (for testing)
      ammAuthority: Keypair.generate().publicKey.toBase58(),
      ammOpenOrders: Keypair.generate().publicKey.toBase58(),
      ammTargetOrders: Keypair.generate().publicKey.toBase58(),
      baseVault: Keypair.generate().publicKey.toBase58(),
      quoteVault: Keypair.generate().publicKey.toBase58(),
      marketId: Keypair.generate().publicKey.toBase58(),
      lpMint: Keypair.generate().publicKey.toBase58(),
      
      // Continuum
      continuumAuthority: continuumPoolAuthority.toBase58(),
      poolAuthorityState: poolAuthorityState.toBase58(),
      fifoState: fifoState.toBase58(),
      
      // Note
      note: 'This is a mock pool configuration for testing Continuum wrapper logic',
    };

    const configPath = path.join(__dirname, `pool-${network}.json`);
    fs.writeFileSync(configPath, JSON.stringify(poolConfig, null, 2));
    console.log(chalk.green('\n✅ Pool configuration saved to:'), configPath);

    // Summary
    console.log(chalk.green('\n🎉 Pool Configuration Created!\n'));
    console.log(chalk.white('Pool Details:'));
    console.log(chalk.gray('  Pool ID:'), poolId.toBase58());
    console.log(chalk.gray('  Continuum Authority:'), continuumPoolAuthority.toBase58());
    console.log(chalk.gray('  Token A:'), tokenA.toBase58());
    console.log(chalk.gray('  Token B:'), tokenB.toBase58());

    console.log(chalk.blue('\n📝 Next steps:'));
    console.log(chalk.white(`1. Start relayer: ./3-start-relayer.ts --${network}`));
    console.log(chalk.white(`2. Test swaps: ./4-swap-tokens.ts --${network}`));

    console.log(chalk.yellow('\n⚠️  Note:'));
    console.log(chalk.white('This is a simplified configuration for testing the Continuum wrapper.'));
    console.log(chalk.white('For production use, create a real Raydium pool.'));

  } catch (error: any) {
    console.error(chalk.red('\n❌ Error:'), error.message || error);
    process.exit(1);
  }
}

main().catch(console.error);