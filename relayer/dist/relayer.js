"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketMonitor = exports.Relayer = void 0;
const bn_js_1 = __importDefault(require("bn.js"));
const cp_swap_sdk_1 = require("@continuum/cp-swap-sdk");
const logger_1 = require("./logger");
class Relayer {
    constructor(config) {
        this.isRunning = false;
        this.executingOrders = new Set();
        this.lastProcessedSequence = new bn_js_1.default(0);
        this.config = config;
        this.client = new cp_swap_sdk_1.ContinuumClient(config.connection);
    }
    async start() {
        this.isRunning = true;
        logger_1.logger.info('Relayer started');
        // Initialize last processed sequence
        const fifoState = await this.client.getFifoState();
        if (fifoState) {
            this.lastProcessedSequence = fifoState.currentSequence;
            logger_1.logger.info(`Starting from sequence: ${this.lastProcessedSequence.toString()}`);
        }
        // Start monitoring loop
        this.monitorOrders();
    }
    async stop() {
        this.isRunning = false;
        logger_1.logger.info('Relayer stopped');
    }
    async monitorOrders() {
        while (this.isRunning) {
            try {
                await this.processNextOrders();
            }
            catch (error) {
                logger_1.logger.error('Error in monitor loop:', error);
            }
            await this.sleep(this.config.pollIntervalMs);
        }
    }
    async processNextOrders() {
        const fifoState = await this.client.getFifoState();
        if (!fifoState) {
            logger_1.logger.warn('FIFO state not found');
            return;
        }
        // Check if there are new orders to process
        const currentSequence = fifoState.currentSequence;
        if (currentSequence.lte(this.lastProcessedSequence)) {
            return;
        }
        // Process orders in sequence
        const nextSequence = this.lastProcessedSequence.add(new bn_js_1.default(1));
        // Limit concurrent executions
        if (this.executingOrders.size >= this.config.maxConcurrentExecutions) {
            logger_1.logger.debug('Max concurrent executions reached, waiting...');
            return;
        }
        const orderKey = nextSequence.toString();
        if (this.executingOrders.has(orderKey)) {
            return;
        }
        // Find and execute the order
        this.executingOrders.add(orderKey);
        try {
            await this.findAndExecuteOrder(nextSequence);
            this.lastProcessedSequence = nextSequence;
        }
        catch (error) {
            logger_1.logger.error(`Failed to execute order ${orderKey}:`, error);
        }
        finally {
            this.executingOrders.delete(orderKey);
        }
    }
    async findAndExecuteOrder(sequence) {
        logger_1.logger.info(`Looking for order with sequence: ${sequence.toString()}`);
        // Get all order accounts and find the one with matching sequence
        // In production, use getProgramAccounts with filters
        const orders = await this.findOrderBySequence(sequence);
        if (orders.length === 0) {
            logger_1.logger.warn(`No order found with sequence ${sequence.toString()}`);
            return;
        }
        const orderAccount = orders[0];
        const orderState = await this.parseOrderState(orderAccount.account);
        if (!orderState || orderState.status !== cp_swap_sdk_1.OrderStatus.Pending) {
            logger_1.logger.info(`Order ${sequence.toString()} is not pending`);
            return;
        }
        logger_1.logger.info(`Executing order ${sequence.toString()} for user ${orderState.user.toBase58()}`);
        // Execute the order with retries
        await this.executeOrderWithRetry(orderState, orderAccount.pubkey);
    }
    async executeOrderWithRetry(orderState, orderPubkey) {
        let attempts = 0;
        while (attempts < this.config.retryAttempts) {
            try {
                // Get CP-Swap accounts for the pool
                const cpSwapAccounts = await this.getCpSwapAccounts(orderState.poolId);
                const params = {
                    executor: this.config.relayerKeypair.publicKey,
                    orderUser: orderState.user,
                    sequence: orderState.sequence,
                    poolId: orderState.poolId,
                    userSource: orderState.userSource, // These would need to be retrieved
                    userDestination: orderState.userDestination,
                    cpSwapRemainingAccounts: cpSwapAccounts,
                };
                const signature = await this.client.executeOrder(this.config.relayerKeypair, params);
                logger_1.logger.info(`Order ${orderState.sequence.toString()} executed successfully. Signature: ${signature}`);
                return;
            }
            catch (error) {
                attempts++;
                logger_1.logger.error(`Attempt ${attempts} failed for order ${orderState.sequence.toString()}:`, error);
                if (attempts < this.config.retryAttempts) {
                    await this.sleep(this.config.retryDelayMs);
                }
            }
        }
        logger_1.logger.error(`Failed to execute order ${orderState.sequence.toString()} after ${attempts} attempts`);
    }
    async findOrderBySequence(sequence) {
        // In production, implement proper account filtering
        // This is a placeholder
        return [];
    }
    async parseOrderState(accountInfo) {
        // Parse order state from account data
        // This would use the proper deserialization logic
        return null;
    }
    async getCpSwapAccounts(poolId) {
        // Get the required CP-Swap accounts for the pool
        // This would include pool state, vaults, etc.
        return [];
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.Relayer = Relayer;
// Monitor WebSocket for real-time updates
class WebSocketMonitor {
    constructor(connection) {
        this.connection = connection;
    }
    async subscribeToOrders(callback) {
        // Subscribe to program logs or account changes
        // This would monitor for OrderSubmitted events
        this.subscriptionId = this.connection.onLogs('all', (logs) => {
            // Parse logs for OrderSubmitted events
            if (logs.err)
                return;
            // Check if it's from our program
            if (logs.logs.some(log => log.includes('OrderSubmitted'))) {
                // Parse and call callback
                callback(logs);
            }
        });
    }
    async unsubscribe() {
        if (this.subscriptionId) {
            await this.connection.removeOnLogsListener(this.subscriptionId);
        }
    }
}
exports.WebSocketMonitor = WebSocketMonitor;
