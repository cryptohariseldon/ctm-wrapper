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
exports.config = void 0;
const web3_js_1 = require("@solana/web3.js");
const dotenv = __importStar(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
dotenv.config();
function loadKeypair(path) {
    const secretKey = JSON.parse(fs_1.default.readFileSync(path, 'utf-8'));
    return web3_js_1.Keypair.fromSecretKey(Uint8Array.from(secretKey));
}
exports.config = {
    connection: new web3_js_1.Connection(process.env.RPC_URL || 'http://localhost:8899', {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000,
    }),
    relayerKeypair: loadKeypair(process.env.RELAYER_KEYPAIR_PATH || './relayer-keypair.json'),
    continuumProgramId: new web3_js_1.PublicKey(process.env.CONTINUUM_PROGRAM_ID || '7HHRc5fBYLg6zaAGq2K5VE3bwhq39ZPXcPxumdHTyPg3'),
    cpSwapProgramId: new web3_js_1.PublicKey(process.env.CP_SWAP_PROGRAM_ID || 'GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp'),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '1000'),
    maxConcurrentExecutions: parseInt(process.env.MAX_CONCURRENT_EXECUTIONS || '5'),
    retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3'),
    retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || '1000'),
};
