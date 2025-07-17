import * as anchor from '@coral-xyz/anchor';
import { Program, BN, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount
} from '@solana/spl-token';

// Program IDs from your localnet
const CONTINUUM_PROGRAM_ID = new PublicKey('A548C9LR926hnAWvYDjsXJddidhfzLf3bRb8dmYPgRKn');
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

// Import IDLs
import continuumIdl from '../../target/idl/continuum_cp_swap.json';
import cpSwapIdl from '../../../raydium-cp-swap/target/idl/raydium_cp_swap.json';

async function realPoolRealSwap() {
  console.log('=== REAL POOL CREATION AND TOKEN SWAP TEST ===\n');
  
  // Setup
  const connection = new Connection('http://localhost:8899', 'confirmed');
  const admin = Keypair.generate();
  
  // Fund admin
  console.log('Admin:', admin.publicKey.toBase58());
  console.log('Funding admin...');
  const airdropSig = await connection.requestAirdrop(admin.publicKey, 10 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdropSig);

  // Setup Anchor
  const wallet = new Wallet(admin);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);

  // @ts-ignore
  const continuumProgram = new Program(continuumIdl, CONTINUUM_PROGRAM_ID, provider);
  // @ts-ignore
  const cpSwapProgram = new Program(cpSwapIdl, CP_SWAP_PROGRAM_ID, provider);

  console.log('\n=== Step 1: Initialize Continuum FIFO ===');
  
  const [fifoStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('fifo_state')],
    CONTINUUM_PROGRAM_ID
  );

  try {
    const tx = await continuumProgram.methods
      .initialize()
      .accounts({
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log('Continuum initialized:', tx);
  } catch (error: any) {
    if (error.toString().includes('already in use')) {
      console.log('Continuum already initialized');
    } else {
      throw error;
    }
  }

  console.log('\n=== Step 2: Create Real Tokens ===');
  
  const mintAuthA = Keypair.generate();
  const mintAuthB = Keypair.generate();
  
  const tokenA = await createMint(
    connection,
    admin,
    mintAuthA.publicKey,
    null,
    6 // USDC-like
  );
  
  const tokenB = await createMint(
    connection,
    admin,
    mintAuthB.publicKey,
    null,
    9 // SOL-like
  );
  
  console.log('Token A:', tokenA.toBase58());
  console.log('Token B:', tokenB.toBase58());
  
  // Sort tokens for CP-Swap
  const [token0, token1, mintAuth0, mintAuth1] = tokenA.toBuffer().compare(tokenB.toBuffer()) < 0
    ? [tokenA, tokenB, mintAuthA, mintAuthB]
    : [tokenB, tokenA, mintAuthB, mintAuthA];

  // Create and fund admin token accounts
  const adminToken0 = await getOrCreateAssociatedTokenAccount(
    connection,
    admin,
    token0,
    admin.publicKey
  );
  
  const adminToken1 = await getOrCreateAssociatedTokenAccount(
    connection,
    admin,
    token1,
    admin.publicKey
  );

  await mintTo(
    connection,
    admin,
    token0,
    adminToken0.address,
    mintAuth0,
    1_000_000 * 10 ** 6 // 1M tokens
  );
  
  await mintTo(
    connection,
    admin,
    token1,
    adminToken1.address,
    mintAuth1,
    1_000_000 * 10 ** 9 // 1M tokens
  );

  console.log('Tokens minted to admin');

  console.log('\n=== Step 3: Create AMM Config ===');
  
  let ammConfigPDA: PublicKey | null = null;
  const ammConfigIndex = 0;
  const indexBuffer = Buffer.allocUnsafe(2);
  indexBuffer.writeUInt16BE(ammConfigIndex, 0);
  
  [ammConfigPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('amm_config'), indexBuffer],
    CP_SWAP_PROGRAM_ID
  );

  try {
    await cpSwapProgram.methods
      .createAmmConfig(
        ammConfigIndex,
        new BN(10),      // trade fee (0.01%)
        new BN(1000),    // protocol fee
        new BN(25000),   // fund fee
        new BN(0)        // create pool fee
      )
      .accounts({
        owner: admin.publicKey,
        ammConfig: ammConfigPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log('AMM config created');
  } catch (error: any) {
    if (error.toString().includes('already in use')) {
      console.log('AMM config already exists');
    } else {
      throw error;
    }
  }

  console.log('\n=== Step 4: Create Real Pool with Continuum Authority ===');
  
  // Get all PDAs
  const [poolState] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('pool'),
      ammConfigPDA.toBuffer(),
      token0.toBuffer(),
      token1.toBuffer(),
    ],
    CP_SWAP_PROGRAM_ID
  );

  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_and_lp_mint_auth_seed')],
    CP_SWAP_PROGRAM_ID
  );

  const [lpMint] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_lp_mint'), poolState.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );

  const [vault0] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_vault'), poolState.toBuffer(), token0.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );

  const [vault1] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_vault'), poolState.toBuffer(), token1.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );

  const [observationState] = PublicKey.findProgramAddressSync(
    [Buffer.from('observation'), poolState.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );

  const [poolAuthorityPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('cp_pool_authority'), poolState.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );

  const [poolRegistryPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_registry'), poolState.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );

  const adminLpToken = await getAssociatedTokenAddress(lpMint, admin.publicKey);

  // Initial liquidity
  const initAmount0 = new BN(100_000 * 10 ** 6); // 100K token0
  const initAmount1 = new BN(50_000 * 10 ** 9);  // 50K token1

  // Build accounts for CPI
  const cpSwapAccounts = [
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: ammConfigPDA, isSigner: false, isWritable: false },
    { pubkey: poolAuthorityPDA, isSigner: false, isWritable: false },
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: token0, isSigner: false, isWritable: false },
    { pubkey: token1, isSigner: false, isWritable: false },
    { pubkey: lpMint, isSigner: false, isWritable: true },
    { pubkey: adminToken0.address, isSigner: false, isWritable: true },
    { pubkey: adminToken1.address, isSigner: false, isWritable: true },
    { pubkey: adminLpToken, isSigner: false, isWritable: true },
    { pubkey: vault0, isSigner: false, isWritable: true },
    { pubkey: vault1, isSigner: false, isWritable: true },
    { pubkey: adminToken0.address, isSigner: false, isWritable: true },
    { pubkey: observationState, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: anchor.web3.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  try {
    const tx = await continuumProgram.methods
      .initializeCpSwapPool(initAmount0, initAmount1, new BN(0))
      .accounts({
        poolRegistry: poolRegistryPDA,
        poolAuthority: poolAuthorityPDA,
        admin: admin.publicKey,
        poolState: poolState,
        cpSwapProgram: CP_SWAP_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(cpSwapAccounts)
      .rpc();
    
    console.log('✅ POOL CREATED:', poolState.toBase58());
    console.log('Transaction:', tx);
  } catch (error: any) {
    console.error('Pool creation error:', error);
    throw error;
  }

  // Verify pool
  const poolInfo = await cpSwapProgram.account.poolState.fetch(poolState);
  console.log('\nPool info:');
  console.log('  Token 0:', poolInfo.token0Mint.toBase58());
  console.log('  Token 1:', poolInfo.token1Mint.toBase58());
  console.log('  LP supply:', poolInfo.lpSupply.toString());

  console.log('\n=== Step 5: Create User and Perform REAL SWAP ===');
  
  const user = Keypair.generate();
  const userAirdrop = await connection.requestAirdrop(user.publicKey, 2 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(userAirdrop);
  console.log('User:', user.publicKey.toBase58());

  // Create user token accounts
  const userToken0 = await getOrCreateAssociatedTokenAccount(
    connection,
    user,
    token0,
    user.publicKey
  );

  const userToken1 = await getOrCreateAssociatedTokenAccount(
    connection,
    user,
    token1,
    user.publicKey
  );

  // Give user some tokens to swap
  await mintTo(
    connection,
    admin,
    token0,
    userToken0.address,
    mintAuth0,
    10_000 * 10 ** 6 // 10K token0
  );

  console.log('User funded with 10K token0');

  // Check balances before swap
  const userToken0Before = await getAccount(connection, userToken0.address);
  const userToken1Before = await getAccount(connection, userToken1.address);
  console.log('\nBalances before swap:');
  console.log('  Token0:', Number(userToken0Before.amount) / 10 ** 6);
  console.log('  Token1:', Number(userToken1Before.amount) / 10 ** 9);

  console.log('\n=== SUBMITTING SWAP ORDER ===');
  
  const amountIn = new BN(1_000 * 10 ** 6); // Swap 1K token0
  const minAmountOut = new BN(450 * 10 ** 9); // Expect at least 450 token1

  const fifoState = await continuumProgram.account.fifoState.fetch(fifoStatePDA);
  const currentSequence = fifoState.currentSequence;

  const [orderPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('order'), user.publicKey.toBuffer(), currentSequence.toArrayLike(Buffer, 'le', 8)],
    CONTINUUM_PROGRAM_ID
  );

  try {
    const tx = await continuumProgram.methods
      .submitOrder(amountIn, minAmountOut, true)
      .accounts({
        order: orderPDA,
        user: user.publicKey,
        poolRegistry: poolRegistryPDA,
        poolId: poolState,
        userSourceToken: userToken0.address,
        userDestinationToken: userToken1.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    console.log('✅ ORDER SUBMITTED!');
    console.log('Transaction:', tx);
    console.log('Order sequence:', currentSequence.toString());
  } catch (error: any) {
    console.error('Order submission error:', error);
    throw error;
  }

  // Check order state
  const orderState = await continuumProgram.account.orderState.fetch(orderPDA);
  console.log('\nOrder details:');
  console.log('  Status:', orderState.status);
  console.log('  Amount in:', orderState.amountIn.toString());
  console.log('  Min amount out:', orderState.minAmountOut.toString());

  console.log('\n=== EXECUTING ORDER (Simulating Relayer) ===');
  
  // Execute the order
  const executor = Keypair.generate();
  const executorAirdrop = await connection.requestAirdrop(executor.publicKey, LAMPORTS_PER_SOL);
  await connection.confirmTransaction(executorAirdrop);

  // Build swap accounts for execution
  const swapAccounts = [
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: token0, isSigner: false, isWritable: false },
    { pubkey: token1, isSigner: false, isWritable: false },
    { pubkey: lpMint, isSigner: false, isWritable: true },
    { pubkey: userToken0.address, isSigner: false, isWritable: true },
    { pubkey: userToken1.address, isSigner: false, isWritable: true },
    { pubkey: vault0, isSigner: false, isWritable: true },
    { pubkey: vault1, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: lpMint, isSigner: false, isWritable: false },
    { pubkey: vault0, isSigner: false, isWritable: false },
    { pubkey: observationState, isSigner: false, isWritable: true },
  ];

  try {
    const tx = await continuumProgram.methods
      .executeOrder()
      .accounts({
        orderState: orderPDA,
        executor: executor.publicKey,
        user: user.publicKey,
        poolRegistry: poolRegistryPDA,
        poolAuthority: poolAuthorityPDA,
        poolState: poolState,
        cpSwapProgram: CP_SWAP_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(swapAccounts)
      .signers([executor])
      .rpc();

    console.log('✅ ORDER EXECUTED!');
    console.log('Transaction:', tx);
  } catch (error: any) {
    console.error('Execution error:', error);
    throw error;
  }

  // Check balances after swap
  const userToken0After = await getAccount(connection, userToken0.address);
  const userToken1After = await getAccount(connection, userToken1.address);
  console.log('\n=== SWAP RESULTS ===');
  console.log('Token0 balance:');
  console.log('  Before:', Number(userToken0Before.amount) / 10 ** 6);
  console.log('  After:', Number(userToken0After.amount) / 10 ** 6);
  console.log('  Difference:', (Number(userToken0Before.amount) - Number(userToken0After.amount)) / 10 ** 6);
  
  console.log('\nToken1 balance:');
  console.log('  Before:', Number(userToken1Before.amount) / 10 ** 9);
  console.log('  After:', Number(userToken1After.amount) / 10 ** 9);
  console.log('  Difference:', (Number(userToken1After.amount) - Number(userToken1Before.amount)) / 10 ** 9);

  // Verify order was executed
  const updatedOrderState = await continuumProgram.account.orderState.fetch(orderPDA);
  console.log('\nOrder status after execution:', updatedOrderState.status);

  console.log('\n🎉 SUCCESS! Real tokens were swapped in a real pool using Continuum FIFO!');
  
  return {
    poolId: poolState,
    token0,
    token1,
    user,
    orderSequence: currentSequence,
    amountSwapped: amountIn,
    amountReceived: new BN(Number(userToken1After.amount) - Number(userToken1Before.amount))
  };
}

// Run the test
if (require.main === module) {
  realPoolRealSwap()
    .then((result) => {
      console.log('\n✅ COMPLETE SUCCESS!');
      console.log('Pool:', result.poolId.toBase58());
      console.log('Swapped:', result.amountSwapped.toString(), 'token0');
      console.log('Received:', result.amountReceived.toString(), 'token1');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Test failed:', error);
      process.exit(1);
    });
}

export { realPoolRealSwap };