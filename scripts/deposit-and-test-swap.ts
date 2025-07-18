#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction, 
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount
} from '@solana/spl-token';
import { Program, AnchorProvider, BN, Wallet } from '@coral-xyz/anchor';
import { RaydiumCpSwap } from '../raydium-cp-swap/target/types/raydium_cp_swap';
import fs from 'fs';
import path from 'path';

// Configuration
const POOL_CONFIG_FILE = path.join(__dirname, '../config/cp-pool-new.json');
const TOKEN_CONFIG_FILE = path.join(__dirname, '../config/tokens.json');

async function depositAndTestSwap() {
  console.log('🚀 Testing CP-Swap pool deposits and swaps...\n');

  // Setup connection and wallet
  const connection = new Connection('http://localhost:8899', 'confirmed');
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/home/ubuntu/.config/solana/id.json', 'utf8')))
  );
  
  const wallet = new Wallet(payerKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  
  // Load the program IDL and create program instance
  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, '../raydium-cp-swap/target/idl/raydium_cp_swap.json'), 'utf8'));
  const programId = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');
  const program = new Program<RaydiumCpSwap>(idl, programId, provider);

  // Load configurations
  const poolConfig = JSON.parse(fs.readFileSync(POOL_CONFIG_FILE, 'utf8'));
  const tokenConfig = JSON.parse(fs.readFileSync(TOKEN_CONFIG_FILE, 'utf8'));

  const poolId = new PublicKey(poolConfig.poolId);
  const token0Mint = new PublicKey(poolConfig.tokenAMint);
  const token1Mint = new PublicKey(poolConfig.tokenBMint);
  const token0Vault = new PublicKey(poolConfig.tokenAVault);
  const token1Vault = new PublicKey(poolConfig.tokenBVault);
  const lpMint = new PublicKey(poolConfig.lpMint);
  const ammConfig = new PublicKey(poolConfig.ammConfig);

  console.log('Pool ID:', poolId.toBase58());
  console.log('Token0:', token0Mint.toBase58());
  console.log('Token1:', token1Mint.toBase58());

  // Get user token accounts
  const userToken0 = await getAssociatedTokenAddress(token0Mint, payerKeypair.publicKey);
  const userToken1 = await getAssociatedTokenAddress(token1Mint, payerKeypair.publicKey);
  const userLp = await getAssociatedTokenAddress(lpMint, payerKeypair.publicKey);

  // Derive authority
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_and_lp_mint_auth_seed')],
    program.programId
  );

  // Step 1: Check current pool state
  console.log('\n📊 Checking pool state...');
  const poolState = await program.account.poolState.fetch(poolId);
  console.log('LP Supply:', poolState.lpSupply.toString());
  console.log('Status:', poolState.status);

  // Check vault balances
  const vault0Balance = await getAccount(connection, token0Vault);
  const vault1Balance = await getAccount(connection, token1Vault);
  console.log('Vault0 (USDC) balance:', Number(vault0Balance.amount) / 1e6);
  console.log('Vault1 (WSOL) balance:', Number(vault1Balance.amount) / 1e9);

  // Check user balances
  const user0Balance = await getAccount(connection, userToken0);
  const user1Balance = await getAccount(connection, userToken1);
  const userLpBalance = await getAccount(connection, userLp);
  console.log('\nUser USDC balance:', Number(user0Balance.amount) / 1e6);
  console.log('User WSOL balance:', Number(user1Balance.amount) / 1e9);
  console.log('User LP balance:', Number(userLpBalance.amount) / 1e9);

  // Step 2: Deposit more liquidity
  console.log('\n💰 Depositing additional liquidity...');
  const depositAmount0 = new BN(5000 * 1e6); // 5,000 USDC
  const depositAmount1 = new BN(5000 * 1e9); // 5,000 WSOL
  const minLpAmount = new BN(0); // Accept any amount of LP tokens

  try {
    await program.methods
      .deposit(minLpAmount, depositAmount0, depositAmount1)
      .accountsPartial({
        owner: payerKeypair.publicKey,
        poolState: poolId,
        ownerLpToken: userLp,
        token0Account: userToken0,
        token1Account: userToken1,
        token0Vault: token0Vault,
        token1Vault: token1Vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenProgram2022: TOKEN_PROGRAM_ID,
        vault0Mint: token0Mint,
        vault1Mint: token1Mint,
        lpMint: lpMint,
      })
      .rpc();
    
    console.log('✅ Liquidity deposited successfully!');
    
    // Check new balances
    const newUserLpBalance = await getAccount(connection, userLp);
    console.log('New LP balance:', Number(newUserLpBalance.amount) / 1e9);
  } catch (err) {
    console.error('Error depositing liquidity:', err);
  }

  // Step 3: Test a direct swap
  console.log('\n🔄 Testing direct swap on CP-Swap...');
  const swapAmount = new BN(100 * 1e6); // Swap 100 USDC for WSOL
  const minAmountOut = new BN(0); // Accept any amount (for testing)

  try {
    // Perform swap: USDC -> WSOL
    const swapTx = await program.methods
      .swapBaseInput(swapAmount, minAmountOut)
      .accountsPartial({
        payer: payerKeypair.publicKey,
        ammConfig: ammConfig,
        poolState: poolId,
        inputTokenAccount: userToken0,
        outputTokenAccount: userToken1,
        inputVault: token0Vault,
        outputVault: token1Vault,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
        inputTokenMint: token0Mint,
        outputTokenMint: token1Mint,
        observationState: new PublicKey(poolConfig.observationState),
      })
      .rpc();
    
    console.log('✅ Swap executed successfully!');
    console.log('Transaction:', swapTx);
    
    // Check balances after swap
    const afterSwap0 = await getAccount(connection, userToken0);
    const afterSwap1 = await getAccount(connection, userToken1);
    
    console.log('\nBalances after swap:');
    console.log('USDC:', Number(afterSwap0.amount) / 1e6);
    console.log('WSOL:', Number(afterSwap1.amount) / 1e9);
    
    const usdcDiff = Number(user0Balance.amount - afterSwap0.amount) / 1e6;
    const wsolDiff = Number(afterSwap1.amount - user1Balance.amount) / 1e9;
    
    console.log('\nSwap summary:');
    console.log(`Swapped ${usdcDiff} USDC for ${wsolDiff} WSOL`);
    console.log(`Exchange rate: 1 USDC = ${wsolDiff / usdcDiff} WSOL`);
    
  } catch (err) {
    console.error('Error executing swap:', err);
    if (err.logs) {
      console.error('Transaction logs:', err.logs);
    }
  }

  // Step 4: Test a reverse swap
  console.log('\n🔄 Testing reverse swap (WSOL -> USDC)...');
  const reverseSwapAmount = new BN(50 * 1e9); // Swap 50 WSOL for USDC

  try {
    const reverseTx = await program.methods
      .swapBaseInput(reverseSwapAmount, minAmountOut)
      .accountsPartial({
        payer: payerKeypair.publicKey,
        ammConfig: ammConfig,
        poolState: poolId,
        inputTokenAccount: userToken1,
        outputTokenAccount: userToken0,
        inputVault: token1Vault,
        outputVault: token0Vault,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
        inputTokenMint: token1Mint,
        outputTokenMint: token0Mint,
        observationState: new PublicKey(poolConfig.observationState),
      })
      .rpc();
    
    console.log('✅ Reverse swap executed successfully!');
    
    // Final balances
    const final0 = await getAccount(connection, userToken0);
    const final1 = await getAccount(connection, userToken1);
    
    console.log('\nFinal balances:');
    console.log('USDC:', Number(final0.amount) / 1e6);
    console.log('WSOL:', Number(final1.amount) / 1e9);
    
  } catch (err) {
    console.error('Error executing reverse swap:', err);
  }

  console.log('\n✅ Direct CP-Swap testing complete!');
  console.log('\nNext steps:');
  console.log('1. Register this pool with Continuum wrapper');
  console.log('2. Test swaps through the Continuum wrapper (CPI)');
}

// Run the script
if (require.main === module) {
  depositAndTestSwap()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

export { depositAndTestSwap };