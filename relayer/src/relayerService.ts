import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction, Commitment, ComputeBudgetProgram, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { EventEmitter } from 'events';
import winston from 'winston';
import { createExecuteOrderInstruction } from '@continuum/cp-swap-sdk';
import { config as relayerConfig } from './config';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';

interface OrderSubmission {
  transaction?: Transaction | VersionedTransaction;
  poolId: PublicKey;
  amountIn: string;
  minAmountOut: string;
  isBaseInput: boolean;
  userPublicKey: PublicKey;
}

interface OrderResult {
  orderId: string;
  orderPda: PublicKey;
  sequence: BN;
  estimatedExecutionTime: number;
  fee: string;
}

interface OrderStatus {
  orderId: string;
  status: 'pending' | 'executed' | 'failed' | 'cancelled';
  sequence: string;
  poolId: string;
  userPublicKey: string;
  amountIn: string;
  actualAmountOut?: string;
  executionPrice?: number;
  signature?: string;
  executedAt?: string;
  error?: string;
  transaction?: Transaction | VersionedTransaction;
  minAmountOut?: string;
  isBaseInput?: boolean;
}

interface PoolInfo {
  poolId: string;
  token0: string;
  token1: string;
  fee: number;
  liquidity: string;
  volume24h: string;
  isActive: boolean;
}

export class RelayerService extends EventEmitter {
  private orders: Map<string, OrderStatus> = new Map();
  private executionQueue: string[] = [];
  private isRunning = false;
  private stats = {
    totalOrders: 0,
    successfulOrders: 0,
    failedOrders: 0,
    totalExecutionTime: 0,
  };

  constructor(
    private connection: Connection,
    private relayerWallet: Keypair,
    private continuumProgramId: PublicKey,
    private cpSwapProgramId: PublicKey,
    private logger: winston.Logger
  ) {
    super();
  }

  async start() {
    this.isRunning = true;
    this.logger.info('Relayer service started');
    
    // Start execution loop
    this.executionLoop();
  }

  async stop() {
    this.isRunning = false;
    this.logger.info('Relayer service stopped');
  }

