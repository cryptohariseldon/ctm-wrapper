/**
 * Example client integration for Continuum Relayer
 * This demonstrates how to submit orders to the relayer service
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import WebSocket from 'ws';

// Configuration
const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:8080';
const RPC_URL = process.env.RPC_URL || 'http://localhost:8899';

interface OrderSubmissionParams {
  poolId: PublicKey;
  amountIn: BN;
  minAmountOut: BN;
  isBaseInput: boolean;
  userWallet: Keypair;
}

class ContinuumRelayerClient {
  private relayerUrl: string;
  private connection: Connection;

  constructor(relayerUrl: string, rpcUrl: string) {
    this.relayerUrl = relayerUrl;
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Get relayer information
   */
  async getRelayerInfo() {
    const response = await fetch(`${this.relayerUrl}/api/v1/info`);
    if (!response.ok) {
      throw new Error(`Failed to get relayer info: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Submit an order to the relayer
   */
  async submitOrder(params: OrderSubmissionParams) {
    console.log('Submitting order:', {
      poolId: params.poolId.toBase58(),
      amountIn: params.amountIn.toString(),
      minAmountOut: params.minAmountOut.toString(),
      isBaseInput: params.isBaseInput,
    });

    // Build partial transaction
    const transaction = await this.buildPartialTransaction(params);

    // User signs the transaction
    transaction.partialSign(params.userWallet);

    // Submit to relayer
    const response = await fetch(`${this.relayerUrl}/api/v1/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
        poolId: params.poolId.toBase58(),
        amountIn: params.amountIn.toString(),
        minAmountOut: params.minAmountOut.toString(),
        isBaseInput: params.isBaseInput,
        userPublicKey: params.userWallet.publicKey.toBase58(),
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Relayer error: ${error.error || response.statusText}`);
    }

    const result = await response.json();
    console.log('Order submitted successfully:', result);

    return result;
  }

  /**
   * Build a partial transaction for order submission
   * In a real implementation, this would use the Continuum SDK
   */
  private async buildPartialTransaction(params: OrderSubmissionParams): Promise<Transaction> {
    const transaction = new Transaction();
    
    // Add Continuum submit order instruction
    // This is a placeholder - use actual Continuum SDK in production
    const instruction = SystemProgram.transfer({
      fromPubkey: params.userWallet.publicKey,
      toPubkey: params.userWallet.publicKey, // Placeholder
      lamports: 1, // Placeholder
    });

    transaction.add(instruction);

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;

    // Set fee payer to user
    transaction.feePayer = params.userWallet.publicKey;

    return transaction;
  }

  /**
   * Get order status
   */
  async getOrderStatus(orderId: string) {
    const response = await fetch(`${this.relayerUrl}/api/v1/orders/${orderId}`);
    if (!response.ok) {
      throw new Error(`Failed to get order status: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Subscribe to order updates via WebSocket
   */
  subscribeToOrder(orderId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.relayerUrl.replace('http', 'ws')}/ws/orders/${orderId}`);

      ws.on('open', () => {
        console.log(`WebSocket connected for order ${orderId}`);
      });

      ws.on('message', (data) => {
        const update = JSON.parse(data.toString());
        console.log('Order update:', update);

        if (update.status === 'executed') {
          console.log('Order executed successfully!');
          console.log('Signature:', update.signature);
          console.log('Actual amount out:', update.actualAmountOut);
          ws.close();
          resolve(update);
        } else if (update.status === 'failed') {
          console.error('Order execution failed:', update.error);
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
    });
  }

  /**
   * Cancel a pending order
   */
  async cancelOrder(orderId: string, userWallet: Keypair) {
    // Sign a cancellation message
    const message = `Cancel order ${orderId}`;
    const messageBytes = new TextEncoder().encode(message);
    const signature = userWallet.sign(messageBytes);

    const response = await fetch(`${this.relayerUrl}/api/v1/orders/${orderId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${Buffer.from(signature).toString('base64')}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to cancel order: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get supported pools
   */
  async getSupportedPools() {
    const response = await fetch(`${this.relayerUrl}/api/v1/pools`);
    if (!response.ok) {
      throw new Error(`Failed to get pools: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get relayer statistics
   */
  async getStatistics() {
    const response = await fetch(`${this.relayerUrl}/api/v1/stats`);
    if (!response.ok) {
      throw new Error(`Failed to get statistics: ${response.statusText}`);
    }
    return response.json();
  }
}

// Example usage
async function main() {
  try {
    // Initialize client
    const client = new ContinuumRelayerClient(RELAYER_URL, RPC_URL);

    // Get relayer info
    const info = await client.getRelayerInfo();
    console.log('Relayer info:', info);

    // Check supported pools
    const pools = await client.getSupportedPools();
    console.log('Supported pools:', pools);

    // Create a test wallet (in production, use actual user wallet)
    const userWallet = Keypair.generate();
    console.log('User wallet:', userWallet.publicKey.toBase58());

    // Airdrop SOL for testing (localnet only)
    if (RPC_URL.includes('localhost')) {
      const connection = new Connection(RPC_URL);
      const airdropSig = await connection.requestAirdrop(
        userWallet.publicKey,
        LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(airdropSig);
      console.log('Airdropped 1 SOL to user wallet');
    }

    // Submit an order
    const poolId = new PublicKey('BhPUKnKuzpEYNhSSNxkze51tMVza25rgXfEv5LWgGng2'); // Example pool
    const amountIn = new BN(1000000000); // 1 token with 9 decimals
    const minAmountOut = new BN(950000000); // 0.95 tokens (5% slippage)

    const orderResult = await client.submitOrder({
      poolId,
      amountIn,
      minAmountOut,
      isBaseInput: true,
      userWallet,
    });

    console.log('Order submitted:', orderResult);

    // Subscribe to updates
    console.log('Waiting for execution...');
    const executionResult = await client.subscribeToOrder(orderResult.orderId);
    console.log('Execution complete:', executionResult);

    // Check final status
    const finalStatus = await client.getOrderStatus(orderResult.orderId);
    console.log('Final order status:', finalStatus);

    // Get statistics
    const stats = await client.getStatistics();
    console.log('Relayer statistics:', stats);

  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the example
if (require.main === module) {
  main().then(() => {
    console.log('Example completed');
    process.exit(0);
  }).catch((error) => {
    console.error('Example failed:', error);
    process.exit(1);
  });
}

export { ContinuumRelayerClient };