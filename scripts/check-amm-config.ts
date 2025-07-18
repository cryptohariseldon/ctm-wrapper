#!/usr/bin/env ts-node
import { Connection, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Keypair } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

async function checkAmmConfig() {
  const connection = new Connection('http://localhost:8899', 'confirmed');
  
  // Load payer keypair
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/home/ubuntu/.config/solana/id.json', 'utf8')))
  );
  
  const wallet = new Wallet(payerKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  
  // Load the program IDL
  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, '../raydium-cp-swap/target/idl/raydium_cp_swap.json'), 'utf8'));
  const programId = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');
  const program = new Program(idl, programId, provider);
  
  const ammConfig = new PublicKey('5XoBUe5w3xSjRMgaPSwyA2ujH7eBBH5nD5L9H2ws841B');
  
  console.log('Checking AMM Config:', ammConfig.toBase58());
  
  try {
    // Try to fetch the AMM config account
    const configAccount = await program.account.ammConfig.fetch(ammConfig);
    console.log('AMM Config exists!');
    console.log('Owner:', configAccount.owner.toBase58());
    console.log('Index:', configAccount.index);
    console.log('Trade Fee Rate:', configAccount.tradeFeeRate.toString());
    console.log('Protocol Fee Rate:', configAccount.protocolFeeRate.toString());
    console.log('Fund Fee Rate:', configAccount.fundFeeRate.toString());
    console.log('Create Pool Fee:', configAccount.createPoolFee.toString());
  } catch (err) {
    console.error('Error fetching AMM config:', err.message);
    
    // Check raw account info
    const accountInfo = await connection.getAccountInfo(ammConfig);
    if (accountInfo) {
      console.log('\nRaw account info:');
      console.log('Owner:', accountInfo.owner.toBase58());
      console.log('Data length:', accountInfo.data.length);
      console.log('First 32 bytes:', accountInfo.data.slice(0, 32).toString('hex'));
    }
  }
}

if (require.main === module) {
  checkAmmConfig()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}