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

// Configuration
const TOKEN_CONFIG_FILE = path.join(__dirname, '../config/tokens.json');
const CP_POOL_CONFIG_FILE = path.join(__dirname, '../config/pool-final.json');
const connection = new Connection('http://localhost:8899', 'confirmed');

// Program IDs
const CONTINUUM_PROGRAM_ID = new PublicKey('EaeWUSam5Li1fzCcCs33oE4jCLQT4F6RJXgrPYZaoKqq');
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

async function testSwapWithConfig4() {
  console.log('Testing swap_immediate with config4.json pool...\n');

  // Load configurations
  const tokenConfig = JSON.parse(fs.readFileSync(TOKEN_CONFIG_FILE, 'utf8'));
  const cpPoolConfig = JSON.parse(fs.readFileSync(CP_POOL_CONFIG_FILE, 'utf8'));

  // Load payer keypair
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/home/ubuntu/.config/solana/id.json', 'utf8')))
  );
  console.log('Payer:', payerKeypair.publicKey.toBase58());

  // Pool and token information
  const poolId = new PublicKey(cpPoolConfig.poolId);
  const ammConfig = new PublicKey(cpPoolConfig.ammConfig);
  const tokenAVault = new PublicKey(cpPoolConfig.tokenAVault);
  const tokenBVault = new PublicKey(cpPoolConfig.tokenBVault);
  const observationState = new PublicKey(cpPoolConfig.observationState);

  // Token mints
  const usdcMint = new PublicKey(tokenConfig.usdcMint);
  const wsolMint = new PublicKey(tokenConfig.wsolMint);

  // Get user token accounts
  const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, payerKeypair.publicKey);
  const userWsolAccount = await getAssociatedTokenAddress(wsolMint, payerKeypair.publicKey);

  // Check balances
  console.log('\nChecking token balances...');
  const usdcBalance = await connection.getTokenAccountBalance(userUsdcAccount);
  const wsolBalance = await connection.getTokenAccountBalance(userWsolAccount);
  console.log('USDC balance:', usdcBalance.value.uiAmount);
  console.log('WSOL balance:', wsolBalance.value.uiAmount);
  
  // Check which token is token0 and token1
  const tokenAMint = new PublicKey(cpPoolConfig.tokenAMint);
  const tokenBMint = new PublicKey(cpPoolConfig.tokenBMint);
  console.log('\nPool token configuration:');
  console.log('Token A (token0):', tokenAMint.equals(wsolMint) ? 'WSOL' : 'USDC');
  console.log('Token B (token1):', tokenBMint.equals(usdcMint) ? 'USDC' : 'WSOL');

  // Derive PDAs
  const [fifoState] = PublicKey.findProgramAddressSync(
    [Buffer.from('fifo_state')],
    CONTINUUM_PROGRAM_ID
  );

  const [poolAuthority, poolAuthorityBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('cp_pool_authority'), poolId.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );

  console.log('\nPool configuration:');
  console.log('Pool ID:', poolId.toBase58());
  console.log('AMM Config:', ammConfig.toBase58());
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
  // We'll swap USDC for WSOL (token1 -> token0)
  console.log('\nExecuting swap_immediate to swap 100 USDC for WSOL...');
  
  const amountIn = new BN(100 * 10 ** tokenConfig.decimals.usdc); // 100 USDC
  const minAmountOut = new BN(0); // Accept any amount for testing
  
  // Since WSOL is token0 and USDC is token1, we're swapping token1 -> token0
  const inputVault = tokenBVault; // USDC vault (token1)
  const outputVault = tokenAVault; // WSOL vault (token0)
  
  // Build swap_immediate instruction with all required CP-Swap accounts
  const swapIx = buildSwapImmediateInstruction(
    CONTINUUM_PROGRAM_ID,
    fifoState,
    CP_SWAP_PROGRAM_ID,
    poolAuthority,
    poolId,
    ammConfig,
    observationState,
    userUsdcAccount, // source account
    userWsolAccount, // dest account
    inputVault,
    outputVault,
    usdcMint,
    wsolMint,
    payerKeypair.publicKey,
    amountIn,
    minAmountOut,
    true, // is_base_input
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
    
    console.log('\n✅ Swap with config4 pool test complete!');
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

// Helper function to build swap_immediate instruction with CP-Swap accounts
function buildSwapImmediateInstruction(
  programId: PublicKey,
  fifoState: PublicKey,
  cpSwapProgram: PublicKey,
  poolAuthority: PublicKey,
  poolId: PublicKey,
  ammConfig: PublicKey,
  observationState: PublicKey,
  userSourceToken: PublicKey,
  userDestToken: PublicKey,
  inputVault: PublicKey,
  outputVault: PublicKey,
  sourceMint: PublicKey,
  destMint: PublicKey,
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

  return new anchor.web3.TransactionInstruction({
    keys: [
      // Required accounts for Continuum
      { pubkey: fifoState, isSigner: false, isWritable: true },
      { pubkey: cpSwapProgram, isSigner: false, isWritable: false },
      { pubkey: user, isSigner: true, isWritable: false }, // payer (actual signer)
      
      // Remaining accounts for CP-Swap swap_base_input instruction
      // Order matters! Must match CP-Swap's expected account order
      // First account is pool authority (signer from Continuum's perspective)
      { pubkey: poolAuthority, isSigner: false, isWritable: false }, // payer (pool authority signs via CPI)
      
      // Derive and add CP-Swap's authority PDA
      { pubkey: PublicKey.findProgramAddressSync([Buffer.from('vault_and_lp_mint_auth_seed')], cpSwapProgram)[0], isSigner: false, isWritable: false }, // authority
      { pubkey: ammConfig, isSigner: false, isWritable: false }, // amm_config
      { pubkey: poolId, isSigner: false, isWritable: true }, // pool_state
      { pubkey: userSourceToken, isSigner: false, isWritable: true }, // user_input_token
      { pubkey: userDestToken, isSigner: false, isWritable: true }, // user_output_token
      { pubkey: inputVault, isSigner: false, isWritable: true }, // input_vault
      { pubkey: outputVault, isSigner: false, isWritable: true }, // output_vault
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // input_token_program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // output_token_program
      { pubkey: sourceMint, isSigner: false, isWritable: false }, // input_token_mint
      { pubkey: destMint, isSigner: false, isWritable: false }, // output_token_mint
      { pubkey: observationState, isSigner: false, isWritable: true }, // observation_state
    ],
    programId,
    data,
  });
}

// Run if called directly
if (require.main === module) {
  testSwapWithConfig4()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}

export { testSwapWithConfig4 };