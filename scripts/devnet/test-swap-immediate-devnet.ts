#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

// Configuration - DEVNET
const TOKEN_CONFIG_FILE = path.join(__dirname, 'devnet-tokens.json');
const POOL_CONFIG_FILE = path.join(__dirname, 'devnet-pool.json');
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

// Program IDs - DEVNET
const CONTINUUM_PROGRAM_ID = new PublicKey('EaeWUSam5Li1fzCcCs33oE4jCLQT4F6RJXgrPYZaoKqq');

async function testSwapImmediate() {
  console.log('Testing swap_immediate on DEVNET...\n');

  // Load configurations
  const tokenConfig = JSON.parse(fs.readFileSync(TOKEN_CONFIG_FILE, 'utf8'));
  const poolConfig = JSON.parse(fs.readFileSync(POOL_CONFIG_FILE, 'utf8'));

  // Load payer keypair
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/home/ubuntu/.config/solana/id.json', 'utf8')))
  );
  console.log('Payer:', payerKeypair.publicKey.toBase58());

  // Token mints and pool
  const usdcMint = new PublicKey(tokenConfig.usdcMint);
  const wsolMint = new PublicKey(tokenConfig.wsolMint);
  const poolId = new PublicKey(poolConfig.poolId);
  const cpSwapProgram = new PublicKey(poolConfig.cpSwapProgramId);

  // Get user token accounts
  const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, payerKeypair.publicKey);
  const userWsolAccount = await getAssociatedTokenAddress(wsolMint, payerKeypair.publicKey);

  // Check balances
  console.log('\nChecking token balances...');
  const usdcBalance = await connection.getTokenAccountBalance(userUsdcAccount);
  const wsolBalance = await connection.getTokenAccountBalance(userWsolAccount);
  console.log('USDC balance:', usdcBalance.value.uiAmount);
  console.log('WSOL balance:', wsolBalance.value.uiAmount);

  // Derive PDAs
  const [fifoState] = PublicKey.findProgramAddressSync(
    [Buffer.from('fifo_state')],
    CONTINUUM_PROGRAM_ID
  );

  const [poolAuthority, poolAuthorityBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('cp_pool_authority'), poolId.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );

  console.log('\nPDAs:');
  console.log('FIFO State:', fifoState.toBase58());
  console.log('Pool Authority:', poolAuthority.toBase58());
  console.log('Pool Authority Bump:', poolAuthorityBump);

  // Initialize FIFO state if needed
  try {
    const fifoAccount = await connection.getAccountInfo(fifoState);
    if (!fifoAccount) {
      console.log('\nInitializing FIFO state...');
      const initIx = buildInitializeInstruction(
        CONTINUUM_PROGRAM_ID,
        fifoState,
        payerKeypair.publicKey
      );
      const tx = new Transaction().add(initIx);
      await sendAndConfirmTransaction(connection, tx, [payerKeypair]);
      console.log('FIFO state initialized');
    }
  } catch (err) {
    console.log('FIFO state exists or error:', err.message);
  }

  // Execute swap_immediate
  console.log('\nExecuting swap_immediate to swap 100 USDC for WSOL...');
  
  const amountIn = new BN(100 * 10 ** 6); // 100 USDC (6 decimals)
  const minAmountOut = new BN(0.09 * 10 ** 9); // At least 0.09 WSOL (9 decimals)
  
  // Build swap_immediate instruction
  const swapIx = buildSwapImmediateInstruction(
    CONTINUUM_PROGRAM_ID,
    fifoState,
    cpSwapProgram,
    poolAuthority,
    poolId,
    userUsdcAccount,
    userWsolAccount,
    new PublicKey(poolConfig.tokenAVault),
    new PublicKey(poolConfig.tokenBVault),
    new PublicKey(poolConfig.ammConfig),
    new PublicKey(poolConfig.observationState),
    usdcMint,
    wsolMint,
    payerKeypair.publicKey,
    amountIn,
    minAmountOut,
    true, // is_base_input (USDC is base)
    poolAuthorityBump
  );

  const swapTx = new Transaction().add(swapIx);
  
  try {
    const swapSig = await sendAndConfirmTransaction(connection, swapTx, [payerKeypair]);
    console.log('Swap executed:', swapSig);
    
    // Check final balances
    console.log('\nFinal token balances:');
    const finalUsdcBalance = await connection.getTokenAccountBalance(userUsdcAccount);
    const finalWsolBalance = await connection.getTokenAccountBalance(userWsolAccount);
    console.log('USDC balance:', finalUsdcBalance.value.uiAmount);
    console.log('WSOL balance:', finalWsolBalance.value.uiAmount);
    
    // Calculate amounts
    const usdcSpent = usdcBalance.value.uiAmount - finalUsdcBalance.value.uiAmount;
    const wsolReceived = finalWsolBalance.value.uiAmount - wsolBalance.value.uiAmount;
    console.log('\nSwap summary:');
    console.log(`Spent: ${usdcSpent} USDC`);
    console.log(`Received: ${wsolReceived.toFixed(6)} WSOL`);
    console.log(`Rate: 1 WSOL = ${(usdcSpent / wsolReceived).toFixed(4)} USDC`);
    
    console.log('\n✅ Swap immediate test complete!');
  } catch (err) {
    console.error('Swap failed:', err);
    if (err.logs) {
      console.error('Transaction logs:', err.logs);
    }
  }
}

