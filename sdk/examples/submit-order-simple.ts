import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { ContinuumClient, SwapParams } from '../src';
import { Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { 
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TokenAccountNotFoundError
} from '@solana/spl-token';

/**
 * Simple order submission example
 */
async function submitOrderExample() {
  console.log('=== Order Submission Example ===\n');
  
  const connection = new Connection('http://localhost:8899', 'confirmed');
  
  // Create user keypair
  const user = Keypair.generate();
  console.log('User address:', user.publicKey.toBase58());
  
  // Fund user
  console.log('Funding user account...');
  const airdropSig = await connection.requestAirdrop(user.publicKey, 2 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdropSig);
  console.log('User funded with 2 SOL');
  
  // Initialize client
  const wallet = new Wallet(user);
  const client = new ContinuumClient(connection, wallet);
  
  // Check FIFO state
  console.log('\nChecking Continuum state...');
  const fifoState = await client.getFifoState();
  if (!fifoState) {
    console.log('❌ Continuum not initialized. Please run initialization first.');
    return;
  }
  
  console.log('✅ Continuum is initialized');
  console.log('  Current sequence:', fifoState.currentSequence.toString());
  console.log('  Admin:', fifoState.admin.toBase58());
  
  // Example pool and tokens (replace with actual values from pool creation)
  const poolId = new PublicKey('11111111111111111111111111111111'); // Replace with actual pool
  const token0 = new PublicKey('11111111111111111111111111111111'); // Replace with actual token
  const token1 = new PublicKey('11111111111111111111111111111111'); // Replace with actual token
  
  console.log('\n=== Creating Order ===');
  console.log('Pool ID:', poolId.toBase58());
  console.log('Token 0:', token0.toBase58());
  console.log('Token 1:', token1.toBase58());
  
  // Get user token accounts
  const userToken0 = await getAssociatedTokenAddress(token0, user.publicKey);
  const userToken1 = await getAssociatedTokenAddress(token1, user.publicKey);
  
  // Swap parameters
  const swapParams: SwapParams = {
    poolId,
    amountIn: new BN(1_000_000), // 1 token with 6 decimals
    minAmountOut: new BN(950_000), // 0.95 tokens (5% slippage)
    isBaseInput: true,
    userSourceToken: userToken0,
    userDestinationToken: userToken1,
  };
  
  console.log('\nSwap parameters:');
  console.log('  Amount in:', swapParams.amountIn.toString());
  console.log('  Min amount out:', swapParams.minAmountOut.toString());
  console.log('  Is base input:', swapParams.isBaseInput);
  
  try {
    // Create partially signed transaction
    console.log('\nCreating partially signed transaction...');
    const { transaction, sequence } = await client.createPartiallySignedSubmitOrder(
      user.publicKey,
      swapParams
    );
    
    console.log('✅ Transaction created');
    console.log('  Expected sequence:', sequence.toString());
    console.log('  Transaction size:', transaction.serialize({ 
      requireAllSignatures: false,
      verifySignatures: false 
    }).length, 'bytes');
    
    // User signs the transaction
    transaction.partialSign(user);
    console.log('✅ Transaction signed by user');
    
    // At this point, the transaction could be:
    // 1. Submitted directly to the network
    // 2. Sent to a relayer service
    // 3. Stored for later submission
    
    console.log('\n=== Next Steps ===');
    console.log('1. Create a real pool using the pool creation example');
    console.log('2. Fund user token accounts');
    console.log('3. Submit the order transaction');
    console.log('4. Monitor order execution');
    
  } catch (error) {
    console.error('\n❌ Error creating order:', (error as Error).message);
    console.log('\nThis usually means:');
    console.log('- Pool does not exist (create it first)');
    console.log('- Token accounts are not set up');
    console.log('- Insufficient balance');
  }
  
  // Test order status query
  console.log('\n=== Testing Order Query ===');
  try {
    const orderState = await client.getOrderState(user.publicKey, new BN(0));
    if (orderState) {
      console.log('Order found:', orderState);
    } else {
      console.log('No order found (expected for new account)');
    }
  } catch (error) {
    console.log('Order query result: No orders yet');
  }
  
  return {
    user,
    client,
    poolId,
    swapParams
  };
}

/**
 * Monitor order execution
 */
async function monitorOrder(
  client: ContinuumClient,
  user: PublicKey,
  sequence: BN
) {
  console.log('\n=== Monitoring Order ===');
  console.log('User:', user.toBase58());
  console.log('Sequence:', sequence.toString());
  
  let attempts = 0;
  const maxAttempts = 10;
  
  while (attempts < maxAttempts) {
    try {
      const orderState = await client.getOrderState(user, sequence);
      
      if (orderState) {
        console.log(`\nOrder Status: ${getStatusString(orderState.status)}`);
        
        if (orderState.status === 2) { // Executed
          console.log('✅ Order executed successfully!');
          if (orderState.executedAt) {
            console.log('Executed at:', new Date(orderState.executedAt.toNumber() * 1000));
          }
          break;
        } else if (orderState.status === 3) { // Cancelled
          console.log('❌ Order was cancelled');
          break;
        }
      } else {
        console.log('Waiting for order...');
      }
    } catch (error) {
      console.log('.');
    }
    
    attempts++;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

function getStatusString(status: number): string {
  switch (status) {
    case 0: return 'Pending';
    case 1: return 'Processing';
    case 2: return 'Executed';
    case 3: return 'Cancelled';
    default: return 'Unknown';
  }
}

// Run the example
if (require.main === module) {
  submitOrderExample()
    .then((result) => {
      console.log('\n✅ Order submission example completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Example failed:', error);
      process.exit(1);
    });
}

export { submitOrderExample, monitorOrder };