#!/usr/bin/env ts-node

import * as anchor from "@coral-xyz/anchor";
import { Program, BN, Idl } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  VersionedTransaction,
  TransactionMessage,
  MessageV0,
  TransactionInstruction,
  AddressLookupTableAccount
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import axios from 'axios';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

// Configuration
const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:8085';
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

// Program IDs
const CONTINUUM_PROGRAM_ID = new PublicKey('EaeWUSam5Li1fzCcCs33oE4jCLQT4F6RJXgrPYZaoKqq');
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

interface SwapParams {
  poolId: string;
  amountIn: string;
  minAmountOut: string;
  isBaseInput: boolean;
  userWallet: Keypair;
}

async function submitSwap(params: SwapParams) {
  console.log('🔄 Submitting swap to relayer...\n');

  const connection = new Connection(RPC_URL, 'confirmed');

  // Parse pool ID
  const poolId = new PublicKey(params.poolId);
  
  // Get pool info from relayer
  console.log('📊 Fetching pool information...');
  const poolInfoResponse = await axios.get(`${RELAYER_URL}/api/v1/pools/${params.poolId}/price`);
  const poolInfo = poolInfoResponse.data;
  
  console.log('Pool info:');
  console.log(`- Token A: ${poolInfo.tokenA.symbol} (${poolInfo.tokenA.mint})`);
  console.log(`- Token B: ${poolInfo.tokenB.symbol} (${poolInfo.tokenB.mint})`);
  console.log(`- Current price: ${poolInfo.price.USDCPerWSOL} USDC/WSOL`);

  // Determine token mints based on swap direction
  const tokenAMint = new PublicKey(poolInfo.tokenA.mint);
  const tokenBMint = new PublicKey(poolInfo.tokenB.mint);
  
  // For this pool, tokenA is USDC and tokenB is WSOL
  // isBaseInput true means we're swapping USDC for WSOL
  const inputMint = params.isBaseInput ? tokenAMint : tokenBMint;
  const outputMint = params.isBaseInput ? tokenBMint : tokenAMint;

  // User token accounts
  const userInputAccount = getAssociatedTokenAddressSync(inputMint, params.userWallet.publicKey);
  const userOutputAccount = getAssociatedTokenAddressSync(outputMint, params.userWallet.publicKey);

  // Load IDL for anchor program
  const idlPath = '/home/ubuntu/frm_may/fs2/ctm_wrapper_fs/target/idl/continuum_cp_swap.json';
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
  
  // Create program interface with a provider
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(params.userWallet),
    { commitment: 'confirmed' }
  );
  const program = new Program(idl as Idl, provider);

  // Derive PDAs
  const [fifoState] = PublicKey.findProgramAddressSync(
    [Buffer.from('fifo_state')],
    CONTINUUM_PROGRAM_ID
  );

  const [poolAuthority, poolAuthorityBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('cp_pool_authority'), poolId.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );

  const [cpSwapAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_and_lp_mint_auth_seed')],
    CP_SWAP_PROGRAM_ID
  );

  // Get pool state to find vaults and amm config
  console.log('\n🔍 Fetching pool state...');
  const poolAccount = await connection.getAccountInfo(poolId);
  if (!poolAccount) {
    throw new Error('Pool account not found');
  }

  // Parse pool state to get ammConfig and vaults
  // This is a simplified version - in production, use proper deserialization
  const ammConfigOffset = 8; // After discriminator
  const ammConfig = new PublicKey(poolAccount.data.slice(ammConfigOffset, ammConfigOffset + 32));
  
  // Token vaults are at specific offsets in the pool state
  const token0VaultOffset = 72;
  const token1VaultOffset = 104;
  const token0Vault = new PublicKey(poolAccount.data.slice(token0VaultOffset, token0VaultOffset + 32));
  const token1Vault = new PublicKey(poolAccount.data.slice(token1VaultOffset, token1VaultOffset + 32));
  
  // For devnet, we'll use the known observation state from the pool config
  // In production, this should be parsed from the pool state properly
  const observationState = new PublicKey('7GZfqjfsHzWu68DMtgCbpjN18a1e3hrZ1kqS2zWhJVHP');

  console.log('Pool state:');
  console.log('- AMM Config:', ammConfig.toBase58());
  console.log('- Token 0 Vault:', token0Vault.toBase58());
  console.log('- Token 1 Vault:', token1Vault.toBase58());
  console.log('- Observation State:', observationState.toBase58());

  // Build the swap instruction
  console.log('\n🔨 Building swap instruction...');
  
  const amountIn = new BN(params.amountIn);
  const minAmountOut = new BN(params.minAmountOut);

  const swapIx = await program.methods
    .swapImmediate(
      amountIn,
      minAmountOut,
      params.isBaseInput,
      poolId,
      poolAuthorityBump
    )
    .accountsPartial({
      fifoState: fifoState,
      cpSwapProgram: CP_SWAP_PROGRAM_ID,
    })
    .remainingAccounts([
      // Accounts for CP-Swap CPI - user must be first
      { pubkey: params.userWallet.publicKey, isSigner: true, isWritable: false },
      { pubkey: cpSwapAuthority, isSigner: false, isWritable: false },
      { pubkey: ammConfig, isSigner: false, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: userInputAccount, isSigner: false, isWritable: true },
      { pubkey: userOutputAccount, isSigner: false, isWritable: true },
      { pubkey: params.isBaseInput ? token0Vault : token1Vault, isSigner: false, isWritable: true },
      { pubkey: params.isBaseInput ? token1Vault : token0Vault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: inputMint, isSigner: false, isWritable: false },
      { pubkey: outputMint, isSigner: false, isWritable: false },
      { pubkey: observationState, isSigner: false, isWritable: true },
    ])
    .instruction();

  // Create transaction with compute budget
  const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
    units: 300000
  });

  // Build instructions array
  const instructions: TransactionInstruction[] = [
    modifyComputeUnits
  ];
  
  // Check if output token account exists, create if needed
  const outputAccountInfo = await connection.getAccountInfo(userOutputAccount);
  if (!outputAccountInfo) {
    console.log('Creating output token account...');
    const { createAssociatedTokenAccountInstruction, ASSOCIATED_TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
    
    instructions.push(
      createAssociatedTokenAccountInstruction(
        params.userWallet.publicKey, // payer
        userOutputAccount, // ata
        params.userWallet.publicKey, // owner
        outputMint, // mint
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
  }
  
  // Add swap instruction
  instructions.push(swapIx);

  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash();

  // Create v0 message
  const messageV0 = new TransactionMessage({
    payerKey: params.userWallet.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  // Create versioned transaction
  const transaction = new VersionedTransaction(messageV0);

  // Sign the transaction
  console.log('\n✍️  Signing versioned transaction...');
  transaction.sign([params.userWallet]);
  
  // Debug: Check signatures
  console.log('Transaction version:', transaction.version);
  console.log('Static account keys:', messageV0.staticAccountKeys.length);
  console.log('Signatures present:', transaction.signatures.filter(sig => sig !== null).length);

  // Submit to relayer
  console.log('\n📤 Submitting to relayer...');
  
  const orderData = {
    transaction: Buffer.from(transaction.serialize()).toString('base64'),
    poolId: params.poolId,
    amountIn: params.amountIn,
    minAmountOut: params.minAmountOut,
    isBaseInput: params.isBaseInput,
    userPublicKey: params.userWallet.publicKey.toBase58()
  };

  console.log('Order data:', {
    ...orderData,
    transaction: orderData.transaction.substring(0, 50) + '...'
  });

  try {
    const response = await axios.post(`${RELAYER_URL}/api/v1/orders`, orderData);
    
    console.log('\n✅ Order submitted successfully!');
    console.log('Order ID:', response.data.orderId);
    console.log('Status:', response.data.status);
    
    // Subscribe to order updates
    if (response.data.orderId) {
      console.log('\n👀 Monitoring order status...');
      await monitorOrder(response.data.orderId);
    }
    
    return response.data;
    
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('\n❌ Failed to submit order:');
      console.error('Status:', error.response?.status);
      console.error('Error:', error.response?.data);
    } else {
      console.error('\n❌ Unexpected error:', error);
    }
    throw error;
  }
}

async function monitorOrder(orderId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const wsUrl = RELAYER_URL.replace('http', 'ws');
    const ws = new WebSocket(`${wsUrl}/ws/orders/${orderId}`);
    
    ws.on('open', () => {
      console.log('WebSocket connected for order monitoring');
    });
    
    ws.on('message', (data) => {
      const update = JSON.parse(data.toString());
      console.log(`[${new Date().toISOString()}] Order update:`, update);
      
      if (update.status === 'executed') {
        console.log('\n🎉 Swap executed successfully!');
        console.log('Transaction signature:', update.signature);
        console.log('Actual amount out:', update.actualAmountOut);
        ws.close();
        resolve();
      } else if (update.status === 'failed') {
        console.error('\n❌ Swap execution failed:', update.error);
        ws.close();
        reject(new Error(update.error));
      }
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      reject(error);
    });
    
    ws.on('close', () => {
      console.log('WebSocket disconnected');
    });
    
    // Timeout after 60 seconds
    setTimeout(() => {
      console.log('Timeout waiting for order execution');
      ws.close();
      resolve();
    }, 60000);
  });
}

// Example usage
async function main() {
  try {
    // Load user wallet from default location or create new one
    let userWallet: Keypair;
    const walletPath = path.join(process.env.HOME!, '.config/solana/id.json');
    
    if (fs.existsSync(walletPath)) {
      console.log('Loading existing wallet...');
      const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
      userWallet = Keypair.fromSecretKey(new Uint8Array(walletData));
    } else {
      console.log('Creating new wallet...');
      userWallet = Keypair.generate();
    }
    
    console.log('User wallet:', userWallet.publicKey.toBase58());
    
    // Check wallet balance
    const connection = new Connection(RPC_URL);
    const balance = await connection.getBalance(userWallet.publicKey);
    console.log(`Current SOL balance: ${balance / 1e9} SOL`);
    
    // Fund the wallet if needed (devnet only)
    if (RPC_URL.includes('devnet') && balance < 0.1 * 1e9) {
      console.log('\n💰 Low balance, requesting airdrop...');
      try {
        const airdropSig = await connection.requestAirdrop(
          userWallet.publicKey,
          2 * 1e9 // 2 SOL
        );
        await connection.confirmTransaction(airdropSig);
        console.log('Airdrop confirmed');
      } catch (error) {
        console.log('Airdrop failed, continuing anyway...');
      }
    }
    
    // Check USDC balance
    console.log('\n💧 Checking token balances...');
    const usdcMint = new PublicKey('8eLeJssGBw8Z2z1y3uz1xCwzrWa2QjCqAtH7Y88MjTND');
    const userUsdcAccount = getAssociatedTokenAddressSync(usdcMint, userWallet.publicKey);
    
    try {
      const tokenBalance = await connection.getTokenAccountBalance(userUsdcAccount);
      console.log(`USDC balance: ${tokenBalance.value.uiAmount} USDC`);
    } catch (error) {
      console.log('No USDC account found');
    }
    
    // Wait a bit for accounts to be created
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Submit swap: 10 USDC for WSOL
    const swapParams: SwapParams = {
      poolId: '9AJUf9ZQ2sWq93ose12BePBn4sq36cyqE98MiZraFLJT', // The active pool from relayer
      amountIn: (10 * 1e6).toString(), // 10 USDC (6 decimals)
      minAmountOut: '0', // Accept any amount for testing
      isBaseInput: true, // Swapping USDC (base) for WSOL
      userWallet
    };
    
    console.log('\n🚀 Submitting swap:');
    console.log(`- Swapping ${Number(swapParams.amountIn) / 1e6} USDC for WSOL`);
    console.log(`- Min output: ${swapParams.minAmountOut}`);
    
    const result = await submitSwap(swapParams);
    console.log('\n✅ Swap completed!');
    console.log('Result:', result);
    
  } catch (error) {
    console.error('Example failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { submitSwap, SwapParams };