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
const connection = new Connection('http://localhost:8899', 'confirmed');

// Program IDs
const CONTINUUM_PROGRAM_ID = new PublicKey('EaeWUSam5Li1fzCcCs33oE4jCLQT4F6RJXgrPYZaoKqq');
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

// Known accounts from deployed program
const AMM_CONFIG = new PublicKey('5XoBUe5w3xSjRMgaPSwyA2ujH7eBBH5nD5L9H2ws841B');
const POOL_ID = new PublicKey('Gdpa1W2qH8Q5XxXmt5pm3VNwcYdgtAzT7GfFNxpLu683');

// Correct discriminators from deployed program
const DISCRIMINATORS = {
  amm_config: [218, 244, 33, 104, 203, 203, 43, 111],
  pool: [247, 237, 227, 245, 215, 195, 222, 70],
  swap_base_input: [143, 190, 90, 218, 196, 30, 51, 222] // This might be correct already
};

async function testWithCorrectDiscriminators() {
  console.log('Testing with correct discriminators from deployed program...\n');

  // Load token configuration
  const tokenConfig = JSON.parse(fs.readFileSync(TOKEN_CONFIG_FILE, 'utf8'));
  const usdcMint = new PublicKey(tokenConfig.usdcMint);
  const wsolMint = new PublicKey(tokenConfig.wsolMint);

  // Load payer keypair
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/home/ubuntu/.config/solana/id.json', 'utf8')))
  );
  console.log('Payer:', payerKeypair.publicKey.toBase58());

  // Get user token accounts
  const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, payerKeypair.publicKey);
  const userWsolAccount = await getAssociatedTokenAddress(wsolMint, payerKeypair.publicKey);

  // Check balances
  console.log('\nChecking token balances...');
  try {
    const usdcAccount = await getAccount(connection, userUsdcAccount);
    const wsolAccount = await getAccount(connection, userWsolAccount);
    console.log('USDC balance:', Number(usdcAccount.amount) / 1e6);
    console.log('WSOL balance:', Number(wsolAccount.amount) / 1e9);
  } catch (e) {
    console.log('Error getting balances:', e.message);
  }

  // Derive PDAs
  const [fifoState] = PublicKey.findProgramAddressSync(
    [Buffer.from('fifo_state')],
    CONTINUUM_PROGRAM_ID
  );

  const [poolAuthority, poolAuthorityBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('cp_pool_authority'), POOL_ID.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );

  console.log('\nDerived accounts:');
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

  // First, let's try a direct swap on CP-Swap to verify the pool works
  console.log('\nTesting direct swap on CP-Swap pool...');
  
  // Get pool vaults and other accounts
  const poolAccount = await connection.getAccountInfo(POOL_ID);
  if (!poolAccount) {
    console.error('Pool account not found!');
    return;
  }

  // Parse pool data to get vault addresses
  // For now, let's derive them using the standard seeds
  const [token0Vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_vault'), POOL_ID.toBuffer(), wsolMint.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );
  const [token1Vault] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_vault'), POOL_ID.toBuffer(), usdcMint.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );
  const [observationState] = PublicKey.findProgramAddressSync(
    [Buffer.from('observation'), POOL_ID.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );

  console.log('\nPool accounts:');
  console.log('Token0 Vault (WSOL):', token0Vault.toBase58());
  console.log('Token1 Vault (USDC):', token1Vault.toBase58());
  console.log('Observation State:', observationState.toBase58());

  // Now test swap through Continuum
  console.log('\nExecuting swap_immediate through Continuum...');
  
  const amountIn = new BN(100 * 10 ** tokenConfig.decimals.usdc); // 100 USDC
  const minAmountOut = new BN(0); // Accept any amount for testing
  
  const swapIx = buildSwapImmediateInstruction(
    CONTINUUM_PROGRAM_ID,
    fifoState,
    CP_SWAP_PROGRAM_ID,
    poolAuthority,
    POOL_ID,
    AMM_CONFIG,
    observationState,
    userUsdcAccount,
    userWsolAccount,
    token1Vault, // USDC vault (input)
    token0Vault, // WSOL vault (output)
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
    const swapSig = await sendAndConfirmTransaction(connection, swapTx, [payerKeypair], {
      skipPreflight: false,
      commitment: 'confirmed'
    });
    console.log('✅ Swap executed successfully!');
    console.log('Transaction:', swapSig);
    
    // Check final balances
    console.log('\nFinal token balances:');
    const finalUsdcAccount = await getAccount(connection, userUsdcAccount);
    const finalWsolAccount = await getAccount(connection, userWsolAccount);
    console.log('USDC balance:', Number(finalUsdcAccount.amount) / 1e6);
    console.log('WSOL balance:', Number(finalWsolAccount.amount) / 1e9);
    
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
      { pubkey: user, isSigner: true, isWritable: false }, // payer (actual signer)
      
      // Remaining accounts for CP-Swap swap_base_input instruction
      { pubkey: poolAuthority, isSigner: false, isWritable: false }, // payer (pool authority signs via CPI)
      { pubkey: cpSwapAuthority, isSigner: false, isWritable: false }, // authority
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
  testWithCorrectDiscriminators()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}

export { testWithCorrectDiscriminators };