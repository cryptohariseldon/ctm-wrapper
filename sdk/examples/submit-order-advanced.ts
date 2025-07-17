import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { ContinuumClient, SwapParams } from '../src';
import { Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { 
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TokenAccountNotFoundError
} from '@solana/spl-token';
import WebSocket from 'ws';

/**
 * Advanced Order Submission Examples
 * Demonstrates various ways to submit orders to Continuum
 */

/**
 * Basic order submission
 */
async function submitBasicOrder() {
  console.log('=== Basic Order Submission ===\n');
  
  const connection = new Connection('http://localhost:8899', 'confirmed');
  const user = Keypair.generate();
  
  // Fund user account
  const airdropSig = await connection.requestAirdrop(user.publicKey, 2e9);
  await connection.confirmTransaction(airdropSig);
  console.log('User funded:', user.publicKey.toBase58());
  
  // Initialize client
  const wallet = new Wallet(user);
  const client = new ContinuumClient(connection, wallet);
  
  // Pool and token information (replace with actual values)
  const poolId = new PublicKey('YourPoolIdHere');
  const token0 = new PublicKey('Token0MintAddress');
  const token1 = new PublicKey('Token1MintAddress');
  
  // Get or create user token accounts
  const userToken0 = await getAssociatedTokenAddress(token0, user.publicKey);
  const userToken1 = await getAssociatedTokenAddress(token1, user.publicKey);
  
  // Swap parameters
  const swapParams: SwapParams = {
    poolId,
    amountIn: new BN(1_000_000), // 1 token with 6 decimals
    minAmountOut: new BN(950_000), // 0.95 tokens (5% slippage tolerance)
    isBaseInput: true, // Swapping token0 for token1
    userSourceToken: userToken0,
    userDestinationToken: userToken1,
  };
  
  try {
    console.log('Submitting order...');
    const { signature, sequence } = await client.submitOrder(user, swapParams);
    
    console.log('\nOrder submitted successfully!');
    console.log('Transaction:', signature);
    console.log('Order sequence:', sequence.toString());
    
    // Monitor order status
    await monitorOrderStatus(client, user.publicKey, sequence);
    
  } catch (error) {
    console.error('Error submitting order:', error);
  }
}

/**
 * Submit order with automatic token account creation
 */
async function submitOrderWithAccountCreation() {
  console.log('=== Order Submission with Account Creation ===\n');
  
  const connection = new Connection('http://localhost:8899', 'confirmed');
  const user = Keypair.generate();
  
  // Fund user
  const airdropSig = await connection.requestAirdrop(user.publicKey, 2e9);
  await connection.confirmTransaction(airdropSig);
  
  const wallet = new Wallet(user);
  const client = new ContinuumClient(connection, wallet);
  
  const poolId = new PublicKey('YourPoolIdHere');
  const token0 = new PublicKey('Token0MintAddress');
  const token1 = new PublicKey('Token1MintAddress');
  
  // Check and create token accounts if needed
  const userToken0 = await getAssociatedTokenAddress(token0, user.publicKey);
  const userToken1 = await getAssociatedTokenAddress(token1, user.publicKey);
  
  const transaction = new Transaction();
  
  // Check if destination token account exists
  try {
    await getAccount(connection, userToken1);
  } catch (error) {
    if (error instanceof TokenAccountNotFoundError) {
      console.log('Creating destination token account...');
      transaction.add(
        createAssociatedTokenAccountInstruction(
          user.publicKey,
          userToken1,
          user.publicKey,
          token1
        )
      );
    }
  }
  
  // Add swap instruction (simplified - use actual SDK)
  const swapParams: SwapParams = {
    poolId,
    amountIn: new BN(1_000_000),
    minAmountOut: new BN(950_000),
    isBaseInput: true,
    userSourceToken: userToken0,
    userDestinationToken: userToken1,
  };
  
  // In production, add the actual swap instruction here
  // transaction.add(swapInstruction);
  
  console.log('Transaction prepared with account creation');
}

/**
 * Submit order through relayer
 */
async function submitOrderThroughRelayer() {
  console.log('=== Order Submission Through Relayer ===\n');
  
  const connection = new Connection('http://localhost:8899', 'confirmed');
  const relayerUrl = 'http://localhost:8080';
  const user = Keypair.generate();
  
  // Fund user
  const airdropSig = await connection.requestAirdrop(user.publicKey, 2e9);
  await connection.confirmTransaction(airdropSig);
  console.log('User funded:', user.publicKey.toBase58());
  
  const wallet = new Wallet(user);
  const client = new ContinuumClient(connection, wallet);
  
  // Create partially signed transaction
  const swapParams: SwapParams = {
    poolId: new PublicKey('YourPoolIdHere'),
    amountIn: new BN(1_000_000),
    minAmountOut: new BN(950_000),
    isBaseInput: true,
    userSourceToken: new PublicKey('UserToken0Account'),
    userDestinationToken: new PublicKey('UserToken1Account'),
  };
  
  const { transaction, sequence } = await client.createPartiallySignedSubmitOrder(
    user.publicKey,
    swapParams
  );
  
  // User signs the transaction
  transaction.partialSign(user);
  
  // Submit to relayer
  const response = await fetch(`${relayerUrl}/api/v1/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transaction: transaction.serialize({ 
        requireAllSignatures: false 
      }).toString('base64'),
      expectedSequence: sequence.toString(),
    }),
  });
  
  const result = await response.json();
  console.log('Order submitted to relayer:', result.orderId);
  
  // Monitor via WebSocket
  await monitorRelayerOrder(relayerUrl, result.orderId);
}

/**
 * Batch order submission
 */
async function submitBatchOrders() {
  console.log('=== Batch Order Submission ===\n');
  
  const connection = new Connection('http://localhost:8899', 'confirmed');
  const users = Array.from({ length: 3 }, () => Keypair.generate());
  
  // Fund all users
  console.log('Funding users...');
  await Promise.all(
    users.map(async (user) => {
      const sig = await connection.requestAirdrop(user.publicKey, 2e9);
      await connection.confirmTransaction(sig);
    })
  );
  
  const poolId = new PublicKey('YourPoolIdHere');
  
  // Submit orders in parallel
  const orderPromises = users.map(async (user, index) => {
    const wallet = new Wallet(user);
    const client = new ContinuumClient(connection, wallet);
    
    const swapParams: SwapParams = {
      poolId,
      amountIn: new BN((index + 1) * 1_000_000), // Different amounts
      minAmountOut: new BN((index + 1) * 950_000),
      isBaseInput: true,
      userSourceToken: new PublicKey('UserToken0Account'),
      userDestinationToken: new PublicKey('UserToken1Account'),
    };
    
    try {
      const result = await client.submitOrder(user, swapParams);
      console.log(`Order ${index + 1} submitted:`, result.sequence.toString());
      return result;
    } catch (error) {
      console.error(`Order ${index + 1} failed:`, error.message);
      return null;
    }
  });
  
  const results = await Promise.all(orderPromises);
  const successful = results.filter(r => r !== null);
  
  console.log(`\nSubmitted ${successful.length}/${users.length} orders successfully`);
}

/**
 * Submit order with custom slippage and deadline
 */
async function submitOrderWithCustomParameters() {
  console.log('=== Order with Custom Parameters ===\n');
  
  const connection = new Connection('http://localhost:8899', 'confirmed');
  const user = Keypair.generate();
  
  // Fund user
  const airdropSig = await connection.requestAirdrop(user.publicKey, 2e9);
  await connection.confirmTransaction(airdropSig);
  
  const wallet = new Wallet(user);
  const client = new ContinuumClient(connection, wallet);
  
  // Calculate slippage
  const amountIn = new BN(1_000_000); // 1 token
  const expectedOut = new BN(2_000_000); // Expected 2 tokens out
  const slippageBps = 100; // 1% slippage (100 basis points)
  
  const minAmountOut = expectedOut
    .mul(new BN(10000 - slippageBps))
    .div(new BN(10000));
  
  console.log('Amount in:', amountIn.toString());
  console.log('Expected out:', expectedOut.toString());
  console.log('Min amount out (1% slippage):', minAmountOut.toString());
  
  const swapParams: SwapParams = {
    poolId: new PublicKey('YourPoolIdHere'),
    amountIn,
    minAmountOut,
    isBaseInput: true,
    userSourceToken: new PublicKey('UserToken0Account'),
    userDestinationToken: new PublicKey('UserToken1Account'),
  };
  
  // Submit with deadline (transaction expires in 60 seconds)
  const { transaction, sequence } = await client.createPartiallySignedSubmitOrder(
    user.publicKey,
    swapParams
  );
  
  // Set custom compute budget
  // transaction.add(
  //   ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })
  // );
  
  transaction.partialSign(user);
  
  console.log('Order prepared with custom parameters');
  console.log('Sequence:', sequence.toString());
}

/**
 * Monitor order status
 */
async function monitorOrderStatus(
  client: ContinuumClient,
  user: PublicKey,
  sequence: BN
) {
  console.log('\nMonitoring order status...');
  
  let attempts = 0;
  const maxAttempts = 30;
  
  while (attempts < maxAttempts) {
    const orderState = await client.getOrderState(user, sequence);
    
    if (orderState) {
      console.log(`Status: ${getOrderStatusString(orderState.status)}`);
      
      if (orderState.status === 2) { // Executed
        console.log('Order executed successfully!');
        console.log('Executed at:', new Date(orderState.executedAt!.toNumber() * 1000));
        break;
      } else if (orderState.status === 3) { // Cancelled
        console.log('Order was cancelled');
        break;
      }
    }
    
    attempts++;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

/**
 * Monitor order via relayer WebSocket
 */
async function monitorRelayerOrder(relayerUrl: string, orderId: string) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${relayerUrl.replace('http', 'ws')}/ws/orders/${orderId}`);
    
    ws.on('open', () => {
      console.log('Connected to relayer WebSocket');
    });
    
    ws.on('message', (data) => {
      const update = JSON.parse(data.toString());
      console.log('Order update:', update.status);
      
      if (update.status === 'executed') {
        console.log('Order executed!');
        console.log('Transaction:', update.signature);
        ws.close();
        resolve(update);
      } else if (update.status === 'failed') {
        console.error('Order failed:', update.error);
        ws.close();
        reject(new Error(update.error));
      }
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      reject(error);
    });
  });
}

/**
 * Helper to get order status string
 */
function getOrderStatusString(status: number): string {
  switch (status) {
    case 0: return 'Pending';
    case 1: return 'Processing';
    case 2: return 'Executed';
    case 3: return 'Cancelled';
    default: return 'Unknown';
  }
}

// Run examples
if (require.main === module) {
  const example = process.argv[2] || 'basic';
  
  switch (example) {
    case 'basic':
      submitBasicOrder().catch(console.error);
      break;
    case 'account':
      submitOrderWithAccountCreation().catch(console.error);
      break;
    case 'relayer':
      submitOrderThroughRelayer().catch(console.error);
      break;
    case 'batch':
      submitBatchOrders().catch(console.error);
      break;
    case 'custom':
      submitOrderWithCustomParameters().catch(console.error);
      break;
    default:
      console.log('Usage: ts-node submit-order-advanced.ts [basic|account|relayer|batch|custom]');
  }
}

export {
  submitBasicOrder,
  submitOrderWithAccountCreation,
  submitOrderThroughRelayer,
  submitBatchOrders,
  submitOrderWithCustomParameters
};