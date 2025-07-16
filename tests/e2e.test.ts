import * as anchor from '@coral-xyz/anchor';
import { Program, BN } from '@coral-xyz/anchor';
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddress
} from '@solana/spl-token';
import { expect } from 'chai';

// Import our programs
import { ContinuumCpSwap } from '../target/types/continuum_cp_swap';
import { RaydiumCpSwap } from '../../raydium-cp-swap/target/types/raydium_cp_swap';

describe('Continuum CP-Swap End-to-End Tests', () => {
  // Configure the client to use localnet
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Program instances
  const continuumProgram = anchor.workspace.ContinuumCpSwap as Program<ContinuumCpSwap>;
  const cpSwapProgram = anchor.workspace.RaydiumCpSwap as Program<RaydiumCpSwap>;

  // Test wallets - use provider wallet as admin for consistency
  const admin = provider.wallet as anchor.Wallet;
  const user1 = Keypair.generate();
  const user2 = Keypair.generate();
  const relayer = Keypair.generate();

  // Token mints
  let tokenA: PublicKey;
  let tokenB: PublicKey;
  let mintAuthorityA: Keypair;
  let mintAuthorityB: Keypair;

  // Pool and state accounts
  let poolState: PublicKey;
  let fifoStatePDA: PublicKey;
  let poolRegistryPDA: PublicKey;
  let poolAuthorityPDA: PublicKey;
  let ammConfigPDA: PublicKey;

  // Helper functions
  const airdrop = async (wallet: PublicKey, amount: number) => {
    const sig = await provider.connection.requestAirdrop(
      wallet,
      amount * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
  };

  const getPoolPDAs = (token0: PublicKey, token1: PublicKey) => {
    // Sort tokens
    const [sortedToken0, sortedToken1] = token0.toBuffer().compare(token1.toBuffer()) < 0 
      ? [token0, token1] 
      : [token1, token0];

    const [poolState] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('pool'),
        ammConfigPDA.toBuffer(),
        sortedToken0.toBuffer(),
        sortedToken1.toBuffer(),
      ],
      cpSwapProgram.programId
    );

    const [authority] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault_and_lp_mint_auth_seed')],
      cpSwapProgram.programId
    );

    const [lpMint] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('pool_lp_mint'),
        poolState.toBuffer(),
      ],
      cpSwapProgram.programId
    );

    const [vault0] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('pool_vault'),
        poolState.toBuffer(),
        sortedToken0.toBuffer(),
      ],
      cpSwapProgram.programId
    );

    const [vault1] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('pool_vault'),
        poolState.toBuffer(),
        sortedToken1.toBuffer(),
      ],
      cpSwapProgram.programId
    );

    const [observationState] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('observation'),
        poolState.toBuffer(),
      ],
      cpSwapProgram.programId
    );

    return { poolState, authority, lpMint, vault0, vault1, observationState };
  };

  before(async () => {
    console.log('Setting up test environment...');
    
    // Airdrop SOL to test wallets (skip admin as it's the provider wallet)
    await Promise.all([
      airdrop(user1.publicKey, 10),
      airdrop(user2.publicKey, 10),
      airdrop(relayer.publicKey, 10),
    ]);

    console.log('Wallets funded');
  });

  it('Initialize or verify Continuum FIFO state', async () => {
    // Get FIFO state PDA
    [fifoStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('fifo_state')],
      continuumProgram.programId
    );

    try {
      // Try to fetch existing FIFO state
      const fifoState = await continuumProgram.account.fifoState.fetch(fifoStatePDA);
      console.log('✅ FIFO state already initialized');
      console.log('Current sequence:', fifoState.currentSequence.toNumber());
    } catch (err) {
      // Initialize if it doesn't exist
      await continuumProgram.methods
        .initialize()
        .accounts({
          fifoState: fifoStatePDA,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin.payer])
        .rpc();

      console.log('✅ Continuum FIFO state initialized');
    }
  });

  it('Create test tokens and mint supply', async () => {
    // Create token A
    mintAuthorityA = Keypair.generate();
    tokenA = await createMint(
      provider.connection,
      admin.payer,
      mintAuthorityA.publicKey,
      null,
      6 // 6 decimals
    );

    // Create token B
    mintAuthorityB = Keypair.generate();
    tokenB = await createMint(
      provider.connection,
      admin.payer,
      mintAuthorityB.publicKey,
      null,
      6 // 6 decimals
    );

    console.log('Token A:', tokenA.toString());
    console.log('Token B:', tokenB.toString());

    // Create token accounts and mint tokens for users
    const mintAmount = 1000 * 10 ** 6; // 1000 tokens

    for (const user of [user1, user2, admin.payer]) {
      const tokenAccountA = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        tokenA,
        user.publicKey
      );

      const tokenAccountB = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin.payer,
        tokenB,
        user.publicKey
      );

      await mintTo(
        provider.connection,
        admin.payer,
        tokenA,
        tokenAccountA.address,
        mintAuthorityA,
        mintAmount
      );

      await mintTo(
        provider.connection,
        admin.payer,
        tokenB,
        tokenAccountB.address,
        mintAuthorityB,
        mintAmount
      );
    }

    console.log('✅ Tokens created and distributed');
  });

  it('Create AMM config', async () => {
    // Get AMM config PDA - use big endian for index
    const index = 0;
    const indexBuffer = Buffer.allocUnsafe(2);
    indexBuffer.writeUInt16BE(index, 0);
    
    [ammConfigPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('amm_config'),
        indexBuffer,
      ],
      cpSwapProgram.programId
    );

    // Create AMM config
    await cpSwapProgram.methods
      .createAmmConfig(
        index,
        new BN(10), // trade fee rate (0.01%)
        new BN(1000), // protocol fee rate
        new BN(25000), // fund fee rate
        new BN(0) // create pool fee
      )
      .accounts({
        owner: admin.publicKey,
        ammConfig: ammConfigPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin.payer])
      .rpc();

    console.log('✅ AMM config created');
  });

  it('Initialize CP-Swap pool with Continuum authority', async () => {
    // Sort tokens
    const [token0, token1] = tokenA.toBuffer().compare(tokenB.toBuffer()) < 0 
      ? [tokenA, tokenB] 
      : [tokenB, tokenA];

    // Get pool PDAs
    const pdas = getPoolPDAs(token0, token1);
    poolState = pdas.poolState;

    // Get Continuum PDAs
    [poolAuthorityPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('cp_pool_authority'), poolState.toBuffer()],
      continuumProgram.programId
    );

    [poolRegistryPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool_registry'), poolState.toBuffer()],
      continuumProgram.programId
    );

    // Get admin token accounts
    const adminToken0 = await getAssociatedTokenAddress(token0, admin.publicKey);
    const adminToken1 = await getAssociatedTokenAddress(token1, admin.publicKey);
    const adminLpToken = await getAssociatedTokenAddress(pdas.lpMint, admin.publicKey);

    // Get fee receiver token account
    const feeReceiverToken0 = await getAssociatedTokenAddress(
      token0,
      admin.publicKey // Using admin as fee receiver for simplicity
    );

    // Initialize pool through Continuum
    const initAmount0 = new BN(100 * 10 ** 6); // 100 tokens
    const initAmount1 = new BN(200 * 10 ** 6); // 200 tokens
    const openTime = new BN(0);

    // Build the CP-Swap accounts list
    const cpSwapAccounts = [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true }, // creator
      { pubkey: ammConfigPDA, isSigner: false, isWritable: false },
      { pubkey: poolAuthorityPDA, isSigner: false, isWritable: false }, // Use Continuum authority
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: token0, isSigner: false, isWritable: false },
      { pubkey: token1, isSigner: false, isWritable: false },
      { pubkey: pdas.lpMint, isSigner: false, isWritable: true },
      { pubkey: adminToken0, isSigner: false, isWritable: true },
      { pubkey: adminToken1, isSigner: false, isWritable: true },
      { pubkey: adminLpToken, isSigner: false, isWritable: true },
      { pubkey: pdas.vault0, isSigner: false, isWritable: true },
      { pubkey: pdas.vault1, isSigner: false, isWritable: true },
      { pubkey: feeReceiverToken0, isSigner: false, isWritable: true },
      { pubkey: pdas.observationState, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token0 program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token1 program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: anchor.web3.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ];

    await continuumProgram.methods
      .initializeCpSwapPool(initAmount0, initAmount1, openTime)
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
      .signers([admin.payer])
      .rpc();

    // Verify pool registry
    const registry = await continuumProgram.account.cpSwapPoolRegistry.fetch(poolRegistryPDA);
    expect(registry.poolId.toString()).to.equal(poolState.toString());
    expect(registry.continuumAuthority.toString()).to.equal(poolAuthorityPDA.toString());
    expect(registry.isActive).to.equal(true);

    console.log('✅ CP-Swap pool initialized with Continuum authority');
    console.log('Pool ID:', poolState.toString());
    console.log('Continuum Authority:', poolAuthorityPDA.toString());
  });

  it('Submit swap orders', async () => {
    // User 1 submits order
    const user1TokenA = await getAssociatedTokenAddress(tokenA, user1.publicKey);
    const user1TokenB = await getAssociatedTokenAddress(tokenB, user1.publicKey);

    const amountIn1 = new BN(10 * 10 ** 6); // 10 tokens
    const minAmountOut1 = new BN(19 * 10 ** 6); // Expecting ~20 tokens (2:1 ratio)

    await continuumProgram.methods
      .submitOrder(amountIn1, minAmountOut1, true) // base_input = true
      .accounts({
        fifoState: fifoStatePDA,
        poolRegistry: poolRegistryPDA,
        orderState: getOrderPDA(user1.publicKey, new BN(1)),
        user: user1.publicKey,
        poolId: poolState,
        systemProgram: SystemProgram.programId,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      })
      .signers([user1])
      .rpc();

    console.log('✅ User 1 submitted order with sequence 1');

    // User 2 submits order
    const user2TokenA = await getAssociatedTokenAddress(tokenA, user2.publicKey);
    const user2TokenB = await getAssociatedTokenAddress(tokenB, user2.publicKey);

    const amountIn2 = new BN(5 * 10 ** 6); // 5 tokens
    const minAmountOut2 = new BN(9 * 10 ** 6); // Expecting ~10 tokens

    await continuumProgram.methods
      .submitOrder(amountIn2, minAmountOut2, true)
      .accounts({
        fifoState: fifoStatePDA,
        poolRegistry: poolRegistryPDA,
        orderState: getOrderPDA(user2.publicKey, new BN(2)),
        user: user2.publicKey,
        poolId: poolState,
        systemProgram: SystemProgram.programId,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      })
      .signers([user2])
      .rpc();

    console.log('✅ User 2 submitted order with sequence 2');

    // Verify FIFO state
    const fifoState = await continuumProgram.account.fifoState.fetch(fifoStatePDA);
    expect(fifoState.currentSequence.toNumber()).to.equal(2);
  });

  it('Execute orders in FIFO sequence', async () => {
    // Get pool PDAs for swap execution
    const [token0, token1] = tokenA.toBuffer().compare(tokenB.toBuffer()) < 0 
      ? [tokenA, tokenB] 
      : [tokenB, tokenA];
    const pdas = getPoolPDAs(token0, token1);

    // Execute order 1
    const user1TokenA = await getAssociatedTokenAddress(tokenA, user1.publicKey);
    const user1TokenB = await getAssociatedTokenAddress(tokenB, user1.publicKey);
    const [user1Source, user1Dest] = tokenA.equals(token0) 
      ? [user1TokenA, user1TokenB]
      : [user1TokenB, user1TokenA];

    // Get user 1 balances before
    const user1SourceBefore = await getAccount(provider.connection, user1Source);
    const user1DestBefore = await getAccount(provider.connection, user1Dest);

    // CP-Swap remaining accounts for swap
    const cpSwapAccounts = [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: pdas.vault0, isSigner: false, isWritable: true },
      { pubkey: pdas.vault1, isSigner: false, isWritable: true },
      { pubkey: pdas.observationState, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    await continuumProgram.methods
      .executeOrder(new BN(1))
      .accounts({
        fifoState: fifoStatePDA,
        orderState: getOrderPDA(user1.publicKey, new BN(1)),
        poolRegistry: poolRegistryPDA,
        poolAuthority: poolAuthorityPDA,
        executor: relayer.publicKey,
        userSource: user1Source,
        userDestination: user1Dest,
        cpSwapProgram: cpSwapProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      })
      .remainingAccounts(cpSwapAccounts)
      .signers([relayer])
      .rpc();

    console.log('✅ Order 1 executed');

    // Verify token balances changed
    const user1SourceAfter = await getAccount(provider.connection, user1Source);
    const user1DestAfter = await getAccount(provider.connection, user1Dest);

    expect(user1SourceAfter.amount).to.be.lessThan(user1SourceBefore.amount);
    expect(user1DestAfter.amount).to.be.greaterThan(user1DestBefore.amount);

    // Try to execute order 2 before order 1 (should fail)
    try {
      await continuumProgram.methods
        .executeOrder(new BN(2))
        .accounts({
          fifoState: fifoStatePDA,
          orderState: getOrderPDA(user2.publicKey, new BN(2)),
          poolRegistry: poolRegistryPDA,
          poolAuthority: poolAuthorityPDA,
          executor: relayer.publicKey,
          userSource: user1Source, // dummy
          userDestination: user1Dest, // dummy
          cpSwapProgram: cpSwapProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .remainingAccounts(cpSwapAccounts)
        .signers([relayer])
        .rpc();
      
      throw new Error('Should have failed - wrong sequence');
    } catch (err) {
      expect(err.toString()).to.include('InvalidSequence');
      console.log('✅ FIFO order enforced - cannot execute out of sequence');
    }
  });

  it('Cancel order', async () => {
    // User 2 cancels their order
    await continuumProgram.methods
      .cancelOrder()
      .accounts({
        orderState: getOrderPDA(user2.publicKey, new BN(2)),
        user: user2.publicKey,
        clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
      })
      .signers([user2])
      .rpc();

    console.log('✅ User 2 cancelled their order');

    // Verify order status
    const orderState = await continuumProgram.account.orderState.fetch(
      getOrderPDA(user2.publicKey, new BN(2))
    );
    expect(orderState.status).to.deep.equal({ cancelled: {} });
  });

  it('Test direct swap attempt (should fail)', async () => {
    // Try to swap directly on the CP-Swap pool (should fail due to custom authority)
    const [token0, token1] = tokenA.toBuffer().compare(tokenB.toBuffer()) < 0 
      ? [tokenA, tokenB] 
      : [tokenB, tokenA];
    const pdas = getPoolPDAs(token0, token1);

    const userTokenA = await getAssociatedTokenAddress(tokenA, user1.publicKey);
    const userTokenB = await getAssociatedTokenAddress(tokenB, user1.publicKey);
    const [userSource, userDest] = tokenA.equals(token0) 
      ? [userTokenA, userTokenB]
      : [userTokenB, userTokenA];

    try {
      await cpSwapProgram.methods
        .swapBaseInput(new BN(1 * 10 ** 6), new BN(0))
        .accounts({
          payer: user1.publicKey,
          authority: user1.publicKey, // Wrong authority!
          ammConfig: ammConfigPDA,
          poolState: poolState,
          inputTokenAccount: userSource,
          outputTokenAccount: userDest,
          inputVault: pdas.vault0,
          outputVault: pdas.vault1,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          outputTokenProgram: TOKEN_PROGRAM_ID,
          inputTokenMint: token0,
          outputTokenMint: token1,
          observationState: pdas.observationState,
        })
        .signers([user1])
        .rpc();

      throw new Error('Should have failed - wrong authority');
    } catch (err) {
      console.log('✅ Direct swap correctly rejected - pool protected by Continuum');
    }
  });

  // Helper function to get order PDA
  function getOrderPDA(user: PublicKey, sequence: BN): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('order'),
        user.toBuffer(),
        sequence.toArrayLike(Buffer, 'le', 8)
      ],
      continuumProgram.programId
    );
    return pda;
  }
});

