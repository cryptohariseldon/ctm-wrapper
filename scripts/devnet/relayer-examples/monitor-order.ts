#!/usr/bin/env ts-node
import WebSocket from 'ws';

const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:8085';
const WS_URL = RELAYER_URL.replace('http', 'ws');

async function monitorOrder(orderId: string) {
  console.log(`\n📡 Monitoring order: ${orderId}`);
  console.log('Connecting to WebSocket...');
  
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}/ws/orders/${orderId}`);
    
    ws.on('open', () => {
      console.log('✅ WebSocket connected');
      console.log('Waiting for order updates...\n');
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        console.log(`[${new Date().toISOString()}] Update received:`);
        console.log(`  Type: ${message.type}`);
        console.log(`  Status: ${message.status}`);
        
        if (message.type === 'order_executed') {
          console.log(`  ✅ Order executed!`);
          console.log(`  Signature: ${message.signature}`);
          console.log(`  Execution Price: ${message.executionPrice}`);
          console.log(`  Actual Amount Out: ${message.actualAmountOut}`);
          ws.close();
          resolve(message);
        } else if (message.type === 'order_failed') {
          console.log(`  ❌ Order failed!`);
          console.log(`  Error: ${message.error}`);
          ws.close();
          reject(new Error(message.error));
        } else if (message.type === 'order_cancelled') {
          console.log(`  🚫 Order cancelled`);
          ws.close();
          resolve(message);
        } else if (message.type === 'status_update') {
          console.log(`  Current order details:`);
          console.log(`    Pool: ${message.poolId}`);
          console.log(`    User: ${message.userPublicKey}`);
          console.log(`    Amount In: ${message.amountIn}`);
          console.log(`    Sequence: ${message.sequence}`);
        }
        
        console.log(''); // Empty line for readability
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    });
    
    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error.message);
      reject(error);
    });
    
    ws.on('close', () => {
      console.log('WebSocket connection closed');
    });
    
    // Timeout after 60 seconds
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        console.log('⏱️  Timeout reached, closing connection');
        ws.close();
        resolve(null);
      }
    }, 60000);
  });
}

async function monitorAllOrders() {
  console.log('\n📡 Monitoring all orders');
  console.log('Connecting to WebSocket feed...');
  
  const ws = new WebSocket(`${WS_URL}/ws/feed`);
  
  ws.on('open', () => {
    console.log('✅ WebSocket connected');
    
    // Subscribe to all events
    ws.send(JSON.stringify({
      type: 'subscribe',
      events: ['all']
    }));
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.type === 'subscribed') {
        console.log('✅ Subscribed to events:', message.events);
        console.log('\nWaiting for order activity...\n');
      } else {
        console.log(`[${new Date().toISOString()}] Event: ${message.type}`);
        console.log(JSON.stringify(message, null, 2));
        console.log('---');
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });
  
  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error.message);
  });
  
  ws.on('close', () => {
    console.log('WebSocket connection closed');
  });
  
  // Keep the connection alive
  process.on('SIGINT', () => {
    console.log('\nClosing WebSocket connection...');
    ws.close();
    process.exit(0);
  });
}

async function main() {
  const orderId = process.argv[2];
  
  if (!orderId || orderId === 'all') {
    console.log('Monitoring all orders. Press Ctrl+C to stop.');
    await monitorAllOrders();
  } else {
    try {
      const result = await monitorOrder(orderId);
      console.log('\nMonitoring complete:', result);
    } catch (error) {
      console.error('\nMonitoring failed:', error.message);
      process.exit(1);
    }
  }
}

// Run if called directly
if (require.main === module) {
  console.log('Usage: ./monitor-order.ts [orderId|all]');
  console.log('Example: ./monitor-order.ts ord_1234567890_abc123');
  console.log('Example: ./monitor-order.ts all');
  main().catch(console.error);
}

export { monitorOrder, monitorAllOrders };