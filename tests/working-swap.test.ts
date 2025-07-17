import * as anchor from '@coral-xyz/anchor';
import { Program, BN } from '@coral-xyz/anchor';
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount
} from '@solana/spl-token';
import { expect } from 'chai';
import { ContinuumCpSwap } from '../target/types/continuum_cp_swap';
import { RaydiumCpSwap } from '../../raydium-cp-swap/target/types/raydium_cp_swap';

describe('Working Real Swap Test', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const continuumProgram = anchor.workspace.ContinuumCpSwap as Program<ContinuumCpSwap>;
  const cpSwapProgram = anchor.workspace.RaydiumCpSwap as Program<RaydiumCpSwap>;

  // Test wallets
  const admin = provider.wallet as anchor.Wallet;
  let user: Keypair;
  let relayer: Keypair;
  
  // Tokens
  let tokenA: PublicKey;
  let tokenB: PublicKey;
  let token0: PublicKey;
  let token1: PublicKey;
  let mintAuthA: Keypair;
  let mintAuthB: Keypair;
  
  // Pool state
  let poolState: PublicKey;
  let ammConfigPDA: PublicKey;
  let poolAuthorityPDA: PublicKey;
  let poolRegistryPDA: PublicKey;
  let fifoStatePDA: PublicKey;

  before(async () => {
    console.log('\n🚀 Setting up Working Swap Test...');
    console.log('Admin:', admin.publicKey.toBase58());
    
    // Create test accounts
    user = Keypair.generate();
    relayer = Keypair.generate();
    
    // Fund accounts
    await Promise.all([
      provider.connection.requestAirdrop(user.publicKey, 5 * LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(relayer.publicKey, 2 * LAMPORTS_PER_SOL)
    ]).then(sigs => Promise.all(sigs.map(sig => provider.connection.confirmTransaction(sig))));
    
    console.log('User:', user.publicKey.toBase58());
    console.log('Relayer:', relayer.publicKey.toBase58());
  });

  it('Initialize Continuum FIFO', async () => {
    [fifoStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('fifo_state')],
      continuumProgram.programId
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
      console.log('✅ FIFO state initialized');
    } catch (err) {
      console.log('✅ FIFO state already initialized');
    }
  });

  it('Create tokens and distribute', async () => {
    // Create mints
    mintAuthA = Keypair.generate();
    mintAuthB = Keypair.generate();
    
    tokenA = await createMint(
      provider.connection,
      admin.payer,
      mintAuthA.publicKey,
      null,
      6
    );
    
    tokenB = await createMint(
      provider.connection,
      admin.payer,
      mintAuthB.publicKey,
      null,
      9
    );
    
    // Sort tokens
    [token0, token1] = tokenA.toBuffer().compare(tokenB.toBuffer()) < 0 
      ? [tokenA, tokenB] 
      : [tokenB, tokenA];
    
    console.log('Token 0:', token0.toBase58());
    console.log('Token 1:', token1.toBase58());
    
    // Create token accounts
    const adminToken0 = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      token0,
      admin.publicKey
    );
    
    const adminToken1 = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      token1,
      admin.publicKey
    );
    
    const userToken0 = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      token0,
      user.publicKey
    );
    
    const userToken1 = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      token1,
      user.publicKey
    );
    
    // Mint tokens
    const mintAuth0 = token0.equals(tokenA) ? mintAuthA : mintAuthB;
    const mintAuth1 = token1.equals(tokenA) ? mintAuthA : mintAuthB;
    
    await mintTo(
      provider.connection,
      admin.payer,
      token0,
      adminToken0.address,
      mintAuth0,
      1_000_000 * 10 ** 6
    );
    
    await mintTo(
      provider.connection,
      admin.payer,
      token1,
      adminToken1.address,
      mintAuth1,
      1_000_000 * 10 ** 9
    );
    
    await mintTo(
      provider.connection,
      admin.payer,
      token0,
      userToken0.address,
      mintAuth0,
      10_000 * 10 ** 6
    );
    
    console.log('✅ Tokens created and distributed');
  });

  it('Create AMM config', async () => {
    const ammConfigIndex = 0;
    const indexBuffer = Buffer.allocUnsafe(2);
    indexBuffer.writeUInt16BE(ammConfigIndex, 0);
    
    [ammConfigPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('amm_config'), indexBuffer],
      cpSwapProgram.programId
    );

    try {
      await cpSwapProgram.methods
        .createAmmConfig(
          ammConfigIndex,
          new BN(10),
          new BN(1000),
          new BN(25000),
          new BN(0)
        )
        .accounts({
          owner: admin.publicKey,
          ammConfig: ammConfigPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log('✅ AMM config created');
    } catch (err) {
      console.log('✅ AMM config already exists');
    }
  });

  it('Initialize pool with Continuum authority', async () => {
    // Get pool PDAs
    [poolState] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('pool'),
        ammConfigPDA.toBuffer(),
        token0.toBuffer(),
        token1.toBuffer(),
      ],
      cpSwapProgram.programId
    );

    const [authority] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault_and_lp_mint_auth_seed')],
      cpSwapProgram.programId
    );

    const [lpMint] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool_lp_mint'), poolState.toBuffer()],
      cpSwapProgram.programId
    );

    const [vault0] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool_vault'), poolState.toBuffer(), token0.toBuffer()],
      cpSwapProgram.programId
    );

    const [vault1] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool_vault'), poolState.toBuffer(), token1.toBuffer()],
      cpSwapProgram.programId
    );

    const [observationState] = PublicKey.findProgramAddressSync(
      [Buffer.from('observation'), poolState.toBuffer()],
      cpSwapProgram.programId
    );

    // Continuum PDAs
    [poolAuthorityPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('cp_pool_authority'), poolState.toBuffer()],
      continuumProgram.programId
    );

    [poolRegistryPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool_registry'), poolState.toBuffer()],
      continuumProgram.programId
    );

    // Get token accounts
    const adminToken0 = await getAssociatedTokenAddress(token0, admin.publicKey);
    const adminToken1 = await getAssociatedTokenAddress(token1, admin.publicKey);
    const adminLpToken = await getAssociatedTokenAddress(lpMint, admin.publicKey);

    // Build CPI accounts
    const cpSwapAccounts = [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: ammConfigPDA, isSigner: false, isWritable: false },
      { pubkey: poolAuthorityPDA, isSigner: false, isWritable: false },
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: token0, isSigner: false, isWritable: false },
      { pubkey: token1, isSigner: false, isWritable: false },
      { pubkey: lpMint, isSigner: false, isWritable: true },
      { pubkey: adminToken0, isSigner: false, isWritable: true },
      { pubkey: adminToken1, isSigner: false, isWritable: true },
      { pubkey: adminLpToken, isSigner: false, isWritable: true },
      { pubkey: vault0, isSigner: false, isWritable: true },
      { pubkey: vault1, isSigner: false, isWritable: true },
      { pubkey: adminToken0, isSigner: false, isWritable: true }, // fee receiver
      { pubkey: observationState, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: anchor.web3.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ];

    await continuumProgram.methods
      .initializeCpSwapPool(
        new BN(100_000 * 10 ** 6),
        new BN(50_000 * 10 ** 9),
        new BN(0)
      )
      .accounts({
        fifoState: fifoStatePDA,
        poolRegistry: poolRegistryPDA,
        poolAuthority: poolAuthorityPDA,
        admin: admin.publicKey,
        poolState: poolState,
        cpSwapProgram: cpSwapProgram.programId,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(cpSwapAccounts)
      .rpc();

    console.log('✅ Pool created:', poolState.toBase58());
    
    // Verify pool
    const poolInfo = await cpSwapProgram.account.poolState.fetch(poolState);
    console.log('Pool LP supply:', poolInfo.lpSupply.toString());
  });

  it('Submit and execute real swap order', async () => {
    // Get user token accounts
    const userToken0 = await getAssociatedTokenAddress(token0, user.publicKey);
    const userToken1 = await getAssociatedTokenAddress(token1, user.publicKey);
    
    // Check balances before
    const balanceBefore0 = await getAccount(provider.connection, userToken0);
    const balanceBefore1 = await getAccount(provider.connection, userToken1);
    
    console.log('\nBalances before swap:');
    console.log('Token 0:', Number(balanceBefore0.amount) / 10 ** 6);
    console.log('Token 1:', Number(balanceBefore1.amount) / 10 ** 9);
    
    // Submit order
    const amountIn = new BN(1000 * 10 ** 6); // 1000 token0
    const minAmountOut = new BN(400 * 10 ** 9); // Min 400 token1
    
    const fifoState = await continuumProgram.account.fifoState.fetch(fifoStatePDA);
    const sequence = fifoState.currentSequence;
    
    const [orderPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), user.publicKey.toBuffer(), sequence.toArrayLike(Buffer, 'le', 8)],
      continuumProgram.programId
    );
    
    await continuumProgram.methods
      .submitOrder(amountIn, minAmountOut, true)
      .accounts({
        fifoState: fifoStatePDA,
        poolRegistry: poolRegistryPDA,
        orderState: orderPDA,
        user: user.publicKey,
        poolId: poolState,
        userSourceToken: userToken0,
        userDestinationToken: userToken1,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      })
      .signers([user])
      .rpc();
    
    console.log('✅ Order submitted, sequence:', sequence.toString());
    
    // Execute order
    const [vault0] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool_vault'), poolState.toBuffer(), token0.toBuffer()],
      cpSwapProgram.programId
    );

    const [vault1] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool_vault'), poolState.toBuffer(), token1.toBuffer()],
      cpSwapProgram.programId
    );

    const [observationState] = PublicKey.findProgramAddressSync(
      [Buffer.from('observation'), poolState.toBuffer()],
      cpSwapProgram.programId
    );
    
    const cpSwapAccounts = [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: vault0, isSigner: false, isWritable: true },
      { pubkey: vault1, isSigner: false, isWritable: true },
      { pubkey: observationState, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];
    
    await continuumProgram.methods
      .executeOrder(sequence)
      .accounts({
        fifoState: fifoStatePDA,
        orderState: orderPDA,
        poolRegistry: poolRegistryPDA,
        poolAuthority: poolAuthorityPDA,
        executor: relayer.publicKey,
        userSource: userToken0,
        userDestination: userToken1,
        cpSwapProgram: cpSwapProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      })
      .remainingAccounts(cpSwapAccounts)
      .signers([relayer])
      .rpc();
    
    console.log('✅ Order executed by relayer');
    
    // Check balances after
    const balanceAfter0 = await getAccount(provider.connection, userToken0);
    const balanceAfter1 = await getAccount(provider.connection, userToken1);
    
    console.log('\nBalances after swap:');
    console.log('Token 0:', Number(balanceAfter0.amount) / 10 ** 6);
    console.log('Token 1:', Number(balanceAfter1.amount) / 10 ** 9);
    
    const swapped = Number(balanceBefore0.amount) - Number(balanceAfter0.amount);
    const received = Number(balanceAfter1.amount) - Number(balanceBefore1.amount);
    
    console.log('\n🎉 REAL SWAP COMPLETED!');
    console.log('Swapped:', swapped / 10 ** 6, 'token0');
    console.log('Received:', received / 10 ** 9, 'token1');
    
    expect(swapped).to.equal(1000 * 10 ** 6);
    expect(received).to.be.greaterThan(400 * 10 ** 9);
  });
});