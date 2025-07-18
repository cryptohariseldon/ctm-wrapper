import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

export interface PoolConfig {
  poolId: string;
  ammConfig: string;
  tokenAMint: string;
  tokenBMint: string;
  tokenASymbol: string;
  tokenBSymbol: string;
  tokenADecimals: number;
  tokenBDecimals: number;
  tokenAVault: string;
  tokenBVault: string;
  observationState: string;
}

export interface RelayerConfig {
  connection: Connection;
  relayerKeypair: Keypair;
  continuumProgramId: PublicKey;
  cpSwapProgramId: PublicKey;
  pollIntervalMs: number;
  maxConcurrentExecutions: number;
  retryAttempts: number;
  retryDelayMs: number;
  
  // Server config
  port: number;
  host: string;
  
  // Pool configurations
  supportedPools: PoolConfig[];
  
  // Features
  enableMockMode: boolean;
  enableAirdrop: boolean;
  airdropAmountSol: number;
  airdropRateLimitMs: number;
  
  // Transaction settings
  priorityFeeLevel: 'none' | 'low' | 'medium' | 'high';
  computeUnitLimit: number;
  confirmationTimeoutMs: number;
}

function loadKeypair(path: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(path, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

// Default pool configuration from our successful test
const DEFAULT_POOL: PoolConfig = {
  poolId: 'F7wLNYJrsnxAC23tomtxLBCUEBaaovK3pRxwe4qektdb',
  ammConfig: 'EPyDg2LEJDdq3QKR1am2rawQtkBXbE4HFsWSMFvLwiHa',
  tokenAMint: '4PV5koSWtfu9C1keSMNNMooK14PQynNBz1YNPpSsJLJa', // WSOL
  tokenBMint: '914qoamoCDj7W3cN6192LPhfE3UMo3WVg5nqURb1LAPw', // USDC
  tokenASymbol: 'WSOL',
  tokenBSymbol: 'USDC',
  tokenADecimals: 9,
  tokenBDecimals: 6,
  tokenAVault: '4DuSHNmLGkSiQiVHAuQyu9uxqHbBx1DpSWgkPaBsveWC',
  tokenBVault: 'AZMSnpm9hkQZ8ZKQJdYTn3Tb9DPpSWYSZmr267dqdE9P',
  observationState: 'BnMncnpNemtfqUMPaXGZMpQcb6vFLgk8oZd8pQFT1dqT',
};

// Load pools from environment or use default
function loadPools(): PoolConfig[] {
  if (process.env.SUPPORTED_POOLS) {
    try {
      return JSON.parse(process.env.SUPPORTED_POOLS);
    } catch (e) {
      console.warn('Failed to parse SUPPORTED_POOLS, using default pool');
      return [DEFAULT_POOL];
    }
  }
  return [DEFAULT_POOL];
}

export const config: RelayerConfig = {
  connection: new Connection(
    process.env.RPC_URL || 'http://localhost:8899',
    {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000,
    }
  ),
  relayerKeypair: loadKeypair(
    process.env.RELAYER_KEYPAIR_PATH || './relayer-keypair.json'
  ),
  continuumProgramId: new PublicKey(
    process.env.CONTINUUM_PROGRAM_ID || 'EaeWUSam5Li1fzCcCs33oE4jCLQT4F6RJXgrPYZaoKqq'
  ),
  cpSwapProgramId: new PublicKey(
    process.env.CP_SWAP_PROGRAM_ID || 'GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp'
  ),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '1000'),
  maxConcurrentExecutions: parseInt(process.env.MAX_CONCURRENT_EXECUTIONS || '5'),
  retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3'),
  retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || '1000'),
  
  // Server config
  port: parseInt(process.env.PORT || '8085'),
  host: process.env.HOST || '0.0.0.0',
  
  // Pool configurations
  supportedPools: loadPools(),
  
  // Features
  enableMockMode: process.env.ENABLE_MOCK_MODE === 'true',
  enableAirdrop: process.env.ENABLE_AIRDROP !== 'false', // default true for localnet
  airdropAmountSol: parseFloat(process.env.AIRDROP_AMOUNT_SOL || '1'),
  airdropRateLimitMs: parseInt(process.env.AIRDROP_RATE_LIMIT_MS || '60000'), // 1 minute
  
  // Transaction settings
  priorityFeeLevel: (process.env.PRIORITY_FEE_LEVEL as any) || 'medium',
  computeUnitLimit: parseInt(process.env.COMPUTE_UNIT_LIMIT || '400000'),
  confirmationTimeoutMs: parseInt(process.env.CONFIRMATION_TIMEOUT_MS || '60000'),
};