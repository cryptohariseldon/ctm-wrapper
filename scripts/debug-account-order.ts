#!/usr/bin/env ts-node
import { PublicKey } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

// Load pool configuration
const poolConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/pool-final.json'), 'utf8'));

console.log('=== ACCOUNT ORDERING ANALYSIS ===\n');

console.log('1. CLIENT SENDS TO CONTINUUM (test-swap-config4.ts):');
console.log('   Instruction accounts:');
console.log('   [0] fifoState');
console.log('   [1] cpSwapProgram'); 
console.log('   [2] user (signer)');
console.log('   --- Remaining accounts for CPI ---');
console.log('   [3] poolAuthority (Continuum\'s cp_pool_authority PDA)');
console.log('   [4] CP-Swap authority PDA (vault_and_lp_mint_auth_seed)');
console.log('   [5] ammConfig:', poolConfig.ammConfig);
console.log('   [6] poolId:', poolConfig.poolId);
console.log('   [7] userSourceToken (USDC)');
console.log('   [8] userDestToken (WSOL)');
console.log('   [9] inputVault (USDC vault):', poolConfig.tokenBVault);
console.log('   [10] outputVault (WSOL vault):', poolConfig.tokenAVault);
console.log('   [11] TOKEN_PROGRAM_ID');
console.log('   [12] TOKEN_PROGRAM_ID');
console.log('   [13] sourceMint (USDC):', poolConfig.tokenBMint);
console.log('   [14] destMint (WSOL):', poolConfig.tokenAMint);
console.log('   [15] observationState:', poolConfig.observationState);

console.log('\n2. CONTINUUM PROCESSES (swap_immediate.rs):');
console.log('   - Takes accounts [0-2] for its own use');
console.log('   - Passes remaining_accounts [3-15] to CP-Swap');
console.log('   - Sets account[3] (poolAuthority) as signer in CPI');

console.log('\n3. CP-SWAP EXPECTS (swap_base_input):');
console.log('   [0] payer (signer) - Gets poolAuthority');
console.log('   [1] authority (vault_and_lp_mint_auth_seed PDA)');
console.log('   [2] amm_config');
console.log('   [3] pool_state');
console.log('   [4] input_token_account');
console.log('   [5] output_token_account');
console.log('   [6] input_vault');
console.log('   [7] output_vault');
console.log('   [8] input_token_program');
console.log('   [9] output_token_program');
console.log('   [10] input_token_mint');
console.log('   [11] output_token_mint');
console.log('   [12] observation_state');

console.log('\n4. MAPPING:');
console.log('   Continuum remaining[0] -> CP-Swap[0]: poolAuthority -> payer ✓');
console.log('   Continuum remaining[1] -> CP-Swap[1]: CP-Swap authority -> authority ✓');
console.log('   Continuum remaining[2] -> CP-Swap[2]: ammConfig -> amm_config ✓');
console.log('   Continuum remaining[3] -> CP-Swap[3]: poolId -> pool_state ✓');
console.log('   ...');

console.log('\nThe account order looks correct. The issue must be elsewhere.');