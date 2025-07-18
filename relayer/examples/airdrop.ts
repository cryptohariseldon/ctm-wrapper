#!/usr/bin/env ts-node

import axios from 'axios';
import { Keypair } from '@solana/web3.js';

const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:8086';

async function requestAirdrop() {
  try {
    console.log('🚰 Requesting airdrop from relayer...\n');

    // Generate a new keypair or use existing
    const recipient = Keypair.generate();
    console.log('Recipient address:', recipient.publicKey.toBase58());

    // Request airdrop
    const response = await axios.post(`${RELAYER_URL}/api/v1/airdrop`, {
      address: recipient.publicKey.toBase58(),
      amount: 1_000_000_000 // 1 SOL in lamports
    });

    if (response.data.success) {
      console.log('\n✅ Airdrop successful!');
      console.log('Transaction signature:', response.data.signature);
      console.log('Amount:', response.data.amount / 1e9, 'SOL');
      console.log('New balance:', response.data.newBalance / 1e9, 'SOL');
    } else {
      console.error('❌ Airdrop failed:', response.data.error);
    }

  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 429) {
        console.error('❌ Rate limited:', error.response.data.error);
      } else if (error.response?.status === 403) {
        console.error('❌ Airdrop disabled:', error.response.data.error);
      } else {
        console.error('❌ Error:', error.response?.data?.error || error.message);
      }
    } else {
      console.error('❌ Unexpected error:', error);
    }
  }
}

// Run if called directly
if (require.main === module) {
  requestAirdrop()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}