#!/usr/bin/env ts-node

import axios from 'axios';

const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:8086';

// Default pool ID from our configuration
const DEFAULT_POOL_ID = 'F7wLNYJrsnxAC23tomtxLBCUEBaaovK3pRxwe4qektdb';

async function checkPoolPrice(poolId: string = DEFAULT_POOL_ID) {
  try {
    console.log('📊 Fetching pool price...\n');
    console.log('Pool ID:', poolId);

    // Get pool price
    const response = await axios.get(`${RELAYER_URL}/api/v1/pools/${poolId}/price`);
    const data = response.data;

    console.log('\n✅ Pool Price Information:');
    console.log('=====================================');
    
    // Token information
    console.log('\nToken A:', data.tokenA.symbol);
    console.log('  Mint:', data.tokenA.mint);
    console.log('  Balance:', data.tokenA.uiAmount.toFixed(4));
    
    console.log('\nToken B:', data.tokenB.symbol);
    console.log('  Mint:', data.tokenB.mint);
    console.log('  Balance:', data.tokenB.uiAmount.toFixed(4));
    
    // Price information
    console.log('\n💱 Current Prices:');
    Object.entries(data.price).forEach(([key, value]) => {
      console.log(`  ${key}: ${value}`);
    });
    
    // Liquidity information
    console.log('\n💧 Liquidity:');
    console.log(`  ${data.tokenA.symbol}: ${data.tokenA.uiAmount.toFixed(4)}`);
    console.log(`  ${data.tokenB.symbol}: ${data.tokenB.uiAmount.toFixed(4)}`);
    
    console.log('\n🕐 Last Update:', data.lastUpdate);

  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 404) {
        console.error('❌ Pool not found:', error.response.data.error);
      } else if (error.response?.status === 400) {
        console.error('❌ Invalid pool ID:', error.response.data.error);
      } else {
        console.error('❌ Error:', error.response?.data?.error || error.message);
      }
    } else {
      console.error('❌ Unexpected error:', error);
    }
  }
}

// Get pool ID from command line or use default
const poolId = process.argv[2] || DEFAULT_POOL_ID;

// Run if called directly
if (require.main === module) {
  checkPoolPrice(poolId)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}