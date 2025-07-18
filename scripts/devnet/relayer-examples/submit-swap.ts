#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction 
} from '@solana/web3.js';
import { 
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID 
} from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:8085';
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

// Load constants
const constants = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../../constants.json'), 'utf8')
);
const config = constants.devnet;

async function getPoolPrice(poolId: string) {
  const response = await fetch(`${RELAYER_URL}/api/v1/pools/${poolId}/price`);
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || 'Failed to fetch pool price');
  }
  
  return data;
}

async function buildSwapInstruction(
  wallet: PublicKey,
  poolId: PublicKey,
  amountIn: BN,
  minAmountOut: BN,
  isBaseInput: boolean
) {
  const pool = config.pools['USDC-WSOL'];
  
  // Derive PDAs
  const [fifoState] = PublicKey.findProgramAddressSync(
    [Buffer.from('fifo_state')],
    new PublicKey(config.programs.continuum)
  );

  const [poolAuthority, poolAuthorityBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('cp_pool_authority'), poolId.toBuffer()],
    new PublicKey(config.programs.continuum)
  );

  const [cpSwapAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_and_lp_mint_auth_seed')],
    new PublicKey(config.programs.cpSwap)
  );

  // Get user token accounts
  const userTokenA = await getAssociatedTokenAddress(
    new PublicKey(pool.tokenAMint),
    wallet
  );
  const userTokenB = await getAssociatedTokenAddress(
    new PublicKey(pool.tokenBMint),
    wallet
  );

  // Build instruction data
  const discriminator = Buffer.from([175, 131, 44, 121, 171, 170, 38, 18]);
  const data = Buffer.concat([
    discriminator,
    amountIn.toArrayLike(Buffer, 'le', 8),
    minAmountOut.toArrayLike(Buffer, 'le', 8),
    Buffer.from([isBaseInput ? 1 : 0]),
    poolId.toBuffer(),
    Buffer.from([poolAuthorityBump]),
  ]);

  return {
    keys: [
      // Required accounts for Continuum
      { pubkey: fifoState, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(config.programs.cpSwap), isSigner: false, isWritable: false },
      
      // Remaining accounts for CP-Swap CPI
      { pubkey: wallet, isSigner: true, isWritable: false },
      { pubkey: cpSwapAuthority, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(pool.ammConfig), isSigner: false, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: userTokenA, isSigner: false, isWritable: true },
      { pubkey: userTokenB, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(pool.tokenAVault), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(pool.tokenBVault), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(pool.tokenAMint), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(pool.tokenBMint), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(pool.observationState), isSigner: false, isWritable: true },
    ],
    programId: new PublicKey(config.programs.continuum),
    data,
  };
}

