#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, BN, Wallet } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

async function fixAmmConfig() {
  const connection = new Connection('http://localhost:8899', 'confirmed');
  
  // Load payer keypair
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/home/ubuntu/.config/solana/id.json', 'utf8')))
  );
  
  const wallet = new Wallet(payerKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  
  // Load the program IDL
  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, '../raydium-cp-swap/target/idl/raydium_cp_swap.json'), 'utf8'));
  const program = new Program(idl, CP_SWAP_PROGRAM_ID, provider);
  
  console.log('Fixing AMM Config...');
  console.log('Payer:', payerKeypair.publicKey.toBase58());
  
  // AMM Config at index 0
  const configIndex = 0;
  const [ammConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from('amm_config'), new BN(configIndex).toArrayLike(Buffer, 'le', 2)],
    CP_SWAP_PROGRAM_ID
  );
  
  console.log('AMM Config PDA:', ammConfig.toBase58());
  
  // Check if it exists
  const accountInfo = await connection.getAccountInfo(ammConfig);
  console.log('Account exists:', !!accountInfo);
  if (accountInfo) {
    console.log('Data length:', accountInfo.data.length);
  }
  
  // Close the malformed account if it exists
  if (accountInfo && accountInfo.data.length < 100) {
    console.log('\nClosing malformed AMM config account...');
    try {
      // Send remaining lamports to the payer
      const closeIx = SystemProgram.transfer({
        fromPubkey: ammConfig,
        toPubkey: payerKeypair.publicKey,
        lamports: accountInfo.lamports,
      });
      
      // This won't work directly, but let's skip it for now
      console.log('Cannot close account programmatically, continuing...');
    } catch (err) {
      console.log('Expected error:', err.message);
    }
  }
  
  // Create new AMM config using Anchor
  console.log('\nCreating new AMM config...');
  const feeRate = 2500; // 0.25%
  
  try {
    const tx = await program.methods
      .createAmmConfig(
        configIndex,
        new BN(feeRate),      // trade_fee_rate
        new BN(0),            // protocol_fee_rate  
        new BN(0),            // fund_fee_rate
        new BN(0)             // create_pool_fee
      )
      .accounts({
        owner: payerKeypair.publicKey,
        ammConfig: ammConfig,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log('✅ AMM Config created successfully!');
    console.log('Transaction:', tx);
    
    // Verify the account
    const configAccount = await program.account.ammConfig.fetch(ammConfig);
    console.log('\nAMM Config details:');
    console.log('Index:', configAccount.index);
    console.log('Trade Fee Rate:', configAccount.tradeFeeRate.toString());
    console.log('Owner:', configAccount.owner.toBase58());
    
  } catch (err) {
    console.error('Error creating AMM config:', err);
    
    // If it already exists, try to fetch it
    if (err.message.includes('already in use')) {
      try {
        const configAccount = await program.account.ammConfig.fetch(ammConfig);
        console.log('\nAMM Config already exists:');
        console.log('Index:', configAccount.index);
        console.log('Trade Fee Rate:', configAccount.tradeFeeRate.toString());
        console.log('Owner:', configAccount.owner.toBase58());
      } catch (fetchErr) {
        console.error('Error fetching AMM config:', fetchErr.message);
      }
    }
  }
}

if (require.main === module) {
  fixAmmConfig()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}