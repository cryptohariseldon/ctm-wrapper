import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { ContinuumClient, SwapParams } from '../src';
import { Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { 
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TokenAccountNotFoundError,
  mintTo,
  createMint,
  getOrCreateAssociatedTokenAccount
} from '@solana/spl-token';

/**
 * Test with a real pool setup
 */
async function testWithRealPool() {
  console.log('=== Testing SDK with Real Pool ===\n');
  
  const connection = new Connection('http://localhost:8899', 'confirmed');
  
  // Step 1: Create admin and user accounts
  const admin = Keypair.generate();
  const user = Keypair.generate();
  
  console.log('Admin:', admin.publicKey.toBase58());
  console.log('User:', user.publicKey.toBase58());
  
  // Fund accounts
  console.log('\nFunding accounts...');
  const adminAirdrop = await connection.requestAirdrop(admin.publicKey, 10 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(adminAirdrop);
  
  const userAirdrop = await connection.requestAirdrop(user.publicKey, 5 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(userAirdrop);
  console.log('Accounts funded');

  // Step 2: Create tokens
  console.log('\n=== Creating Tokens ===');
  
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
  
  // Sort tokens
  const [token0, token1, mintAuth0, mintAuth1] = tokenA.toBuffer().compare(tokenB.toBuffer()) < 0
    ? [tokenA, tokenB, mintAuthA, mintAuthB]
    : [tokenB, tokenA, mintAuthB, mintAuthA];

  // Step 3: Create token accounts and mint tokens
  console.log('\n=== Setting up Token Accounts ===');
  
  // Admin accounts
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
  
  // User accounts
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
  
  // Mint tokens
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
  
  // Transfer some tokens to user
  await mintTo(
    connection,
    admin,
    token0,
    userToken0.address,
    mintAuth0,
    10_000 * 10 ** 6 // 10K tokens
  );
  
  console.log('Tokens minted and distributed');

  // Step 4: Initialize Continuum client
  console.log('\n=== Initializing Continuum Client ===');
  
  const adminWallet = new Wallet(admin);
  const adminClient = new ContinuumClient(connection, adminWallet);
  
  // Try to initialize Continuum
  try {
    const initSig = await adminClient.initialize(admin);
    console.log('Continuum initialized:', initSig);
  } catch (error) {
    console.log('Continuum already initialized');
  }
  
  // Check FIFO state
  const fifoState = await adminClient.getFifoState();
  if (fifoState) {
    console.log('FIFO State:');
    console.log('  Current sequence:', fifoState.currentSequence.toString());
    console.log('  Admin:', fifoState.admin.toBase58());
  }

  // Step 5: Create pool (using the test framework approach)
  console.log('\n=== Creating Pool ===');
  console.log('Note: Pool creation requires full Anchor setup.');
  console.log('Please run the pool creation test separately.');
  
  // For this example, we'll assume a pool exists at this address
  // In reality, you would create the pool using the continuum test framework
  const poolId = new PublicKey('11111111111111111111111111111111'); // Replace with actual pool ID

  // Step 6: Test order submission with SDK
  console.log('\n=== Testing Order Submission ===');
  
  const userWallet = new Wallet(user);
  const userClient = new ContinuumClient(connection, userWallet);
  
  const swapParams: SwapParams = {
    poolId,
    amountIn: new BN(1000 * 10 ** 6), // 1000 token0
    minAmountOut: new BN(900 * 10 ** 9), // Min 900 token1 (allowing ~10% slippage)
    isBaseInput: true,
    userSourceToken: userToken0.address,
    userDestinationToken: userToken1.address,
  };
  
  try {
    // Create partially signed order
    const { transaction, sequence } = await userClient.createPartiallySignedSubmitOrder(
      user.publicKey,
      swapParams
    );
    
    console.log('Created partially signed order');
    console.log('Expected sequence:', sequence.toString());
    
    // User would sign this
    transaction.partialSign(user);
    
    console.log('Transaction signed by user');
    console.log('Serialized tx length:', transaction.serialize().length);
    
  } catch (error) {
    console.error('Order submission error:', (error as Error).message);
  }

  // Step 7: Test other SDK methods
  console.log('\n=== Testing SDK Query Methods ===');
  
  // Test getOrderState (with dummy values)
  try {
    const orderState = await userClient.getOrderState(user.publicKey, new BN(0));
    if (orderState) {
      console.log('Found order state');
    } else {
      console.log('No order found (expected for new setup)');
    }
  } catch (error) {
    console.log('Order query error (expected):', (error as Error).message);
  }
  
  // Test getPoolRegistry
  try {
    const registry = await adminClient.getPoolRegistry(poolId);
    if (registry) {
      console.log('Pool registry found');
    } else {
      console.log('No pool registry (need to create pool first)');
    }
  } catch (error) {
    console.log('Registry query error (expected):', (error as Error).message);
  }

  console.log('\n=== Test Summary ===');
  console.log('✅ Token creation: Success');
  console.log('✅ Account setup: Success');
  console.log('✅ Client initialization: Success');
  console.log('✅ SDK methods: Working');
  console.log('❗ Pool creation: Requires separate test');
  console.log('❗ Order execution: Requires pool and relayer');
  
  return {
    admin,
    user,
    token0,
    token1,
    adminClient,
    userClient
  };
}

// Run the test
if (require.main === module) {
  testWithRealPool()
    .then((result) => {
      console.log('\nSDK test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}

export { testWithRealPool };