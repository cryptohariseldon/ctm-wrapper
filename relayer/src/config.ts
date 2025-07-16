import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

export interface RelayerConfig {
  connection: Connection;
  relayerKeypair: Keypair;
  continuumProgramId: PublicKey;
  cpSwapProgramId: PublicKey;
  pollIntervalMs: number;
  maxConcurrentExecutions: number;
  retryAttempts: number;
  retryDelayMs: number;
}

function loadKeypair(path: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(path, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
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
    process.env.CONTINUUM_PROGRAM_ID || '7HHRc5fBYLg6zaAGq2K5VE3bwhq39ZPXcPxumdHTyPg3'
  ),
  cpSwapProgramId: new PublicKey(
    process.env.CP_SWAP_PROGRAM_ID || 'GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp'
  ),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '1000'),
  maxConcurrentExecutions: parseInt(process.env.MAX_CONCURRENT_EXECUTIONS || '5'),
  retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3'),
  retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || '1000'),
};