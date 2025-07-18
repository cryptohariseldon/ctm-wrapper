#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

const connection = new Connection('http://localhost:8899', 'confirmed');
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

// Known accounts
const AMM_CONFIG = new PublicKey('5XoBUe5w3xSjRMgaPSwyA2ujH7eBBH5nD5L9H2ws841B');
const POOL_ID = new PublicKey('Gdpa1W2qH8Q5XxXmt5pm3VNwcYdgtAzT7GfFNxpLu683');

async function testDirectSwap() {
  console.log('Testing direct swap on CP-Swap (bypassing Continuum)...\n');

  // Load payer keypair
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/home/ubuntu/.config/solana/id.json', 'utf8')))
  );
  console.log('Payer:', payerKeypair.publicKey.toBase58());

  // Token mints from pool data
  const wsolMint = new PublicKey('8m4ZtQeeqE1WriuW5raCcVQujS1zVGTFwDHFzjeRZ4qP');
  const usdcMint = new PublicKey('GsWKsvHYWVfWa1rKTdMKm2HJorcAg3gLRVRepsJPHva7');
  
  // Vaults from pool data
  const token0Vault = new PublicKey('XCnXQgicrRgDYtxEQHRKBa2atSJcUKGixRtjn7SpAZ1');
  const token1Vault = new PublicKey('ALTDncmg2rbcYg43GZWtRPSvbUjdLpWxhhMW5XQwnLK8');
  
  // Get user token accounts
  const userWsolAccount = await getAssociatedTokenAddress(wsolMint, payerKeypair.publicKey);
  const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, payerKeypair.publicKey);

  // Check balances
  console.log('\nChecking balances...');
  const wsolBalance = await getAccount(connection, userWsolAccount);
  const usdcBalance = await getAccount(connection, userUsdcAccount);
  console.log('WSOL balance:', Number(wsolBalance.amount) / 1e9);
  console.log('USDC balance:', Number(usdcBalance.amount) / 1e6);

  // Derive required PDAs
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_and_lp_mint_auth_seed')],
    CP_SWAP_PROGRAM_ID
  );
  
  const [observationState] = PublicKey.findProgramAddressSync(
    [Buffer.from('observation'), POOL_ID.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );

  console.log('\nDerived accounts:');
  console.log('Authority:', authority.toBase58());
  console.log('Observation State:', observationState.toBase58());

  // Build swap instruction manually
  console.log('\nBuilding swap instruction...');
  
  // swap_base_input discriminator
  const discriminator = Buffer.from([143, 190, 90, 218, 196, 30, 51, 222]);
  
  // Swap 100 USDC for WSOL
  const amountIn = new BN(100 * 1e6); // 100 USDC
  const minAmountOut = new BN(0); // Accept any amount
  
  const data = Buffer.concat([
    discriminator,
    amountIn.toArrayLike(Buffer, 'le', 8),
    minAmountOut.toArrayLike(Buffer, 'le', 8),
  ]);

  const swapIx = new anchor.web3.TransactionInstruction({
    keys: [
      { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: false }, // payer
      { pubkey: authority, isSigner: false, isWritable: false }, // authority
      { pubkey: AMM_CONFIG, isSigner: false, isWritable: false }, // amm_config
      { pubkey: POOL_ID, isSigner: false, isWritable: true }, // pool_state
      { pubkey: userUsdcAccount, isSigner: false, isWritable: true }, // input_token_account
      { pubkey: userWsolAccount, isSigner: false, isWritable: true }, // output_token_account
      { pubkey: token1Vault, isSigner: false, isWritable: true }, // input_vault (USDC)
      { pubkey: token0Vault, isSigner: false, isWritable: true }, // output_vault (WSOL)
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // input_token_program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // output_token_program
      { pubkey: usdcMint, isSigner: false, isWritable: false }, // input_token_mint
      { pubkey: wsolMint, isSigner: false, isWritable: false }, // output_token_mint
      { pubkey: observationState, isSigner: false, isWritable: true }, // observation_state
    ],
    programId: CP_SWAP_PROGRAM_ID,
    data,
  });

  const tx = new Transaction().add(swapIx);
  
  try {
    console.log('\nExecuting swap...');
    const sig = await sendAndConfirmTransaction(connection, tx, [payerKeypair], {
      skipPreflight: false,
      commitment: 'confirmed'
    });
    
    console.log('✅ Swap successful!');
    console.log('Transaction:', sig);
    
    // Check final balances
    console.log('\nFinal balances:');
    const finalWsolBalance = await getAccount(connection, userWsolAccount);
    const finalUsdcBalance = await getAccount(connection, userUsdcAccount);
    console.log('WSOL balance:', Number(finalWsolBalance.amount) / 1e9);
    console.log('USDC balance:', Number(finalUsdcBalance.amount) / 1e6);
    
    const wsolReceived = (Number(finalWsolBalance.amount) - Number(wsolBalance.amount)) / 1e9;
    const usdcSpent = (Number(usdcBalance.amount) - Number(finalUsdcBalance.amount)) / 1e6;
    
    console.log('\nSwap summary:');
    console.log(`Spent: ${usdcSpent} USDC`);
    console.log(`Received: ${wsolReceived} WSOL`);
    console.log(`Rate: 1 USDC = ${wsolReceived / usdcSpent} WSOL`);
    
  } catch (err) {
    console.error('Swap failed:', err);
    if (err.logs) {
      console.error('\nTransaction logs:');
      err.logs.forEach(log => console.log(log));
    }
  }
}

if (require.main === module) {
  testDirectSwap()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}