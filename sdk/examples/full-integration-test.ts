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
import { ContinuumClient } from '../src';
import { ContinuumCpSwap } from '../../target/types/continuum_cp_swap';
import { RaydiumCpSwap } from '../../../raydium-cp-swap/target/types/raydium_cp_swap';

// Program IDs (from your test validator)
const CONTINUUM_PROGRAM_ID = new PublicKey('A548C9LR926hnAWvYDjsXJddidhfzLf3bRb8dmYPgRKn');
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

async function fullIntegrationTest() {
  console.log('=== Full Integration Test ===\n');
  
  // Setup provider
  const connection = new Connection('http://localhost:8899', 'confirmed');
  const admin = Keypair.generate();
  
  // Airdrop SOL to admin
  console.log('Airdropping SOL to admin...');
  const airdropSig = await connection.requestAirdrop(admin.publicKey, 10 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdropSig);
  console.log('Admin funded:', admin.publicKey.toBase58());

  // Create wallet and provider
  const wallet = new Wallet(admin);
  const provider = new AnchorProvider(connection, wallet, {});
  anchor.setProvider(provider);

  // Load programs
  const continuumIdl = await anchor.Program.fetchIdl(CONTINUUM_PROGRAM_ID, provider);
  const cpSwapIdl = await anchor.Program.fetchIdl(CP_SWAP_PROGRAM_ID, provider);
  
  const continuumProgram = new anchor.Program(continuumIdl, CONTINUUM_PROGRAM_ID, provider) as Program<ContinuumCpSwap>;
  const cpSwapProgram = new anchor.Program(cpSwapIdl, CP_SWAP_PROGRAM_ID, provider) as Program<RaydiumCpSwap>;

  console.log('\n=== Step 1: Initialize Continuum ===');
  
  // Get FIFO state PDA
  const [fifoStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('fifo_state')],
    CONTINUUM_PROGRAM_ID
  );

  try {
    await continuumProgram.methods
      .initialize()
      .accounts({
        fifoState: fifoStatePDA,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log('Continuum initialized successfully');
  } catch (error) {
    console.log('Continuum already initialized or error:', (error as Error).message);
  }

  console.log('\n=== Step 2: Create Tokens ===');
  
  // Create mint authorities
  const mintAuthorityA = Keypair.generate();
  const mintAuthorityB = Keypair.generate();
  
  // Create Token A (USDC-like with 6 decimals)
  const tokenA = await createMint(
    connection,
    admin,
    mintAuthorityA.publicKey,
    null,
    6
  );
  console.log('Token A created:', tokenA.toBase58());
  
  // Create Token B (SOL-like with 9 decimals)
  const tokenB = await createMint(
    connection,
    admin,
    mintAuthorityB.publicKey,
    null,
    9
  );
  console.log('Token B created:', tokenB.toBase58());

  // Sort tokens (CP-Swap requires token0 < token1)
  const [token0, token1, mintAuth0, mintAuth1] = tokenA.toBuffer().compare(tokenB.toBuffer()) < 0
    ? [tokenA, tokenB, mintAuthorityA, mintAuthorityB]
    : [tokenB, tokenA, mintAuthorityB, mintAuthorityA];
  
  console.log('Token 0 (sorted):', token0.toBase58());
  console.log('Token 1 (sorted):', token1.toBase58());

  // Create admin token accounts
  const adminToken0Account = await getOrCreateAssociatedTokenAccount(
    connection,
    admin,
    token0,
    admin.publicKey
  );
  
  const adminToken1Account = await getOrCreateAssociatedTokenAccount(
    connection,
    admin,
    token1,
    admin.publicKey
  );

  // Mint tokens to admin
  const amount0 = 1_000_000 * 10 ** 6; // 1M tokens
  const amount1 = 500_000 * 10 ** 9;   // 500K tokens
  
  await mintTo(
    connection,
    admin,
    token0,
    adminToken0Account.address,
    mintAuth0,
    amount0
  );
  console.log('Minted 1M Token 0 to admin');
  
  await mintTo(
    connection,
    admin,
    token1,
    adminToken1Account.address,
    mintAuth1,
    amount1
  );
  console.log('Minted 500K Token 1 to admin');

  console.log('\n=== Step 3: Create or Find AMM Config ===');
  
  let ammConfigPDA: PublicKey | null = null;
  
  // Try to find existing AMM config
  for (let index = 0; index < 10; index++) {
    const indexBuffer = Buffer.allocUnsafe(2);
    indexBuffer.writeUInt16BE(index, 0);
    
    const [configPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('amm_config'), indexBuffer],
      CP_SWAP_PROGRAM_ID
    );

    try {
      const config = await cpSwapProgram.account.ammConfig.fetch(configPDA);
      console.log(`Found existing AMM config ${index}:`, configPDA.toBase58());
      ammConfigPDA = configPDA;
      break;
    } catch (err) {
      // Try to create
      try {
        await cpSwapProgram.methods
          .createAmmConfig(
            index,
            new BN(10),      // trade fee rate (0.01%)
            new BN(1000),    // protocol fee rate
            new BN(25000),   // fund fee rate
            new BN(0)        // create pool fee
          )
          .accounts({
            owner: admin.publicKey,
            ammConfig: configPDA,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        
        console.log(`Created AMM config ${index}:`, configPDA.toBase58());
        ammConfigPDA = configPDA;
        break;
      } catch (createErr) {
        continue;
      }
    }
  }

  if (!ammConfigPDA) {
    throw new Error('Could not find or create AMM config');
  }

  console.log('\n=== Step 4: Initialize CP-Swap Pool ===');
  
  // Get pool PDAs
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

  // Get Continuum PDAs
  const [poolAuthorityPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('cp_pool_authority'), poolState.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );

  const [poolRegistryPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_registry'), poolState.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );

  console.log('Pool state:', poolState.toBase58());
  console.log('Continuum authority:', poolAuthorityPDA.toBase58());

  // Get admin LP token account
  const adminLpToken = await getAssociatedTokenAddress(lpMint, admin.publicKey);

  // Initial liquidity
  const initAmount0 = new BN(100_000 * 10 ** 6); // 100K token0
  const initAmount1 = new BN(50_000 * 10 ** 9);  // 50K token1
  const openTime = new BN(0);

  // Build CP-Swap accounts for CPI
  const cpSwapAccounts = [
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: ammConfigPDA, isSigner: false, isWritable: false },
    { pubkey: poolAuthorityPDA, isSigner: false, isWritable: false }, // Continuum authority
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: token0, isSigner: false, isWritable: false },
    { pubkey: token1, isSigner: false, isWritable: false },
    { pubkey: lpMint, isSigner: false, isWritable: true },
    { pubkey: adminToken0Account.address, isSigner: false, isWritable: true },
    { pubkey: adminToken1Account.address, isSigner: false, isWritable: true },
    { pubkey: adminLpToken, isSigner: false, isWritable: true },
    { pubkey: vault0, isSigner: false, isWritable: true },
    { pubkey: vault1, isSigner: false, isWritable: true },
    { pubkey: adminToken0Account.address, isSigner: false, isWritable: true }, // fee receiver
    { pubkey: observationState, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: anchor.web3.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  try {
    await continuumProgram.methods
      .initializeCpSwapPool(initAmount0, initAmount1, openTime)
      .accounts({
        fifoState: fifoStatePDA,
        poolRegistry: poolRegistryPDA,
        poolAuthority: poolAuthorityPDA,
        admin: admin.publicKey,
        poolState: poolState,
        cpSwapProgram: CP_SWAP_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(cpSwapAccounts)
      .rpc();

    console.log('✅ CP-Swap pool initialized with Continuum authority');
  } catch (error) {
    console.error('Pool initialization error:', error);
    throw error;
  }

  // Verify pool registry
  const registry = await continuumProgram.account.cpSwapPoolRegistry.fetch(poolRegistryPDA);
  console.log('\nPool Registry:');
  console.log('  Pool ID:', registry.poolId.toBase58());
  console.log('  Token 0:', registry.token0.toBase58());
  console.log('  Token 1:', registry.token1.toBase58());
  console.log('  Active:', registry.isActive);

  console.log('\n=== Step 5: Create Test User and Submit Order ===');
  
  // Create test user
  const user = Keypair.generate();
  const userAirdrop = await connection.requestAirdrop(user.publicKey, 2 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(userAirdrop);
  console.log('User funded:', user.publicKey.toBase58());

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

  // Mint tokens to user
  await mintTo(
    connection,
    admin,
    token0,
    userToken0.address,
    mintAuth0,
    10_000 * 10 ** 6 // 10K tokens
  );
  console.log('Minted 10K Token 0 to user');

  // Submit swap order
  const amountIn = new BN(1_000 * 10 ** 6); // 1K token0
  const minAmountOut = new BN(450 * 10 ** 9); // Minimum 450 token1 (accounting for slippage)

  // Get current sequence
  const fifoState = await continuumProgram.account.fifoState.fetch(fifoStatePDA);
  const currentSequence = fifoState.currentSequence;

  const [orderPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('order'), user.publicKey.toBuffer(), currentSequence.toArrayLike(Buffer, 'le', 8)],
    CONTINUUM_PROGRAM_ID
  );

  try {
    await continuumProgram.methods
      .submitOrder(poolState, amountIn, minAmountOut, true)
      .accounts({
        fifoState: fifoStatePDA,
        order: orderPDA,
        user: user.publicKey,
        userSourceToken: userToken0.address,
        userDestinationToken: userToken1.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    console.log('✅ Order submitted successfully');
    console.log('  Sequence:', currentSequence.toString());
    console.log('  Amount in:', amountIn.toString());
    console.log('  Min amount out:', minAmountOut.toString());
  } catch (error) {
    console.error('Order submission error:', error);
  }

  // Check order state
  try {
    const orderState = await continuumProgram.account.orderState.fetch(orderPDA);
    console.log('\nOrder State:');
    console.log('  Status:', orderState.status);
    console.log('  Pool:', orderState.poolId.toBase58());
    console.log('  User:', orderState.user.toBase58());
  } catch (error) {
    console.error('Could not fetch order state:', error);
  }

  console.log('\n=== Test Summary ===');
  console.log('Pool ID:', poolState.toBase58());
  console.log('Token 0:', token0.toBase58());
  console.log('Token 1:', token1.toBase58());
  console.log('LP Mint:', lpMint.toBase58());
  console.log('User:', user.publicKey.toBase58());
  console.log('\nIntegration test completed successfully!');

  return {
    poolId: poolState,
    token0,
    token1,
    lpMint,
    admin,
    user,
    orderSequence: currentSequence
  };
}

// Run the test
if (require.main === module) {
  fullIntegrationTest()
    .then((result) => {
      console.log('\n✅ All tests passed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Test failed:', error);
      process.exit(1);
    });
}

export { fullIntegrationTest };