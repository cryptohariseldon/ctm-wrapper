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
  getAssociatedTokenAddress
} from '@solana/spl-token';
import { expect } from 'chai';

// Import our programs
import { ContinuumCpSwap } from '../target/types/continuum_cp_swap';
import { RaydiumCpSwap } from '../../raydium-cp-swap/target/types/raydium_cp_swap';

describe('Pool Creation Test', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const continuumProgram = anchor.workspace.ContinuumCpSwap as Program<ContinuumCpSwap>;
  const cpSwapProgram = anchor.workspace.RaydiumCpSwap as Program<RaydiumCpSwap>;

  // Wallets
  const admin = provider.wallet as anchor.Wallet;
  
  // Token mints
  let tokenA: PublicKey;
  let tokenB: PublicKey;
  let mintAuthorityA: Keypair;
  let mintAuthorityB: Keypair;

  // PDAs
  let fifoStatePDA: PublicKey;
  let ammConfigPDA: PublicKey;
  let poolState: PublicKey;
  let poolAuthorityPDA: PublicKey;
  let poolRegistryPDA: PublicKey;

  const getPoolPDAs = (token0: PublicKey, token1: PublicKey, ammConfig: PublicKey) => {
    const [poolState] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('pool'),
        ammConfig.toBuffer(),
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
        token0.toBuffer(),
      ],
      cpSwapProgram.programId
    );

    const [vault1] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('pool_vault'),
        poolState.toBuffer(),
        token1.toBuffer(),
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
    console.log('Setting up pool creation test...');
    
    // Get FIFO state PDA
    [fifoStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('fifo_state')],
      continuumProgram.programId
    );

    // Create tokens
    mintAuthorityA = Keypair.generate();
    tokenA = await createMint(
      provider.connection,
      admin.payer,
      mintAuthorityA.publicKey,
      null,
      6
    );

    mintAuthorityB = Keypair.generate();
    tokenB = await createMint(
      provider.connection,
      admin.payer,
      mintAuthorityB.publicKey,
      null,
      6
    );

    console.log('Token A:', tokenA.toString());
    console.log('Token B:', tokenB.toString());

    // Mint tokens to admin
    const adminTokenA = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      tokenA,
      admin.publicKey
    );

    const adminTokenB = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      tokenB,
      admin.publicKey
    );

    await mintTo(
      provider.connection,
      admin.payer,
      tokenA,
      adminTokenA.address,
      mintAuthorityA,
      1000 * 10 ** 6
    );

    await mintTo(
      provider.connection,
      admin.payer,
      tokenB,
      adminTokenB.address,
      mintAuthorityB,
      1000 * 10 ** 6
    );

    console.log('Tokens minted to admin');
  });

  it('Find or create AMM config', async () => {
    // Try to find existing AMM config
    for (let index = 0; index < 10; index++) {
      const indexBuffer = Buffer.allocUnsafe(2);
      indexBuffer.writeUInt16BE(index, 0);
      
      const [configPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('amm_config'),
          indexBuffer,
        ],
        cpSwapProgram.programId
      );

      try {
        const config = await cpSwapProgram.account.ammConfig.fetch(configPDA);
        console.log(`✅ Found existing AMM config ${index}:`, configPDA.toString());
        ammConfigPDA = configPDA;
        return;
      } catch (err) {
        // Try to create
        try {
          await cpSwapProgram.methods
            .createAmmConfig(
              index,
              new BN(10),
              new BN(1000),
              new BN(25000),
              new BN(0)
            )
            .accounts({
              owner: admin.publicKey,
              ammConfig: configPDA,
              systemProgram: SystemProgram.programId,
            })
            .rpc();
          
          console.log(`✅ Created AMM config ${index}:`, configPDA.toString());
          ammConfigPDA = configPDA;
          return;
        } catch (createErr) {
          // Continue to next index
        }
      }
    }
    throw new Error('Could not find or create AMM config');
  });

  it('Initialize CP-Swap pool with Continuum authority', async () => {
    // Sort tokens
    const [token0, token1] = tokenA.toBuffer().compare(tokenB.toBuffer()) < 0 
      ? [tokenA, tokenB] 
      : [tokenB, tokenA];

    // Get pool PDAs
    const pdas = getPoolPDAs(token0, token1, ammConfigPDA);
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

    console.log('Pool state:', poolState.toString());
    console.log('Continuum authority:', poolAuthorityPDA.toString());

    // Get admin token accounts
    const adminToken0 = await getAssociatedTokenAddress(token0, admin.publicKey);
    const adminToken1 = await getAssociatedTokenAddress(token1, admin.publicKey);
    const adminLpToken = await getAssociatedTokenAddress(pdas.lpMint, admin.publicKey);

    // Fee receiver token account
    const feeReceiverToken0 = await getAssociatedTokenAddress(
      token0,
      admin.publicKey
    );

    // Initialize pool through Continuum
    const initAmount0 = new BN(100 * 10 ** 6);
    const initAmount1 = new BN(200 * 10 ** 6);
    const openTime = new BN(0);

    // Build the CP-Swap accounts list
    const cpSwapAccounts = [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: ammConfigPDA, isSigner: false, isWritable: false },
      { pubkey: poolAuthorityPDA, isSigner: false, isWritable: false },
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
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
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
  });
});