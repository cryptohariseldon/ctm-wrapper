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

describe('Correct Real Swap Test', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const continuumProgram = anchor.workspace.ContinuumCpSwap as Program<ContinuumCpSwap>;
  const cpSwapProgram = anchor.workspace.RaydiumCpSwap as Program<RaydiumCpSwap>;

  let admin = provider.wallet as anchor.Wallet;
  let user: Keypair;
  let relayer: Keypair;
  
  let tokenA: PublicKey;
  let tokenB: PublicKey;
  let token0: PublicKey;
  let token1: PublicKey;
  let mintAuth0: Keypair;
  let mintAuth1: Keypair;
  
  let poolState: PublicKey;
  let ammConfigPDA: PublicKey;
  let fifoStatePDA: PublicKey;

  before(async () => {
    console.log('\n🚀 Setting up Correct Swap Test...');
    
    user = Keypair.generate();
    relayer = Keypair.generate();
    
    await Promise.all([
      provider.connection.requestAirdrop(user.publicKey, 5 * LAMPORTS_PER_SOL),
      provider.connection.requestAirdrop(relayer.publicKey, 2 * LAMPORTS_PER_SOL)
    ]).then(sigs => Promise.all(sigs.map(sig => provider.connection.confirmTransaction(sig))));
  });

  it('Initialize Continuum', async () => {
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
      console.log('✅ FIFO initialized');
    } catch (err) {
      console.log('✅ FIFO already initialized');
    }
  });

  it('Create tokens', async () => {
    const mintAuthA = Keypair.generate();
    const mintAuthB = Keypair.generate();
    
    tokenA = await createMint(provider.connection, admin.payer, mintAuthA.publicKey, null, 6);
    tokenB = await createMint(provider.connection, admin.payer, mintAuthB.publicKey, null, 9);
    
    // Sort tokens
    if (tokenA.toBuffer().compare(tokenB.toBuffer()) < 0) {
      token0 = tokenA;
      token1 = tokenB;
      mintAuth0 = mintAuthA;
      mintAuth1 = mintAuthB;
    } else {
      token0 = tokenB;
      token1 = tokenA;
      mintAuth0 = mintAuthB;
      mintAuth1 = mintAuthA;
    }
    
    console.log('✅ Tokens created');
    
    // Create and fund accounts
    const adminToken0 = await getOrCreateAssociatedTokenAccount(
      provider.connection, admin.payer, token0, admin.publicKey
    );
    const adminToken1 = await getOrCreateAssociatedTokenAccount(
      provider.connection, admin.payer, token1, admin.publicKey
    );
    const userToken0 = await getOrCreateAssociatedTokenAccount(
      provider.connection, admin.payer, token0, user.publicKey
    );
    const userToken1 = await getOrCreateAssociatedTokenAccount(
      provider.connection, admin.payer, token1, user.publicKey
    );
    
    await mintTo(provider.connection, admin.payer, token0, adminToken0.address, mintAuth0, 1_000_000 * 10 ** 6);
    await mintTo(provider.connection, admin.payer, token1, adminToken1.address, mintAuth1, 1_000_000 * 10 ** 9);
    await mintTo(provider.connection, admin.payer, token0, userToken0.address, mintAuth0, 10_000 * 10 ** 6);
    
    console.log('✅ Accounts funded');
  });

  it('Create AMM config', async () => {
    const indexBuffer = Buffer.allocUnsafe(2);
    indexBuffer.writeUInt16BE(0, 0);
    
    [ammConfigPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('amm_config'), indexBuffer],
      cpSwapProgram.programId
    );

    try {
      await cpSwapProgram.methods
        .createAmmConfig(0, new BN(10), new BN(1000), new BN(25000), new BN(0))
        .accounts({
          owner: admin.publicKey,
          ammConfig: ammConfigPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log('✅ AMM config created');
    } catch (err) {
      console.log('✅ AMM config exists');
    }
  });

  it('Initialize pool with correct account order', async () => {
    // CP-Swap PDAs
    [poolState] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool'), ammConfigPDA.toBuffer(), token0.toBuffer(), token1.toBuffer()],
      cpSwapProgram.programId
    );

    const [cpSwapAuthority] = PublicKey.findProgramAddressSync(
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
    const [poolAuthorityPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('cp_pool_authority'), poolState.toBuffer()],
      continuumProgram.programId
    );

    const [poolRegistryPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool_registry'), poolState.toBuffer()],
      continuumProgram.programId
    );

    // Token accounts
    const adminToken0 = await getAssociatedTokenAddress(token0, admin.publicKey);
    const adminToken1 = await getAssociatedTokenAddress(token1, admin.publicKey);
    const adminLpToken = await getAssociatedTokenAddress(lpMint, admin.publicKey);

    // Build accounts in EXACT order CP-Swap expects
    const cpSwapAccounts = [
      // 1. creator (admin)
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      // 2. amm_config
      { pubkey: ammConfigPDA, isSigner: false, isWritable: false },
      // 3. authority (CP-Swap's authority, NOT Continuum's)
      { pubkey: cpSwapAuthority, isSigner: false, isWritable: false },
      // 4. pool_state
      { pubkey: poolState, isSigner: false, isWritable: true },
      // 5. token_0_mint
      { pubkey: token0, isSigner: false, isWritable: false },
      // 6. token_1_mint
      { pubkey: token1, isSigner: false, isWritable: false },
      // 7. lp_mint
      { pubkey: lpMint, isSigner: false, isWritable: true },
      // 8. creator_token_0
      { pubkey: adminToken0, isSigner: false, isWritable: true },
      // 9. creator_token_1
      { pubkey: adminToken1, isSigner: false, isWritable: true },
      // 10. creator_lp_token
      { pubkey: adminLpToken, isSigner: false, isWritable: true },
      // 11. token_0_vault
      { pubkey: vault0, isSigner: false, isWritable: true },
      // 12. token_1_vault
      { pubkey: vault1, isSigner: false, isWritable: true },
      // 13. create_pool_fee (using adminToken0 as fee receiver for simplicity)
      { pubkey: adminToken0, isSigner: false, isWritable: true },
      // 14. observation_state
      { pubkey: observationState, isSigner: false, isWritable: true },
      // 15. token_program (for LP mint)
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      // 16. token_0_program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      // 17. token_1_program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      // 18. associated_token_program
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      // 19. system_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      // 20. rent
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
    
    const poolInfo = await cpSwapProgram.account.poolState.fetch(poolState);
    console.log('LP supply:', poolInfo.lpSupply.toString());
    console.log('Authority type:', poolInfo.authType);
  });

  it('Submit and execute real swap', async () => {
    const userToken0 = await getAssociatedTokenAddress(token0, user.publicKey);
    const userToken1 = await getAssociatedTokenAddress(token1, user.publicKey);
    
    const before0 = await getAccount(provider.connection, userToken0);
    const before1 = await getAccount(provider.connection, userToken1);
    
    console.log('\nBefore swap:');
    console.log('Token0:', Number(before0.amount) / 10 ** 6);
    console.log('Token1:', Number(before1.amount) / 10 ** 9);
    
    // Submit order
    const amountIn = new BN(1000 * 10 ** 6);
    const minAmountOut = new BN(400 * 10 ** 9);
    
    const fifoStateBefore = await continuumProgram.account.fifoState.fetch(fifoStatePDA);
    const sequenceForPDA = fifoStateBefore.currentSequence;
    
    const [orderPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), user.publicKey.toBuffer(), sequenceForPDA.toArrayLike(Buffer, 'le', 8)],
      continuumProgram.programId
    );
    
    const [poolRegistryPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool_registry'), poolState.toBuffer()],
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
    
    console.log('✅ Order submitted');
    
    // Read the actual order to get the sequence
    const orderState = await continuumProgram.account.orderState.fetch(orderPDA);
    const actualSequence = orderState.sequence;
    console.log('Order sequence:', actualSequence.toString());
    
    // The PDA was created with sequenceForPDA, but the order stores actualSequence
    // For execute_order, we need to pass sequenceForPDA to find the PDA
    // But the constraint checks that order.sequence == expected_sequence
    // So we need to derive the PDA for the stored sequence minus 1
    const executeSequence = actualSequence.sub(new BN(1));
    console.log('PDA was created with sequence:', executeSequence.toString());
    console.log('Order stores sequence:', actualSequence.toString());
    
    // We need to derive the order PDA with the correct sequence
    const [correctOrderPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), user.publicKey.toBuffer(), executeSequence.toArrayLike(Buffer, 'le', 8)],
      continuumProgram.programId
    );
    
    // Execute order
    const [poolAuthorityPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('cp_pool_authority'), poolState.toBuffer()],
      continuumProgram.programId
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
    
    const cpSwapAccounts = [
      { pubkey: poolState, isSigner: false, isWritable: true },
      { pubkey: vault0, isSigner: false, isWritable: true },
      { pubkey: vault1, isSigner: false, isWritable: true },
      { pubkey: observationState, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];
    
    // Use the actual sequence from the order (what's stored)
    await continuumProgram.methods
      .executeOrder(actualSequence)
      .accounts({
        fifoState: fifoStatePDA,
        orderState: correctOrderPDA,
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
    
    console.log('✅ Order executed');
    
    const after0 = await getAccount(provider.connection, userToken0);
    const after1 = await getAccount(provider.connection, userToken1);
    
    console.log('\nAfter swap:');
    console.log('Token0:', Number(after0.amount) / 10 ** 6);
    console.log('Token1:', Number(after1.amount) / 10 ** 9);
    
    const swapped = Number(before0.amount) - Number(after0.amount);
    const received = Number(after1.amount) - Number(before1.amount);
    
    console.log('\n🎉 REAL TOKENS SWAPPED!');
    console.log('Swapped:', swapped / 10 ** 6, 'token0');
    console.log('Received:', received / 10 ** 9, 'token1');
    
    expect(swapped).to.equal(1000 * 10 ** 6);
    expect(received).to.be.greaterThan(400 * 10 ** 9);
  });
});