  async submitOrder(params: OrderSubmission): Promise<OrderResult> {
    const orderId = `ord_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const sequence = new BN(this.stats.totalOrders + 1);
    
    // Create order status
    const orderStatus: OrderStatus = {
      orderId,
      status: 'pending',
      sequence: sequence.toString(),
      poolId: params.poolId.toBase58(),
      userPublicKey: params.userPublicKey.toBase58(),
      amountIn: params.amountIn,
      minAmountOut: params.minAmountOut,
      isBaseInput: params.isBaseInput,
      transaction: params.transaction,
    };
    
    this.orders.set(orderId, orderStatus);
    this.executionQueue.push(orderId);
    this.stats.totalOrders++;
    
    // Calculate PDA (mock)
    const [orderPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('order'),
        params.userPublicKey.toBuffer(),
        sequence.toArrayLike(Buffer, 'le', 8)
      ],
      this.continuumProgramId
    );
    
    const result: OrderResult = {
      orderId,
      orderPda,
      sequence,
      estimatedExecutionTime: 5000, // 5 seconds estimate
      fee: '100000', // 0.0001 SOL
    };
    
    this.logger.info('Order submitted', {
      orderId,
      sequence: sequence.toString(),
      poolId: params.poolId.toBase58(),
    });
    
    return result;
  }

  async getOrderStatus(orderId: string): Promise<OrderStatus | null> {
    return this.orders.get(orderId) || null;
  }

  async cancelOrder(orderId: string, signature: string): Promise<{ refund: string }> {
    const order = this.orders.get(orderId);
    
    if (!order) {
      throw new Error('Order not found');
    }
    
    if (order.status !== 'pending') {
      throw new Error('Can only cancel pending orders');
    }
    
    // TODO: Verify signature
    
    order.status = 'cancelled';
    
    // Remove from execution queue
    const index = this.executionQueue.indexOf(orderId);
    if (index > -1) {
      this.executionQueue.splice(index, 1);
    }
    
    return { refund: '0' }; // No refund in this mock
  }

  getSupportedPools(): string[] {
    return relayerConfig.supportedPools.map(pool => pool.poolId);
  }

  async getSupportedPoolsWithInfo(): Promise<PoolInfo[]> {
    return relayerConfig.supportedPools.map(pool => ({
      poolId: pool.poolId,
      token0: pool.tokenAMint,
      token1: pool.tokenBMint,
      fee: 0.0025, // 0.25% fee
      liquidity: '1000000000000', // Placeholder
      volume24h: '0', // Placeholder
      isActive: true,
    }));
  }

  getSuccessRate(): number {
    if (this.stats.totalOrders === 0) return 1;
    return this.stats.successfulOrders / this.stats.totalOrders;
  }

  getAvgExecutionTime(): number {
    if (this.stats.successfulOrders === 0) return 0;
    return this.stats.totalExecutionTime / this.stats.successfulOrders;
  }

  getTotalOrders(): number {
    return this.stats.totalOrders;
  }

  async getStatistics() {
    return {
      totalOrders: this.stats.totalOrders,
      successfulOrders: this.stats.successfulOrders,
      failedOrders: this.stats.failedOrders,
      successRate: this.getSuccessRate(),
      avgExecutionTime: this.getAvgExecutionTime(),
      pendingOrders: this.executionQueue.length,
      relayerBalance: await this.connection.getBalance(this.relayerWallet.publicKey) / 1e9,
    };
  }

  private async executionLoop() {
    while (this.isRunning) {
      if (this.executionQueue.length > 0) {
        const orderId = this.executionQueue.shift()!;
        await this.executeOrder(orderId);
      }
      
      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  private async executeOrder(orderId: string) {
    const order = this.orders.get(orderId);
    if (!order || order.status !== 'pending') return;
    
    const startTime = Date.now();
    
    try {
      this.logger.info('Executing order', { orderId, sequence: order.sequence });
      
      // Use mock mode for localnet or if explicitly enabled
      if (relayerConfig.enableMockMode && !relayerConfig.isDevnet) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const signature = 'mock_' + Math.random().toString(36).substr(2, 9);
        order.status = 'executed';
        order.signature = signature;
        order.actualAmountOut = (parseInt(order.amountIn) * 0.98).toString();
        order.executionPrice = 0.98;
        order.executedAt = new Date().toISOString();
        
        const executionTime = Date.now() - startTime;
        this.stats.successfulOrders++;
        this.stats.totalExecutionTime += executionTime;
        
        this.logger.info('Order executed (mock)', {
          orderId,
          signature,
          executionTime,
        });
        
        this.emit('orderExecuted', orderId, {
          signature,
          executionPrice: order.executionPrice,
          actualAmountOut: order.actualAmountOut,
        });
        
        return;
      }
      
      // Use the submitted transaction if available
      if (order.transaction) {
        this.logger.info('Using submitted transaction');
        
        let signature: string;
        
        // Handle both legacy and versioned transactions
        if (order.transaction instanceof VersionedTransaction) {
          // For versioned transactions, we need to add the relayer's signature
          const messageV0 = order.transaction.message;
          const signers = [this.relayerWallet];
          
          // Check if relayer needs to sign
          const relayerIndex = messageV0.staticAccountKeys.findIndex(
            key => key.equals(this.relayerWallet.publicKey)
          );
          
          if (relayerIndex !== -1 && !order.transaction.signatures[relayerIndex]) {
            // Add relayer signature
            order.transaction.sign([this.relayerWallet]);
          }
          
          signature = await this.connection.sendTransaction(order.transaction, {
            skipPreflight: false,
            preflightCommitment: 'confirmed'
          });
        } else {
          // Legacy transaction
          const transaction = order.transaction as Transaction;
          
          // Check if relayer needs to sign
          const needsRelayerSig = transaction.signatures.some(
            sig => sig.publicKey.equals(this.relayerWallet.publicKey) && !sig.signature
          );
          
          if (needsRelayerSig) {
            // Add relayer signature
            transaction.partialSign(this.relayerWallet);
          }
          
          // Send transaction
          signature = await this.connection.sendRawTransaction(
            transaction.serialize(),
            {
              skipPreflight: false,
              preflightCommitment: 'confirmed'
            }
          );
        }
        
        // Wait for confirmation
        const latestBlockhash = await this.connection.getLatestBlockhash();
        const confirmationResult = await this.connection.confirmTransaction({
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
        }, 'confirmed');
        
        if (confirmationResult.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(confirmationResult.value.err)}`);
        }
        
        // Update order status
        order.status = 'executed';
        order.signature = signature;
        order.executedAt = new Date().toISOString();
        order.actualAmountOut = order.amountIn; // TODO: Parse from logs
        order.executionPrice = 1.0; // TODO: Calculate from actual swap
        
        const executionTime = Date.now() - startTime;
        this.stats.successfulOrders++;
        this.stats.totalExecutionTime += executionTime;
        
        this.logger.info('Order executed using submitted transaction', {
          orderId,
          signature,
          executionTime
        });
        
        this.emit('orderExecuted', orderId, {
          signature,
          executionPrice: order.executionPrice,
          actualAmountOut: order.actualAmountOut,
        });
        
        return;
      }
      
      // Fallback: build our own transaction if none provided
      this.logger.warn('No transaction provided, building our own');
      throw new Error('Transaction required for order execution');
      
    } catch (error) {
      order.status = 'failed';
      order.error = error instanceof Error ? error.message : String(error);
      this.stats.failedOrders++;
      
      this.logger.error('Order execution failed', {
        orderId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      this.emit('orderFailed', orderId, error);
    }
  }

  private async buildSwapImmediateInstruction(
    poolId: PublicKey,
    user: PublicKey,
    amountIn: BN,
    minAmountOut: BN,
    isBaseInput: boolean,
    poolConfig: any
  ): Promise<TransactionInstruction> {
    // Derive PDAs
    const [fifoState] = PublicKey.findProgramAddressSync(
      [Buffer.from('fifo_state')],
      this.continuumProgramId
    );

    const [poolAuthority, poolAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('cp_pool_authority'), poolId.toBuffer()],
      this.continuumProgramId
    );

    const [cpSwapAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault_and_lp_mint_auth_seed')],
      this.cpSwapProgramId
    );

    // Get user token accounts
    const tokenAMint = new PublicKey(poolConfig.tokenAMint);
    const tokenBMint = new PublicKey(poolConfig.tokenBMint);
    const userTokenA = getAssociatedTokenAddressSync(tokenAMint, user);
    const userTokenB = getAssociatedTokenAddressSync(tokenBMint, user);

    // Determine source and destination based on swap direction
    const userSourceToken = isBaseInput ? userTokenA : userTokenB;
    const userDestToken = isBaseInput ? userTokenB : userTokenA;

    // Build instruction data
    const discriminator = Buffer.from([175, 131, 44, 121, 171, 170, 38, 18]);
    const data = Buffer.concat([
      discriminator,
      amountIn.toArrayLike(Buffer, 'le', 8),
      minAmountOut.toArrayLike(Buffer, 'le', 8),
      Buffer.from([isBaseInput ? 1 : 0]),
      poolId.toBuffer(),
      Buffer.from([poolAuthorityBump]),
    ]);

    return new TransactionInstruction({
      keys: [
        // Required accounts for Continuum
        { pubkey: fifoState, isSigner: false, isWritable: true },
        { pubkey: this.cpSwapProgramId, isSigner: false, isWritable: false },
        
        // Remaining accounts for CP-Swap CPI - user must be first
        { pubkey: user, isSigner: true, isWritable: false },
        { pubkey: cpSwapAuthority, isSigner: false, isWritable: false },
        { pubkey: new PublicKey(poolConfig.ammConfig), isSigner: false, isWritable: false },
        { pubkey: poolId, isSigner: false, isWritable: true },
        { pubkey: userSourceToken, isSigner: false, isWritable: true },
        { pubkey: userDestToken, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(poolConfig.tokenAVault), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(poolConfig.tokenBVault), isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: tokenAMint, isSigner: false, isWritable: false },
        { pubkey: tokenBMint, isSigner: false, isWritable: false },
        { pubkey: new PublicKey(poolConfig.observationState), isSigner: false, isWritable: true },
      ],
      programId: this.continuumProgramId,
      data,
    });
  }
}