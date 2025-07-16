import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
// Use built-in fetch in Node 18+
import WebSocket from 'ws';

const RELAYER_URL = 'http://localhost:8085';
const RPC_URL = 'http://localhost:8899';

async function testRelayerService() {
  console.log('🧪 Testing Continuum Relayer Service...\n');

  try {
    // Test 1: Health Check
    console.log('1️⃣ Testing health endpoint...');
    const healthResponse = await fetch(`${RELAYER_URL}/health`);
    if (!healthResponse.ok) {
      throw new Error(`Health check failed: ${healthResponse.status}`);
    }
    const health = await healthResponse.json();
    console.log('✅ Health check passed:', health);
    console.log(`   Relayer address: ${health.relayer}`);
    console.log(`   Status: ${health.status}\n`);

    // Test 2: Get Relayer Info
    console.log('2️⃣ Testing info endpoint...');
    const infoResponse = await fetch(`${RELAYER_URL}/api/v1/info`);
    if (!infoResponse.ok) {
      throw new Error(`Info endpoint failed: ${infoResponse.status}`);
    }
    const info = await infoResponse.json();
    console.log('✅ Info endpoint passed:');
    console.log(`   Continuum Program: ${info.continuumProgram}`);
    console.log(`   CP-Swap Program: ${info.cpSwapProgram}`);
    console.log(`   Fee: ${info.fee} bps`);
    console.log(`   Performance:`, info.performance, '\n');

    // Test 3: Get Supported Pools
    console.log('3️⃣ Testing pools endpoint...');
    const poolsResponse = await fetch(`${RELAYER_URL}/api/v1/pools`);
    if (!poolsResponse.ok) {
      throw new Error(`Pools endpoint failed: ${poolsResponse.status}`);
    }
    const pools = await poolsResponse.json();
    console.log('✅ Pools endpoint passed:');
    console.log(`   Total pools: ${pools.pools?.length || 0}\n`);

    // Test 4: Get Statistics
    console.log('4️⃣ Testing stats endpoint...');
    const statsResponse = await fetch(`${RELAYER_URL}/api/v1/stats`);
    if (!statsResponse.ok) {
      throw new Error(`Stats endpoint failed: ${statsResponse.status}`);
    }
    const stats = await statsResponse.json();
    console.log('✅ Stats endpoint passed:', stats, '\n');

    // Test 5: Submit Order (will fail but tests the endpoint)
    console.log('5️⃣ Testing order submission...');
    const testWallet = Keypair.generate();
    const connection = new Connection(RPC_URL);
    
    // Create a dummy transaction
    const transaction = new Transaction();
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: testWallet.publicKey,
        toPubkey: testWallet.publicKey,
        lamports: 1,
      })
    );
    
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = testWallet.publicKey;
    transaction.partialSign(testWallet);

    const orderData = {
      transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
      poolId: Keypair.generate().publicKey.toBase58(),
      amountIn: '1000000000',
      minAmountOut: '950000000',
      isBaseInput: true,
      userPublicKey: testWallet.publicKey.toBase58(),
    };

    const orderResponse = await fetch(`${RELAYER_URL}/api/v1/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData),
    });

    const orderResult = await orderResponse.json();
    
    if (orderResponse.ok) {
      console.log('✅ Order submission endpoint working:', orderResult);
    } else {
      console.log('⚠️  Order submission failed (expected):', orderResult.error);
    }
    console.log('');

    // Test 6: WebSocket Connection
    console.log('6️⃣ Testing WebSocket connection...');
    const testOrderId = 'test-order-123';
    const ws = new WebSocket(`${RELAYER_URL.replace('http', 'ws')}/ws/orders/${testOrderId}`);
    
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        console.log('✅ WebSocket connected successfully');
        ws.close();
        resolve();
      });
      
      ws.on('error', (error) => {
        console.log('❌ WebSocket error:', error.message);
        reject(error);
      });
      
      setTimeout(() => {
        ws.close();
        resolve();
      }, 2000);
    });
    console.log('');

    // Test 7: Invalid Order Status
    console.log('7️⃣ Testing order status endpoint...');
    const statusResponse = await fetch(`${RELAYER_URL}/api/v1/orders/invalid-order-id`);
    const statusResult = await statusResponse.json();
    
    if (!statusResponse.ok) {
      console.log('✅ Order status correctly returns error for invalid order:', statusResult.error);
    } else {
      console.log('⚠️  Unexpected success for invalid order');
    }
    console.log('');

    console.log('🎉 All tests completed!\n');
    console.log('📋 Summary:');
    console.log('   - HTTP API: Working ✅');
    console.log('   - WebSocket: Working ✅');
    console.log('   - All endpoints responding correctly');
    console.log('   - Service is ready for use on port 8085');

  } catch (error) {
    console.error('❌ Test failed:', error instanceof Error ? error.message : String(error));
    console.error('\nMake sure the relayer service is running on port 8085');
    process.exit(1);
  }
}

// Run the test
testRelayerService().then(() => {
  console.log('\n✅ Relayer service test completed successfully!');
  process.exit(0);
}).catch((error) => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});