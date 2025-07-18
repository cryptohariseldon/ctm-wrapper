#!/usr/bin/env ts-node
import { PublicKey } from '@solana/web3.js';

const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');
const ammConfig = new PublicKey('5XoBUe5w3xSjRMgaPSwyA2ujH7eBBH5nD5L9H2ws841B');
const wsolMint = new PublicKey('4PV5koSWtfu9C1keSMNNMooK14PQynNBz1YNPpSsJLJa');
const usdcMint = new PublicKey('914qoamoCDj7W3cN6192LPhfE3UMo3WVg5nqURb1LAPw');

// CP-Swap requires token0 < token1
let token0Mint = wsolMint;
let token1Mint = usdcMint;
if (usdcMint.toBuffer().compare(wsolMint.toBuffer()) < 0) {
  token0Mint = usdcMint;
  token1Mint = wsolMint;
}

const [poolId] = PublicKey.findProgramAddressSync(
  [Buffer.from('pool'), ammConfig.toBuffer(), token0Mint.toBuffer(), token1Mint.toBuffer()],
  CP_SWAP_PROGRAM_ID
);

console.log('Expected pool ID:', poolId.toBase58());
console.log('Token0:', token0Mint.toBase58());
console.log('Token1:', token1Mint.toBase58());
console.log('From config:', '9f6YawXzHNjvez1hgv8YdKwFb3iKUx7RAd66n51Z4oYq');