// Helper function to build initialize instruction
function buildInitializeInstruction(
  programId: PublicKey,
  fifoState: PublicKey,
  admin: PublicKey
): anchor.web3.TransactionInstruction {
  const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);
  
  return new anchor.web3.TransactionInstruction({
    keys: [
      { pubkey: fifoState, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data: discriminator,
  });
}

// Helper function to build swap_immediate instruction
function buildSwapImmediateInstruction(
  programId: PublicKey,
  fifoState: PublicKey,
  cpSwapProgram: PublicKey,
  poolAuthority: PublicKey,
  poolId: PublicKey,
  userSourceToken: PublicKey,
  userDestToken: PublicKey,
  tokenAVault: PublicKey,
  tokenBVault: PublicKey,
  ammConfig: PublicKey,
  observationState: PublicKey,
  usdcMint: PublicKey,
  wsolMint: PublicKey,
  user: PublicKey,
  amountIn: BN,
  minAmountOut: BN,
  isBaseInput: boolean,
  poolAuthorityBump: number
): anchor.web3.TransactionInstruction {
  // swap_immediate discriminator from IDL
  const discriminator = Buffer.from([175, 131, 44, 121, 171, 170, 38, 18]);
  
  const data = Buffer.concat([
    discriminator,
    amountIn.toArrayLike(Buffer, 'le', 8),
    minAmountOut.toArrayLike(Buffer, 'le', 8),
    Buffer.from([isBaseInput ? 1 : 0]),
    poolId.toBuffer(),
    Buffer.from([poolAuthorityBump]),
  ]);

  // Derive CP-Swap's authority PDA
  const [cpSwapAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_and_lp_mint_auth_seed')],
    cpSwapProgram
  );

  return new anchor.web3.TransactionInstruction({
    keys: [
      // Required accounts for Continuum
      { pubkey: fifoState, isSigner: false, isWritable: true },
      { pubkey: cpSwapProgram, isSigner: false, isWritable: false },
      
      // Remaining accounts for CP-Swap CPI - user must be first
      { pubkey: user, isSigner: true, isWritable: false }, // User (payer for CP-Swap)
      { pubkey: cpSwapAuthority, isSigner: false, isWritable: false }, // CP-Swap vault authority
      { pubkey: ammConfig, isSigner: false, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: userSourceToken, isSigner: false, isWritable: true },
      { pubkey: userDestToken, isSigner: false, isWritable: true },
      { pubkey: tokenAVault, isSigner: false, isWritable: true }, // tokenA vault
      { pubkey: tokenBVault, isSigner: false, isWritable: true }, // tokenB vault
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: wsolMint, isSigner: false, isWritable: false },
      { pubkey: observationState, isSigner: false, isWritable: true },
    ],
    programId,
    data,
  });
}

// Run if called directly
if (require.main === module) {
  testSwapImmediate()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}

export { testSwapImmediate };