#!/usr/bin/env ts-node

import { PublicKey, Keypair, Connection } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import axios from 'axios';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

// Configuration
const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:8085';
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

async function submitSwapSimple() {
  console.log('🔄 Testing simplified swap submission...\n');

  // Load user wallet
  const walletPath = path.join(process.env.HOME!, '.config/solana/id.json');
  const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  const userWallet = Keypair.fromSecretKey(new Uint8Array(walletData));
  
  console.log('User wallet:', userWallet.publicKey.toBase58());

  // Check balances
  const connection = new Connection(RPC_URL);
  const balance = await connection.getBalance(userWallet.publicKey);
  console.log(`SOL balance: ${balance / 1e9} SOL`);

  // Get pool info
  const poolId = '9AJUf9ZQ2sWq93ose12BePBn4sq36cyqE98MiZraFLJT';
  const poolInfoResponse = await axios.get(`${RELAYER_URL}/api/v1/pools/${poolId}/price`);
  const poolInfo = poolInfoResponse.data;
  
  console.log('\n📊 Pool information:');
  console.log(`- ${poolInfo.tokenA.symbol}/${poolInfo.tokenB.symbol}`);
  console.log(`- Price: ${poolInfo.price.USDCPerWSOL} USDC per WSOL`);

  // Since the relayer doesn't use the submitted transaction, 
  // we'll create a minimal transaction just to pass validation
  const { Transaction } = await import('@solana/web3.js');
  const dummyTx = new Transaction();
  dummyTx.feePayer = userWallet.publicKey;
  
  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash();
  dummyTx.recentBlockhash = blockhash;
  
  // Sign the dummy transaction
  dummyTx.sign(userWallet);

  // Submit order
  console.log('\n📤 Submitting swap order...');
  const orderData = {
    transaction: dummyTx.serialize().toString('base64'),
    poolId: poolId,
    amountIn: '10000000', // 10 USDC
    minAmountOut: '0',
    isBaseInput: true,
    userPublicKey: userWallet.publicKey.toBase58()
  };

  try {
    const response = await axios.post(`${RELAYER_URL}/api/v1/orders`, orderData);
    console.log('\n✅ Order submitted!');
    console.log('Order ID:', response.data.orderId);
    console.log('Sequence:', response.data.sequence);
    
    // Monitor order
    if (response.data.orderId) {
      await monitorOrder(response.data.orderId);
    }
    
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('❌ Error:', error.response?.data || error.message);
    } else {
      console.error('❌ Error:', error);
    }
  }
}

async function monitorOrder(orderId: string): Promise<void> {
  return new Promise((resolve) => {
    console.log('\n👀 Monitoring order...');
    const wsUrl = RELAYER_URL.replace('http', 'ws');
    const ws = new WebSocket(`${wsUrl}/ws/orders/${orderId}`);
    
    ws.on('message', (data) => {
      const update = JSON.parse(data.toString());
      console.log(`[${new Date().toISOString()}] Status: ${update.status}`);
      
      if (update.status === 'executed') {
        console.log('\n🎉 Swap executed!');
        console.log('Signature:', update.signature);
        console.log('Amount out:', update.actualAmountOut);
        ws.close();
        resolve();
      } else if (update.status === 'failed') {
        console.error('\n❌ Execution failed:', update.error);
        ws.close();
        resolve();
      }
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      resolve();
    });
    
    setTimeout(() => {
      console.log('Timeout');
      ws.close();
      resolve();
    }, 30000);
  });
}

// Run
submitSwapSimple()
  .then(() => process.exit(0))
  .catch(console.error);