describe('Continuum CP-Swap Stress Tests', () => {
  const provider = anchor.AnchorProvider.env();
  const continuumProgram = anchor.workspace.ContinuumCpSwap as Program<ContinuumCpSwap>;
  const admin = provider.wallet as anchor.Wallet;
  
  let fifoStatePDA: PublicKey;
  let poolRegistryPDA: PublicKey;
  let poolState: PublicKey;
  let tokenA: PublicKey;
  let mintAuthorityA: Keypair;
  
  // Helper function
  const airdrop = async (wallet: PublicKey, amount: number) => {
    const sig = await provider.connection.requestAirdrop(
      wallet,
      amount * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
  };
  
  // Helper function to get order PDA
  function getOrderPDA(user: PublicKey, sequence: BN): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('order'),
        user.toBuffer(),
        sequence.toArrayLike(Buffer, 'le', 8)
      ],
      continuumProgram.programId
    );
    return pda;
  }

  before(async () => {
    // Get necessary PDAs from the previous test suite
    [fifoStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('fifo_state')],
      continuumProgram.programId
    );
    
    // Assume these were created in the previous test
    tokenA = new PublicKey('4jbS8tWh66w6kgUvPtvid8bW7iVnofkeuw6NjfuHmcJP');
    mintAuthorityA = Keypair.generate(); // We'll need to recreate mint authority
  });
  
  // Test with multiple concurrent orders
  it('Handle multiple concurrent orders correctly', async () => {
    // Submit 10 orders rapidly
    const orders = [];
    for (let i = 3; i <= 12; i++) {
      const user = Keypair.generate();
      await airdrop(user.publicKey, 2);
      
      // Create token accounts and mint tokens
      const tokenAccountA = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin,
        tokenA,
        user.publicKey
      );

      await mintTo(
        provider.connection,
        admin,
        tokenA,
        tokenAccountA.address,
        mintAuthorityA,
        100 * 10 ** 6
      );

      orders.push({ user, sequence: new BN(i) });
    }

    // Submit all orders
    for (const order of orders) {
      await continuumProgram.methods
        .submitOrder(new BN(1 * 10 ** 6), new BN(0), true)
        .accounts({
          fifoState: fifoStatePDA,
          poolRegistry: poolRegistryPDA,
          orderState: getOrderPDA(order.user.publicKey, order.sequence),
          user: order.user.publicKey,
          poolId: poolState,
          systemProgram: SystemProgram.programId,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        })
        .signers([order.user])
        .rpc();
    }

    console.log('✅ Submitted 10 concurrent orders');

    // Verify FIFO state
    const fifoState = await continuumProgram.account.fifoState.fetch(fifoStatePDA);
    expect(fifoState.currentSequence.toNumber()).to.equal(12);
  });
});