#!/usr/bin/env ts-node
import { Connection, PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

const connection = new Connection('http://localhost:8899', 'confirmed');

// Known discriminators from various sources
const discriminators = {
  create_amm_config_expected: [137, 52, 237, 212, 215, 117, 108, 104],
  create_amm_config_old: [72, 186, 156, 243, 103, 195, 75, 79],
  initialize: [175, 175, 109, 31, 13, 152, 155, 237],
  swap_base_input: [143, 190, 90, 218, 196, 30, 51, 222],
  actual_amm_config: [218, 244, 33, 104, 203, 203, 43, 111] // From the actual account
};

async function checkDiscriminators() {
  console.log('Checking discriminators...\n');
  
  // Check existing AMM config
  const ammConfig = new PublicKey('5XoBUe5w3xSjRMgaPSwyA2ujH7eBBH5nD5L9H2ws841B');
  const accountInfo = await connection.getAccountInfo(ammConfig);
  
  if (accountInfo) {
    console.log('AMM Config Account:');
    console.log('Owner:', accountInfo.owner.toBase58());
    console.log('Length:', accountInfo.data.length);
    
    // Get first 8 bytes as discriminator
    const discriminator = Array.from(accountInfo.data.slice(0, 8));
    console.log('Discriminator:', discriminator);
    console.log('Hex:', Buffer.from(discriminator).toString('hex'));
    
    // Check if it matches any known discriminator
    Object.entries(discriminators).forEach(([name, disc]) => {
      if (JSON.stringify(disc) === JSON.stringify(discriminator)) {
        console.log(`✅ Matches: ${name}`);
      }
    });
    
    // Parse the rest of the data
    if (accountInfo.data.length >= 236) {
      const data = accountInfo.data;
      
      // Try to parse as AMM config struct
      let offset = 8; // Skip discriminator
      
      // index: u16
      const index = new BN(data.slice(offset, offset + 2), 'le').toNumber();
      offset += 2;
      
      // owner: Pubkey (32 bytes) - but this might be padding
      offset += 6; // Skip padding
      
      // trade_fee_rate: u64
      const tradeFeeRate = new BN(data.slice(offset, offset + 8), 'le').toString();
      offset += 8;
      
      // protocol_fee_rate: u64
      const protocolFeeRate = new BN(data.slice(offset, offset + 8), 'le').toString();
      offset += 8;
      
      // fund_fee_rate: u64
      const fundFeeRate = new BN(data.slice(offset, offset + 8), 'le').toString();
      offset += 8;
      
      console.log('\nParsed data:');
      console.log('Index:', index);
      console.log('Trade fee rate:', tradeFeeRate);
      console.log('Protocol fee rate:', protocolFeeRate);
      console.log('Fund fee rate:', fundFeeRate);
    }
  }
  
  // Check pool
  const poolId = new PublicKey('Gdpa1W2qH8Q5XxXmt5pm3VNwcYdgtAzT7GfFNxpLu683');
  const poolInfo = await connection.getAccountInfo(poolId);
  
  if (poolInfo) {
    console.log('\n\nPool Account:');
    console.log('Owner:', poolInfo.owner.toBase58());
    console.log('Length:', poolInfo.data.length);
    
    const poolDisc = Array.from(poolInfo.data.slice(0, 8));
    console.log('Discriminator:', poolDisc);
    console.log('Hex:', Buffer.from(poolDisc).toString('hex'));
  }
}

if (require.main === module) {
  checkDiscriminators()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}