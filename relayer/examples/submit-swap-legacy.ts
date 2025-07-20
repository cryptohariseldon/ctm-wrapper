#!/usr/bin/env ts-node
/**
 * LEGACY VERSION - Without relayer co-signing
 * This version will NOT work with the updated program that requires relayer signatures.
 * Use submit-swap.ts for the updated dual-signing version.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN, Idl } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import axios from 'axios';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

// Configuration
const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:8085';
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

// Program IDs
const CONTINUUM_PROGRAM_ID = new PublicKey('9tcAhE4XGcZZTE8ez1EW8FF7rxyBN8uat2kkepgaeyEa');
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

console.log(`
⚠️  WARNING: This is the LEGACY version without relayer co-signing.
⚠️  It will NOT work with the updated program that requires dual signatures.
⚠️  Use submit-swap.ts for the current implementation.
`);

// Rest of the legacy implementation...
// (This would contain the old implementation without relayer as a signer)