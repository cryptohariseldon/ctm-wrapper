"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = __importDefault(require("express"));
var cors_1 = __importDefault(require("cors"));
var http_1 = require("http");
var ws_1 = require("ws");
var web3_js_1 = require("@solana/web3.js");
var fs = __importStar(require("fs"));
var dotenv = __importStar(require("dotenv"));
dotenv.config();
var app = (0, express_1.default)();
var server = (0, http_1.createServer)(app);
var wss = new ws_1.WebSocketServer({ server: server });
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Load or generate relayer keypair
var relayerKeypair;
var keypairPath = process.env.RELAYER_KEYPAIR_PATH || './relayer-keypair.json';
try {
    var keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
    relayerKeypair = web3_js_1.Keypair.fromSecretKey(new Uint8Array(keypairData));
    console.log('Loaded relayer keypair:', relayerKeypair.publicKey.toBase58());
}
catch (error) {
    relayerKeypair = web3_js_1.Keypair.generate();
    fs.writeFileSync(keypairPath, JSON.stringify(Array.from(relayerKeypair.secretKey)));
    console.log('Generated new relayer keypair:', relayerKeypair.publicKey.toBase58());
}
// Routes
app.get('/health', function (req, res) {
    res.json({
        status: 'healthy',
        relayer: relayerKeypair.publicKey.toBase58(),
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});
app.get('/api/v1/info', function (req, res) {
    res.json({
        relayerAddress: relayerKeypair.publicKey.toBase58(),
        continuumProgram: process.env.CONTINUUM_PROGRAM_ID || 'A548C9LR926hnAWvYDjsXJddidhfzLf3bRb8dmYPgRKn',
        cpSwapProgram: process.env.CP_SWAP_PROGRAM_ID || 'GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp',
        fee: 10,
        minOrderSize: '1000000',
        maxOrderSize: '1000000000000',
        supportedPools: [],
        performance: {
            successRate: 0.98,
            avgExecutionTime: 2500,
            totalOrders: 0
        }
    });
});
app.post('/api/v1/orders', function (req, res) {
    var _a = req.body, transaction = _a.transaction, poolId = _a.poolId, amountIn = _a.amountIn, minAmountOut = _a.minAmountOut, isBaseInput = _a.isBaseInput, userPublicKey = _a.userPublicKey;
    console.log('Received order submission:', {
        poolId: poolId,
        amountIn: amountIn,
        minAmountOut: minAmountOut,
        userPublicKey: userPublicKey
    });
    // Mock response
    res.json({
        success: true,
        orderId: "ord_".concat(Date.now()),
        orderPda: web3_js_1.Keypair.generate().publicKey.toBase58(),
        sequence: '1',
        estimatedExecutionTime: 5000,
        fee: '100000'
    });
});
app.get('/api/v1/orders/:orderId', function (req, res) {
    var orderId = req.params.orderId;
    // Mock response
    res.json({
        orderId: orderId,
        status: 'pending',
        sequence: '1',
        poolId: 'mock_pool',
        userPublicKey: 'mock_user',
        amountIn: '1000000000',
        createdAt: new Date().toISOString()
    });
});
app.get('/api/v1/pools', function (req, res) {
    res.json({
        pools: []
    });
});
app.get('/api/v1/stats', function (req, res) {
    res.json({
        totalOrders: 0,
        successfulOrders: 0,
        failedOrders: 0,
        successRate: 1,
        avgExecutionTime: 0,
        pendingOrders: 0,
        relayerBalance: 0
    });
});
// WebSocket handling
wss.on('connection', function (ws, req) {
    console.log('WebSocket connection established');
    ws.on('message', function (message) {
        console.log('WebSocket message:', message.toString());
    });
    ws.on('close', function () {
        console.log('WebSocket connection closed');
    });
});
// Start server
var PORT = process.env.PORT || 8085;
server.listen(PORT, function () {
    console.log("\uD83D\uDE80 Relayer server running on port ".concat(PORT));
    console.log("\uD83D\uDCE1 HTTP: http://localhost:".concat(PORT));
    console.log("\uD83D\uDD0C WebSocket: ws://localhost:".concat(PORT));
    console.log("\uD83D\uDC9A Health check: http://localhost:".concat(PORT, "/health"));
});