async function submitSwapOrder(
  wallet: Keypair,
  amountIn: number,
  tokenIn: 'USDC' | 'WSOL',
  slippageBps: number = 100 // 1% default slippage
) {
  const pool = config.pools['USDC-WSOL'];
  const poolId = new PublicKey(pool.poolId);
  
  console.log(`\nPreparing to swap ${amountIn} ${tokenIn}...`);
  
  // Get current pool price
  console.log('Fetching pool price...');
  const priceData = await getPoolPrice(pool.poolId);
  console.log('Current prices:');
  console.log(`  1 USDC = ${priceData.price.USDCPerWSOL} WSOL`);
  console.log(`  1 WSOL = ${priceData.price.WSOLPerUSDC} USDC`);
  
  // Calculate amounts
  const isBaseInput = tokenIn === 'USDC';
  const decimalsIn = isBaseInput ? 6 : 9;
  const decimalsOut = isBaseInput ? 9 : 6;
  const amountInUnits = new BN(amountIn * Math.pow(10, decimalsIn));
  
  // Calculate expected output with slippage
  let expectedOut: number;
  if (isBaseInput) {
    expectedOut = amountIn * parseFloat(priceData.price.USDCPerWSOL);
  } else {
    expectedOut = amountIn * parseFloat(priceData.price.WSOLPerUSDC);
  }
  
  const minAmountOut = Math.floor(expectedOut * (1 - slippageBps / 10000));
  const minAmountOutUnits = new BN(minAmountOut * Math.pow(10, decimalsOut));
  
  console.log(`Expected output: ~${expectedOut.toFixed(4)} ${isBaseInput ? 'WSOL' : 'USDC'}`);
  console.log(`Min output (${slippageBps/100}% slippage): ${minAmountOut.toFixed(4)} ${isBaseInput ? 'WSOL' : 'USDC'}`);
  
  // Build transaction
  console.log('\nBuilding transaction...');
  const transaction = new Transaction();
  
  // Add compute budget if needed
  // transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }));
  
  // Add swap instruction
  const swapIx = await buildSwapInstruction(
    wallet.publicKey,
    poolId,
    amountInUnits,
    minAmountOutUnits,
    isBaseInput
  );
  transaction.add(swapIx);
  
  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = wallet.publicKey;
  
  // Sign transaction
  transaction.partialSign(wallet);
  
  // Serialize transaction
  const serialized = transaction.serialize({ requireAllSignatures: false }).toString('base64');
  
  // Submit to relayer
  console.log('\nSubmitting order to relayer...');
  const payload = {
    transaction: serialized,
    poolId: pool.poolId,
    amountIn: amountInUnits.toString(),
    minAmountOut: minAmountOutUnits.toString(),
    isBaseInput,
    userPublicKey: wallet.publicKey.toBase58()
  };
  
  const response = await fetch(`${RELAYER_URL}/api/v1/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  const result = await response.json();
  
  if (!response.ok) {
    throw new Error(result.error || 'Failed to submit order');
  }
  
  console.log('\n✅ Order submitted successfully!');
  console.log(`Order ID: ${result.orderId}`);
  console.log(`Sequence: ${result.sequence}`);
  console.log(`Order PDA: ${result.orderPda}`);
  console.log(`Estimated execution time: ${result.estimatedExecutionTime}ms`);
  
  // Poll for order status
  console.log('\nMonitoring order status...');
  let status = 'pending';
  let attempts = 0;
  const maxAttempts = 30; // 30 seconds timeout
  
  while (status === 'pending' && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    
    const statusResponse = await fetch(`${RELAYER_URL}/api/v1/orders/${result.orderId}`);
    const statusData = await statusResponse.json();
    
    status = statusData.status;
    attempts++;
    
    if (status === 'executed') {
      console.log('\n✅ Swap executed successfully!');
      console.log(`Signature: ${statusData.signature}`);
      console.log(`Actual output: ${parseFloat(statusData.actualAmountOut) / Math.pow(10, decimalsOut)} ${isBaseInput ? 'WSOL' : 'USDC'}`);
      console.log(`Execution price: ${statusData.executionPrice}`);
      console.log(`Executed at: ${statusData.executedAt}`);
      break;
    } else if (status === 'failed') {
      console.log('\n❌ Swap failed!');
      console.log(`Error: ${statusData.error}`);
      break;
    } else {
      process.stdout.write('.');
    }
  }
  
  if (status === 'pending') {
    console.log('\n⚠️  Order still pending after 30 seconds');
  }
  
  return result;
}

async function main() {
  // Load wallet
  const walletPath = process.env.WALLET_PATH || '/home/ubuntu/.config/solana/id.json';
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf8')))
  );
  
  console.log('Wallet:', wallet.publicKey.toBase58());
  console.log('Relayer URL:', RELAYER_URL);
  
  // Check balances
  console.log('\nChecking balances...');
  const pool = config.pools['USDC-WSOL'];
  const usdcAccount = await getAssociatedTokenAddress(
    new PublicKey(pool.tokenAMint),
    wallet.publicKey
  );
  const wsolAccount = await getAssociatedTokenAddress(
    new PublicKey(pool.tokenBMint),
    wallet.publicKey
  );
  
  try {
    const usdcBalance = await connection.getTokenAccountBalance(usdcAccount);
    const wsolBalance = await connection.getTokenAccountBalance(wsolAccount);
    console.log(`USDC: ${usdcBalance.value.uiAmount}`);
    console.log(`WSOL: ${wsolBalance.value.uiAmount}`);
  } catch (error) {
    console.log('Could not fetch token balances. Make sure you have token accounts.');
  }
  
  // Example swaps
  const swapType = process.argv[2] || 'usdc-to-wsol';
  const amount = parseFloat(process.argv[3] || '10');
  
  try {
    if (swapType === 'usdc-to-wsol') {
      // Swap USDC to WSOL
      await submitSwapOrder(wallet, amount, 'USDC');
    } else if (swapType === 'wsol-to-usdc') {
      // Swap WSOL to USDC
      await submitSwapOrder(wallet, amount, 'WSOL');
    } else {
      console.error('Invalid swap type. Use "usdc-to-wsol" or "wsol-to-usdc"');
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  console.log('Usage: ./submit-swap.ts [usdc-to-wsol|wsol-to-usdc] [amount]');
  console.log('Example: ./submit-swap.ts usdc-to-wsol 100');
  console.log('Example: ./submit-swap.ts wsol-to-usdc 1');
  main().catch(console.error);
}

export { submitSwapOrder };