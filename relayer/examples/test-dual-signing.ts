#!/usr/bin/env ts-node

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram
} from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { BN } from '@coral-xyz/anchor';

const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:8085';
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const CONTINUUM_PROGRAM_ID = new PublicKey('EaeWUSam5Li1fzCcCs33oE4jCLQT4F6RJXgrPYZaoKqq');
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

async function testDualSigning() {
  console.log('🔐 Testing Dual-Signing Flow\n');
  
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Load user wallet
  const walletPath = path.join(process.env.HOME!, '.config/solana/id.json');
  const userWallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf8')))
  );
  console.log('User wallet:', userWallet.publicKey.toBase58());
  
  // Check relayer authorization
  console.log('\n🔍 Checking relayer authorization...');
  
  // Get relayer info
  const relayerInfo = await axios.get(`${RELAYER_URL}/api/v1/info`);
  const relayerPublicKey = new PublicKey(relayerInfo.data.relayerAddress);
  console.log('Relayer address:', relayerPublicKey.toBase58());
  
  // Load IDL and create program
  const idlPath = path.join(__dirname, '../../target/idl/continuum_cp_swap.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
  
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(userWallet),
    { commitment: 'confirmed' }
  );
  const program = new Program(idl, CONTINUUM_PROGRAM_ID, provider);
  
  // Check if relayer is authorized
  const [fifoState] = PublicKey.findProgramAddressSync(
    [Buffer.from('fifo_state')],
    CONTINUUM_PROGRAM_ID
  );
  
  try {
    const fifoData = await program.account.fifoState.fetch(fifoState);
    const isAuthorized = fifoData.authorizedRelayers.some(
      (r: PublicKey) => r.equals(relayerPublicKey)
    );
    
    console.log('Relayer authorized:', isAuthorized ? '✅ Yes' : '❌ No');
    
    if (!isAuthorized) {
      console.error('\n❌ Relayer is not authorized!');
      console.error('Please run: ts-node scripts/add-relayer.ts --relayer=' + relayerPublicKey.toBase58());
      process.exit(1);
    }
  } catch (error) {
    console.error('Failed to check relayer authorization:', error);
    console.error('Is the program initialized?');
    process.exit(1);
  }
  
  // Test swap with dual signing
  console.log('\n🔄 Building swap transaction...');
  
  const poolId = new PublicKey('9AJUf9ZQ2sWq93ose12BePBn4sq36cyqE98MiZraFLJT');
  const amountIn = new BN('1000000'); // 1 USDC
  const minAmountOut = new BN('0');
  const isBaseInput = true;
  
  // Get pool info
  const poolInfo = await axios.get(`${RELAYER_URL}/api/v1/pools/${poolId.toBase58()}/price`);
  const poolData = poolInfo.data;
  
  // Derive PDAs
  const [poolAuthority, poolAuthorityBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('cp_pool_authority'), poolId.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );
  
  const [cpSwapAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_and_lp_mint_auth_seed')],
    CP_SWAP_PROGRAM_ID
  );
  
  // Token accounts
  const tokenAMint = new PublicKey(poolData.tokenA.mint);
  const tokenBMint = new PublicKey(poolData.tokenB.mint);
  const userTokenA = getAssociatedTokenAddressSync(tokenAMint, userWallet.publicKey);
  const userTokenB = getAssociatedTokenAddressSync(tokenBMint, userWallet.publicKey);
  
  // Build swap instruction
  const swapIx = await program.methods
    .swapImmediate(amountIn, minAmountOut, isBaseInput, poolId, poolAuthorityBump)
    .accountsPartial({
      fifoState,
      relayer: relayerPublicKey, // RELAYER AS CO-SIGNER
      cpSwapProgram: CP_SWAP_PROGRAM_ID,
    })
    .remainingAccounts([
      { pubkey: userWallet.publicKey, isSigner: true, isWritable: false },
      { pubkey: cpSwapAuthority, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('5XoBUe5w3xSjRMgaPSwyA2ujH7eBBH5nD5L9H2ws841B'), isSigner: false, isWritable: false }, // ammConfig
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: userTokenA, isSigner: false, isWritable: true },
      { pubkey: userTokenB, isSigner: false, isWritable: true },
      { pubkey: new PublicKey('CfD5a6Wj9puCEL2QwSTS263KQjaCskVBoUc8iywbL2Rr'), isSigner: false, isWritable: true }, // vault0
      { pubkey: new PublicKey('5FeimpxVzYTuGvJmKDo9ebJcSgfQpQ1fXDLb4tC3ig5p'), isSigner: false, isWritable: true }, // vault1
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: tokenAMint, isSigner: false, isWritable: false },
      { pubkey: tokenBMint, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('7GZfqjfsHzWu68DMtgCbpjN18a1e3hrZ1kqS2zWhJVHP'), isSigner: false, isWritable: true }, // observationState
    ])
    .instruction();
  
  // Build transaction
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 });
  const { blockhash } = await connection.getLatestBlockhash();
  
  const messageV0 = new TransactionMessage({
    payerKey: userWallet.publicKey,
    recentBlockhash: blockhash,
    instructions: [computeBudgetIx, swapIx],
  }).compileToV0Message();
  
  const transaction = new VersionedTransaction(messageV0);
  
  // Verify both signers are included
  console.log('\n📝 Transaction details:');
  console.log('- Version:', transaction.version);
  console.log('- Static accounts:', messageV0.staticAccountKeys.length);
  
  const userIndex = messageV0.staticAccountKeys.findIndex(
    key => key.equals(userWallet.publicKey)
  );
  const relayerIndex = messageV0.staticAccountKeys.findIndex(
    key => key.equals(relayerPublicKey)
  );
  
  console.log('- User account index:', userIndex);
  console.log('- Relayer account index:', relayerIndex);
  
  if (userIndex === -1 || relayerIndex === -1) {
    console.error('\n❌ Both user and relayer must be in transaction accounts!');
    process.exit(1);
  }
  
  // Sign with user only
  console.log('\n✍️  Signing with user wallet only...');
  transaction.sign([userWallet]);
  
  console.log('Signatures after user sign:');
  transaction.signatures.forEach((sig, idx) => {
    console.log(`  [${idx}] ${sig ? '✅ Signed' : '❌ Not signed'}`);
  });
  
  // Submit to relayer
  console.log('\n📤 Submitting to relayer (relayer will add its signature)...');
  
  const orderData = {
    transaction: Buffer.from(transaction.serialize()).toString('base64'),
    poolId: poolId.toBase58(),
    amountIn: amountIn.toString(),
    minAmountOut: minAmountOut.toString(),
    isBaseInput,
    userPublicKey: userWallet.publicKey.toBase58(),
  };
  
  try {
    const response = await axios.post(`${RELAYER_URL}/api/v1/orders`, orderData);
    console.log('\n✅ Order submitted successfully!');
    console.log('Order ID:', response.data.orderId);
    
    // Monitor via WebSocket
    console.log('\n👀 Monitoring order execution...');
    const WebSocket = require('ws');
    const wsUrl = RELAYER_URL.replace('http', 'ws');
    const ws = new WebSocket(`${wsUrl}/ws/orders/${response.data.orderId}`);
    
    return new Promise((resolve) => {
      ws.on('message', (data: string) => {
        const update = JSON.parse(data);
        console.log(`[${new Date().toISOString()}]`, update);
        
        if (update.status === 'executed') {
          console.log('\n🎉 Dual-signing test successful!');
          console.log('Transaction:', update.signature);
          ws.close();
          resolve(true);
        } else if (update.status === 'failed') {
          console.error('\n❌ Execution failed:', update.error);
          ws.close();
          resolve(false);
        }
      });
      
      setTimeout(() => {
        console.log('\n⏱️  Timeout waiting for execution');
        ws.close();
        resolve(false);
      }, 30000);
    });
    
  } catch (error: any) {
    console.error('\n❌ Failed to submit order:');
    console.error(error.response?.data || error.message);
    
    if (error.response?.data?.error?.includes('Relayer must be included')) {
      console.error('\nThe relayer rejected the transaction because it wasn\'t included as a signer.');
      console.error('This is the expected behavior - the client must include the relayer in the transaction.');
    }
  }
}

// Run the test
testDualSigning()
  .then(() => {
    console.log('\n✨ Test complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });