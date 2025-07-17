import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { ContinuumClient } from '../src';
import BN from 'bn.js';
import { 
  createMint, 
  getOrCreateAssociatedTokenAccount, 
  mintTo
} from '@solana/spl-token';

/**
 * Test basic flow without full Anchor setup
 */
async function testBasicFlow() {
  console.log('=== Testing Basic Continuum Flow ===\n');
  
  const connection = new Connection('http://localhost:8899', 'confirmed');
  
  // Create test keypair
  const testUser = Keypair.generate();
  
  // Airdrop SOL
  console.log('Requesting airdrop...');
  const airdropSig = await connection.requestAirdrop(testUser.publicKey, 5e9);
  await connection.confirmTransaction(airdropSig);
  console.log('Airdrop successful');
  
  // Initialize client (without wallet for now)
  const client = new ContinuumClient(connection);
  
  console.log('\n=== Testing Client Methods ===');
  
  // Test getFifoState
  try {
    const fifoState = await client.getFifoState();
    if (fifoState) {
      console.log('FIFO State found:');
      console.log('  Current sequence:', fifoState.currentSequence.toString());
      console.log('  Admin:', fifoState.admin.toBase58());
      console.log('  Emergency pause:', fifoState.emergencyPause);
    } else {
      console.log('FIFO State not initialized');
    }
  } catch (error) {
    console.log('FIFO State error:', (error as Error).message);
  }
  
  // Test pool registry lookup
  const testPoolId = new PublicKey('11111111111111111111111111111111'); // Dummy pool ID
  try {
    const registry = await client.getPoolRegistry(testPoolId);
    if (registry) {
      console.log('\nPool Registry found for pool:', testPoolId.toBase58());
    } else {
      console.log('\nNo pool registry found for test pool');
    }
  } catch (error) {
    console.log('Pool registry error:', error.message);
  }
  
  console.log('\n=== Creating Test Tokens ===');
  
  // Create test tokens
  const mintAuthority = Keypair.generate();
  
  const tokenA = await createMint(
    connection,
    testUser,
    mintAuthority.publicKey,
    null,
    6
  );
  console.log('Token A:', tokenA.toBase58());
  
  const tokenB = await createMint(
    connection,
    testUser,
    mintAuthority.publicKey,
    null,
    9
  );
  console.log('Token B:', tokenB.toBase58());
  
  // Create token accounts
  const userTokenA = await getOrCreateAssociatedTokenAccount(
    connection,
    testUser,
    tokenA,
    testUser.publicKey
  );
  
  const userTokenB = await getOrCreateAssociatedTokenAccount(
    connection,
    testUser,
    tokenB,
    testUser.publicKey
  );
  
  // Mint tokens
  await mintTo(
    connection,
    testUser,
    tokenA,
    userTokenA.address,
    mintAuthority,
    1000 * 10 ** 6
  );
  
  await mintTo(
    connection,
    testUser,
    tokenB,
    userTokenB.address,
    mintAuthority,
    500 * 10 ** 9
  );
  
  console.log('\nTokens minted successfully');
  console.log('User Token A balance: 1000');
  console.log('User Token B balance: 500');
  
  console.log('\n=== Test Completed Successfully ===');
  
  return {
    testUser,
    tokenA,
    tokenB,
    userTokenA: userTokenA.address,
    userTokenB: userTokenB.address
  };
}

// Run the test
if (require.main === module) {
  testBasicFlow()
    .then((result) => {
      console.log('\nTest completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}

export { testBasicFlow };