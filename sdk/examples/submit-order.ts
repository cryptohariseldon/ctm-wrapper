import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { ContinuumClient, SwapParams } from '../src';
import BN from 'bn.js';

async function submitSwapOrder() {
  // Connect to localnet
  const connection = new Connection('http://localhost:8899', 'confirmed');
  
  // Initialize client
  const client = new ContinuumClient(connection);
  
  // User keypair (in production, this would be the user's wallet)
  const user = Keypair.generate();
  
  // Swap parameters
  const swapParams: SwapParams = {
    poolId: new PublicKey('YOUR_POOL_ID_HERE'),
    amountIn: new BN(1000000), // 1 token (assuming 6 decimals)
    minAmountOut: new BN(950000), // Minimum 0.95 tokens out (5% slippage)
    isBaseInput: true,
    userSourceToken: new PublicKey('USER_SOURCE_TOKEN_ACCOUNT'),
    userDestinationToken: new PublicKey('USER_DESTINATION_TOKEN_ACCOUNT'),
  };
  
  try {
    // Submit the order
    const { signature, sequence } = await client.submitOrder(user, swapParams);
    
    console.log('Order submitted successfully!');
    console.log('Transaction signature:', signature);
    console.log('Order sequence:', sequence.toString());
    
    // Check order status
    const orderState = await client.getOrderState(user.publicKey, sequence);
    console.log('Order state:', orderState);
    
  } catch (error) {
    console.error('Error submitting order:', error);
  }
}

// Example of creating a partially signed transaction for a relayer
async function createPartiallySignedOrder() {
  const connection = new Connection('http://localhost:8899', 'confirmed');
  const client = new ContinuumClient(connection);
  
  const user = new PublicKey('USER_PUBKEY_HERE');
  
  const swapParams: SwapParams = {
    poolId: new PublicKey('YOUR_POOL_ID_HERE'),
    amountIn: new BN(1000000),
    minAmountOut: new BN(950000),
    isBaseInput: true,
    userSourceToken: new PublicKey('USER_SOURCE_TOKEN_ACCOUNT'),
    userDestinationToken: new PublicKey('USER_DESTINATION_TOKEN_ACCOUNT'),
  };
  
  // Create partially signed transaction
  const { transaction, sequence } = await client.createPartiallySignedSubmitOrder(
    user,
    swapParams
  );
  
  // Serialize the transaction
  const serializedTx = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  
  console.log('Partially signed transaction:', serializedTx.toString('base64'));
  console.log('Expected sequence:', sequence.toString());
  
  // This transaction can now be sent to the user for signing
  // The user signs it and sends it back to the relayer
  // The relayer then submits it to the network
}

// Run examples
if (require.main === module) {
  submitSwapOrder().catch(console.error);
}