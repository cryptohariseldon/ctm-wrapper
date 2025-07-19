"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RelayerService = void 0;
const web3_js_1 = require("@solana/web3.js");
const anchor_1 = require("@coral-xyz/anchor");
const events_1 = require("events");
const config_1 = require("./config");
const spl_token_1 = require("@solana/spl-token");
class RelayerService extends events_1.EventEmitter {
    constructor(connection, relayerWallet, continuumProgramId, cpSwapProgramId, logger) {
        super();
        this.connection = connection;
        this.relayerWallet = relayerWallet;
        this.continuumProgramId = continuumProgramId;
        this.cpSwapProgramId = cpSwapProgramId;
        this.logger = logger;
        this.orders = new Map();
        this.executionQueue = [];
        this.isRunning = false;
        this.stats = {
            totalOrders: 0,
            successfulOrders: 0,
            failedOrders: 0,
            totalExecutionTime: 0,
        };
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
    async submitOrder(params) {
        const orderId = `ord_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const sequence = new anchor_1.BN(this.stats.totalOrders + 1);
        // Create order status
        const orderStatus = {
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
        const [orderPda] = web3_js_1.PublicKey.findProgramAddressSync([
            Buffer.from('order'),
            params.userPublicKey.toBuffer(),
            sequence.toArrayLike(Buffer, 'le', 8)
        ], this.continuumProgramId);
        const result = {
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
    async getOrderStatus(orderId) {
        return this.orders.get(orderId) || null;
    }
    async cancelOrder(orderId, signature) {
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
    getSupportedPools() {
        return config_1.config.supportedPools.map(pool => pool.poolId);
    }
    async getSupportedPoolsWithInfo() {
        return config_1.config.supportedPools.map(pool => ({
            poolId: pool.poolId,
            token0: pool.tokenAMint,
            token1: pool.tokenBMint,
            fee: 0.0025, // 0.25% fee
            liquidity: '1000000000000', // Placeholder
            volume24h: '0', // Placeholder
            isActive: true,
        }));
    }
    getSuccessRate() {
        if (this.stats.totalOrders === 0)
            return 1;
        return this.stats.successfulOrders / this.stats.totalOrders;
    }
    getAvgExecutionTime() {
        if (this.stats.successfulOrders === 0)
            return 0;
        return this.stats.totalExecutionTime / this.stats.successfulOrders;
    }
    getTotalOrders() {
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
    async executionLoop() {
        while (this.isRunning) {
            if (this.executionQueue.length > 0) {
                const orderId = this.executionQueue.shift();
                await this.executeOrder(orderId);
            }
            // Wait before next check
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    async executeOrder(orderId) {
        const order = this.orders.get(orderId);
        if (!order || order.status !== 'pending')
            return;
        const startTime = Date.now();
        try {
            this.logger.info('Executing order', { orderId, sequence: order.sequence });
            // Use mock mode for localnet or if explicitly enabled
            if (config_1.config.enableMockMode && !config_1.config.isDevnet) {
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
                let signature;
                // Handle both legacy and versioned transactions
                if (order.transaction instanceof web3_js_1.VersionedTransaction) {
                    // For versioned transactions, we need to add the relayer's signature
                    const messageV0 = order.transaction.message;
                    const signers = [this.relayerWallet];
                    // Check if relayer needs to sign
                    const relayerIndex = messageV0.staticAccountKeys.findIndex(key => key.equals(this.relayerWallet.publicKey));
                    if (relayerIndex !== -1 && !order.transaction.signatures[relayerIndex]) {
                        // Add relayer signature
                        order.transaction.sign([this.relayerWallet]);
                    }
                    signature = await this.connection.sendTransaction(order.transaction, {
                        skipPreflight: false,
                        preflightCommitment: 'confirmed'
                    });
                }
                else {
                    // Legacy transaction
                    const transaction = order.transaction;
                    // Check if relayer needs to sign
                    const needsRelayerSig = transaction.signatures.some(sig => sig.publicKey.equals(this.relayerWallet.publicKey) && !sig.signature);
                    if (needsRelayerSig) {
                        // Add relayer signature
                        transaction.partialSign(this.relayerWallet);
                    }
                    // Send transaction
                    signature = await this.connection.sendRawTransaction(transaction.serialize(), {
                        skipPreflight: false,
                        preflightCommitment: 'confirmed'
                    });
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
        }
        catch (error) {
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
    async buildSwapImmediateInstruction(poolId, user, amountIn, minAmountOut, isBaseInput, poolConfig) {
        // Derive PDAs
        const [fifoState] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('fifo_state')], this.continuumProgramId);
        const [poolAuthority, poolAuthorityBump] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('cp_pool_authority'), poolId.toBuffer()], this.continuumProgramId);
        const [cpSwapAuthority] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('vault_and_lp_mint_auth_seed')], this.cpSwapProgramId);
        // Get user token accounts
        const tokenAMint = new web3_js_1.PublicKey(poolConfig.tokenAMint);
        const tokenBMint = new web3_js_1.PublicKey(poolConfig.tokenBMint);
        const userTokenA = (0, spl_token_1.getAssociatedTokenAddressSync)(tokenAMint, user);
        const userTokenB = (0, spl_token_1.getAssociatedTokenAddressSync)(tokenBMint, user);
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
        return new web3_js_1.TransactionInstruction({
            keys: [
                // Required accounts for Continuum
                { pubkey: fifoState, isSigner: false, isWritable: true },
                { pubkey: this.cpSwapProgramId, isSigner: false, isWritable: false },
                // Remaining accounts for CP-Swap CPI - user must be first
                { pubkey: user, isSigner: true, isWritable: false },
                { pubkey: cpSwapAuthority, isSigner: false, isWritable: false },
                { pubkey: new web3_js_1.PublicKey(poolConfig.ammConfig), isSigner: false, isWritable: false },
                { pubkey: poolId, isSigner: false, isWritable: true },
                { pubkey: userSourceToken, isSigner: false, isWritable: true },
                { pubkey: userDestToken, isSigner: false, isWritable: true },
                { pubkey: new web3_js_1.PublicKey(poolConfig.tokenAVault), isSigner: false, isWritable: true },
                { pubkey: new web3_js_1.PublicKey(poolConfig.tokenBVault), isSigner: false, isWritable: true },
                { pubkey: spl_token_1.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: spl_token_1.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: tokenAMint, isSigner: false, isWritable: false },
                { pubkey: tokenBMint, isSigner: false, isWritable: false },
                { pubkey: new web3_js_1.PublicKey(poolConfig.observationState), isSigner: false, isWritable: true },
            ],
            programId: this.continuumProgramId,
            data,
        });
    }
}
exports.RelayerService = RelayerService;
