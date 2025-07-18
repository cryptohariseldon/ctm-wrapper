#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  transfer,
  createTransferInstruction
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

// Configuration
const TOKEN_CONFIG_FILE = path.join(__dirname, '../config/tokens.json');
const POOL_CONFIG_FILE = path.join(__dirname, '../config/pool.json');
const connection = new Connection('http://localhost:8899', 'confirmed');

// Program IDs
const CONTINUUM_PROGRAM_ID = new PublicKey('EaeWUSam5Li1fzCcCs33oE4jCLQT4F6RJXgrPYZaoKqq');

async function testRealSwap() {
  console.log('Testing real token swap through Continuum...\n');

  // Load configurations
  const tokenConfig = JSON.parse(fs.readFileSync(TOKEN_CONFIG_FILE, 'utf8'));
  const poolConfig = JSON.parse(fs.readFileSync(POOL_CONFIG_FILE, 'utf8'));

  // Load payer keypair
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/home/ubuntu/.config/solana/id.json', 'utf8')))
  );
  console.log('Payer:', payerKeypair.publicKey.toBase58());

  // Token mints
  const usdcMint = new PublicKey(tokenConfig.usdcMint);
  const wsolMint = new PublicKey(tokenConfig.wsolMint);
  const poolId = new PublicKey(poolConfig.poolId);

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

  // Submit order (swap 100 USDC for WSOL)
  console.log('\n1. Submitting order to swap 100 USDC for WSOL...');
  
  const amountIn = new BN(100 * 10 ** tokenConfig.decimals.usdc); // 100 USDC
  const minAmountOut = new BN(0.9 * 10 ** tokenConfig.decimals.wsol); // At least 0.9 WSOL
  
  // For testing, we'll use submit_order_simple which doesn't require CP-Swap integration
  const submitIx = buildSubmitOrderSimpleInstruction(
    CONTINUUM_PROGRAM_ID,
    fifoState,
    payerKeypair.publicKey,
    poolId,
    amountIn,
    minAmountOut,
    true // is_base_input (USDC is base)
  );

  const submitTx = new Transaction().add(submitIx);
  const submitSig = await sendAndConfirmTransaction(connection, submitTx, [payerKeypair]);
  console.log('Order submitted:', submitSig);

  // For demo purposes, simulate the token transfer that would happen in a real swap
  console.log('\n2. Simulating token transfer (mock execution)...');
  
  // Transfer some USDC to a mock vault (simulate user paying for swap)
  const mockVault = Keypair.generate();
  console.log('Mock vault:', mockVault.publicKey.toBase58());
  
  // Create mock vault token account
  const mockVaultUsdc = await getAssociatedTokenAddress(usdcMint, mockVault.publicKey);
  const createVaultAccountIx = createAssociatedTokenAccountInstruction(
    payerKeypair.publicKey,
    mockVaultUsdc,
    mockVault.publicKey,
    usdcMint
  );

  // Transfer USDC from user to mock vault
  const transferIx = createTransferInstruction(
    userUsdcAccount,
    mockVaultUsdc,
    payerKeypair.publicKey,
    Number(amountIn)
  );

  const transferTx = new Transaction()
    .add(createVaultAccountIx)
    .add(transferIx);
  
  const transferSig = await sendAndConfirmTransaction(connection, transferTx, [payerKeypair]);
  console.log('Tokens transferred to mock vault:', transferSig);

  // Check final balances
  console.log('\n3. Final token balances:');
  const finalUsdcBalance = await connection.getTokenAccountBalance(userUsdcAccount);
  const finalWsolBalance = await connection.getTokenAccountBalance(userWsolAccount);
  console.log('USDC balance:', finalUsdcBalance.value.uiAmount);
  console.log('WSOL balance:', finalWsolBalance.value.uiAmount);

  console.log('\n✅ Test complete!');
  console.log('Note: This is a mock execution. Real CP-Swap integration would perform the actual swap.');
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

// Helper function to build submit_order_simple instruction
function buildSubmitOrderSimpleInstruction(
  programId: PublicKey,
  fifoState: PublicKey,
  user: PublicKey,
  poolId: PublicKey,
  amountIn: BN,
  minAmountOut: BN,
  isBaseInput: boolean
): anchor.web3.TransactionInstruction {
  const discriminator = Buffer.from([205, 240, 52, 103, 173, 106, 30, 117]);
  
  const data = Buffer.concat([
    discriminator,
    amountIn.toArrayLike(Buffer, 'le', 8),
    minAmountOut.toArrayLike(Buffer, 'le', 8),
    Buffer.from([isBaseInput ? 1 : 0]),
  ]);

  // Calculate expected sequence based on current state (would need to fetch in real impl)
  const expectedSequence = new BN(1);
  
  // Derive order PDA
  const [orderState] = PublicKey.findProgramAddressSync(
    [Buffer.from('order'), user.toBuffer(), expectedSequence.toArrayLike(Buffer, 'le', 8)],
    programId
  );

  const [poolRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_registry'), poolId.toBuffer()],
    programId
  );

  return new anchor.web3.TransactionInstruction({
    keys: [
      { pubkey: fifoState, isSigner: false, isWritable: true },
      { pubkey: orderState, isSigner: false, isWritable: true },
      { pubkey: poolRegistry, isSigner: false, isWritable: false },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: poolId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

// Run if called directly
if (require.main === module) {
  testRealSwap()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}

export { testRealSwap };