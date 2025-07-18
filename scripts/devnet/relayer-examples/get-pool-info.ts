#!/usr/bin/env ts-node
import fs from 'fs';
import path from 'path';

const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:8085';

async function getRelayerInfo() {
  console.log('\n📊 Relayer Information');
  console.log('='.repeat(50));
  
  const response = await fetch(`${RELAYER_URL}/api/v1/info`);
  const data = await response.json() as any;
  
  console.log(`Relayer Address: ${data.relayerAddress}`);
  console.log(`Continuum Program: ${data.continuumProgram}`);
  console.log(`CP-Swap Program: ${data.cpSwapProgram}`);
  console.log(`\nPerformance Stats:`);
  console.log(`  Success Rate: ${(data.performance.successRate * 100).toFixed(2)}%`);
  console.log(`  Avg Execution Time: ${data.performance.avgExecutionTime}ms`);
  console.log(`  Total Orders: ${data.performance.totalOrders}`);
  
  return data;
}

async function getPoolList() {
  console.log('\n🏊 Supported Pools');
  console.log('='.repeat(50));
  
  const response = await fetch(`${RELAYER_URL}/api/v1/pools`);
  const data = await response.json() as any;
  
  data.pools.forEach((pool: any, index: number) => {
    console.log(`\nPool ${index + 1}:`);
    console.log(`  ID: ${pool.poolId}`);
    console.log(`  Token 0: ${pool.token0}`);
    console.log(`  Token 1: ${pool.token1}`);
    console.log(`  Fee: ${pool.fee * 100}%`);
    console.log(`  Active: ${pool.isActive ? '✅' : '❌'}`);
  });
  
  return data.pools;
}

async function getPoolPrice(poolId: string) {
  console.log(`\n💱 Pool Price Information`);
  console.log('='.repeat(50));
  console.log(`Pool ID: ${poolId}`);
  
  const response = await fetch(`${RELAYER_URL}/api/v1/pools/${poolId}/price`);
  const data = await response.json() as any;
  
  if (!response.ok) {
    console.error('Error:', data.error);
    return null;
  }
  
  console.log(`\nToken A (${data.tokenA.symbol}):`);
  console.log(`  Mint: ${data.tokenA.mint}`);
  console.log(`  Decimals: ${data.tokenA.decimals}`);
  console.log(`  Pool Balance: ${data.tokenA.uiAmount.toFixed(2)}`);
  
  console.log(`\nToken B (${data.tokenB.symbol}):`);
  console.log(`  Mint: ${data.tokenB.mint}`);
  console.log(`  Decimals: ${data.tokenB.decimals}`);
  console.log(`  Pool Balance: ${data.tokenB.uiAmount.toFixed(2)}`);
  
  console.log(`\n📈 Current Prices:`);
  Object.entries(data.price).forEach(([key, value]) => {
    console.log(`  ${key}: ${value}`);
  });
  
  console.log(`\nLast Update: ${data.lastUpdate}`);
  
  return data;
}

async function getRelayerStats() {
  console.log('\n📊 Relayer Statistics');
  console.log('='.repeat(50));
  
  const response = await fetch(`${RELAYER_URL}/api/v1/stats`);
  const data = await response.json() as any;
  
  console.log(`Total Orders: ${data.totalOrders}`);
  console.log(`Successful Orders: ${data.successfulOrders}`);
  console.log(`Failed Orders: ${data.failedOrders}`);
  console.log(`Success Rate: ${(data.successRate * 100).toFixed(2)}%`);
  console.log(`Average Execution Time: ${data.avgExecutionTime.toFixed(0)}ms`);
  console.log(`Pending Orders: ${data.pendingOrders}`);
  console.log(`Relayer Balance: ${data.relayerBalance.toFixed(4)} SOL`);
  
  return data;
}

async function main() {
  console.log(`🔗 Connecting to relayer at: ${RELAYER_URL}`);
  
  try {
    // Check if relayer is running
    const healthResponse = await fetch(`${RELAYER_URL}/health`);
    if (!healthResponse.ok) {
      throw new Error('Relayer is not responding');
    }
    const health = await healthResponse.json() as any;
    console.log(`✅ Relayer is ${health.status}`);
    console.log(`Version: ${health.version}`);
    
    // Get relayer info
    await getRelayerInfo();
    
    // Get pool list
    const pools = await getPoolList();
    
    // Get price for first pool
    if (pools.length > 0) {
      await getPoolPrice(pools[0].poolId);
    }
    
    // Get stats
    await getRelayerStats();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\nMake sure the relayer is running with:');
    console.log('  cd relayer && npm run dev -- --devnet');
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { getRelayerInfo, getPoolList, getPoolPrice, getRelayerStats };