#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction, 
  SystemProgram, 
  sendAndConfirmTransaction
} from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';

const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');
const AMM_CONFIG_SEED = Buffer.from('amm_config');

async function recreateAmmConfig() {
  const connection = new Connection('http://localhost:8899', 'confirmed');
  
  // Load payer keypair
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(require('fs').readFileSync('/home/ubuntu/.config/solana/id.json', 'utf8')))
  );
  
  console.log('Recreating AMM Config...');
  console.log('Payer:', payerKeypair.publicKey.toBase58());
  
  // Try different indices until we find one that works
  for (let index = 1; index <= 5; index++) {
    const [ammConfig] = PublicKey.findProgramAddressSync(
      [AMM_CONFIG_SEED, new BN(index).toArrayLike(Buffer, 'le', 2)],
      CP_SWAP_PROGRAM_ID
    );
    
    console.log(`\nTrying index ${index}...`);
    console.log('AMM Config PDA:', ammConfig.toBase58());
    
    const accountInfo = await connection.getAccountInfo(ammConfig);
    if (!accountInfo) {
      console.log('Account does not exist, creating...');
      
      // Build create_amm_config instruction
      const discriminator = Buffer.from([137, 52, 237, 212, 215, 117, 108, 104]);
      
      const feeRate = 2500; // 0.25% fee
      const tickSpacing = 10;
      
      const data = Buffer.concat([
        discriminator,
        new BN(index).toArrayLike(Buffer, 'le', 2), // index as u16
        new BN(feeRate).toArrayLike(Buffer, 'le', 8), // trade_fee_rate as u64
        new BN(0).toArrayLike(Buffer, 'le', 8), // protocol_fee_rate as u64
        new BN(0).toArrayLike(Buffer, 'le', 8), // fund_fee_rate as u64
        new BN(0).toArrayLike(Buffer, 'le', 8), // create_pool_fee as u64
      ]);
      
      const instruction = new anchor.web3.TransactionInstruction({
        keys: [
          { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: ammConfig, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: CP_SWAP_PROGRAM_ID,
        data,
      });
      
      const tx = new Transaction().add(instruction);
      
      try {
        const sig = await sendAndConfirmTransaction(connection, tx, [payerKeypair]);
        console.log('✅ AMM Config created:', sig);
        console.log('AMM Config address:', ammConfig.toBase58());
        console.log('Index:', index);
        
        // Save this config
        const fs = require('fs');
        const path = require('path');
        const configPath = path.join(__dirname, '../config/amm-config.json');
        fs.writeFileSync(configPath, JSON.stringify({
          ammConfig: ammConfig.toBase58(),
          index: index,
          feeRate: feeRate,
          tickSpacing: tickSpacing
        }, null, 2));
        
        console.log('\nConfiguration saved to:', configPath);
        return ammConfig;
        
      } catch (err) {
        console.error('Error creating AMM config:', err.message);
      }
    } else {
      console.log('Account already exists, checking data...');
      console.log('Data length:', accountInfo.data.length);
      if (accountInfo.data.length > 8) {
        console.log('✅ Valid AMM config found at index', index);
        return ammConfig;
      }
    }
  }
  
  throw new Error('Could not create AMM config');
}

if (require.main === module) {
  recreateAmmConfig()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}