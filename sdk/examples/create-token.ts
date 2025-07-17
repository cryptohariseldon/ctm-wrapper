import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { 
  createMint, 
  getOrCreateAssociatedTokenAccount, 
  mintTo,
  getMint,
  getAccount
} from '@solana/spl-token';

/**
 * Example: Create SPL tokens for use with Continuum CP-Swap
 */
async function createTokenExample() {
  // Configuration
  const connection = new Connection('http://localhost:8899', 'confirmed');
  
  // Create payer keypair (in production, use your wallet)
  const payer = Keypair.generate();
  
  // Airdrop SOL for fees (localnet only)
  console.log('Requesting airdrop...');
  const airdropSig = await connection.requestAirdrop(
    payer.publicKey,
    2e9 // 2 SOL
  );
  await connection.confirmTransaction(airdropSig);
  console.log('Airdrop successful');

  // Create mint authority keypair
  const mintAuthority = Keypair.generate();
  const freezeAuthority = null; // No freeze authority

  console.log('\n=== Creating Token A ===');
  
  // Create Token A
  const tokenA = await createMint(
    connection,
    payer,
    mintAuthority.publicKey,
    freezeAuthority,
    6 // 6 decimals (like USDC)
  );
  
  console.log('Token A mint created:', tokenA.toBase58());
  
  // Get mint info
  const mintInfoA = await getMint(connection, tokenA);
  console.log('Token A supply:', mintInfoA.supply.toString());
  console.log('Token A decimals:', mintInfoA.decimals);

  console.log('\n=== Creating Token B ===');
  
  // Create Token B
  const tokenB = await createMint(
    connection,
    payer,
    mintAuthority.publicKey,
    freezeAuthority,
    9 // 9 decimals (like SOL)
  );
  
  console.log('Token B mint created:', tokenB.toBase58());
  
  // Get mint info
  const mintInfoB = await getMint(connection, tokenB);
  console.log('Token B supply:', mintInfoB.supply.toString());
  console.log('Token B decimals:', mintInfoB.decimals);

  console.log('\n=== Creating Token Accounts ===');
  
  // Create associated token accounts for payer
  const payerTokenAccountA = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    tokenA,
    payer.publicKey
  );
  
  console.log('Payer Token A account:', payerTokenAccountA.address.toBase58());
  
  const payerTokenAccountB = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    tokenB,
    payer.publicKey
  );
  
  console.log('Payer Token B account:', payerTokenAccountB.address.toBase58());

  console.log('\n=== Minting Tokens ===');
  
  // Mint tokens to payer
  const mintAmountA = 1_000_000 * 10 ** mintInfoA.decimals; // 1M tokens
  await mintTo(
    connection,
    payer,
    tokenA,
    payerTokenAccountA.address,
    mintAuthority,
    mintAmountA
  );
  
  console.log(`Minted ${mintAmountA / 10 ** mintInfoA.decimals} Token A`);
  
  const mintAmountB = 500_000 * 10 ** mintInfoB.decimals; // 500K tokens
  await mintTo(
    connection,
    payer,
    tokenB,
    payerTokenAccountB.address,
    mintAuthority,
    mintAmountB
  );
  
  console.log(`Minted ${mintAmountB / 10 ** mintInfoB.decimals} Token B`);

  // Check balances
  const accountInfoA = await getAccount(connection, payerTokenAccountA.address);
  const accountInfoB = await getAccount(connection, payerTokenAccountB.address);
  
  console.log('\n=== Final Balances ===');
  console.log(`Token A balance: ${Number(accountInfoA.amount) / 10 ** mintInfoA.decimals}`);
  console.log(`Token B balance: ${Number(accountInfoB.amount) / 10 ** mintInfoB.decimals}`);

  console.log('\n=== Summary ===');
  console.log('Token A:', tokenA.toBase58());
  console.log('Token B:', tokenB.toBase58());
  console.log('Payer:', payer.publicKey.toBase58());
  console.log('Mint Authority:', mintAuthority.publicKey.toBase58());
  
  return {
    tokenA,
    tokenB,
    payer,
    mintAuthority,
    payerTokenAccountA: payerTokenAccountA.address,
    payerTokenAccountB: payerTokenAccountB.address
  };
}

// Advanced example: Create token with metadata
async function createTokenWithMetadata() {
  const connection = new Connection('http://localhost:8899', 'confirmed');
  const payer = Keypair.generate();
  
  // Request airdrop
  const airdropSig = await connection.requestAirdrop(payer.publicKey, 2e9);
  await connection.confirmTransaction(airdropSig);
  
  const mintAuthority = Keypair.generate();
  
  // Create mint
  const mint = await createMint(
    connection,
    payer,
    mintAuthority.publicKey,
    null, // freeze authority
    6,    // decimals
    undefined, // keypair (let it generate)
    undefined, // confirm options
    undefined  // token program
  );
  
  console.log('Token mint created:', mint.toBase58());
  
  // Note: To add metadata, you would use the Metaplex Token Metadata program
  // This requires additional setup and is beyond the basic token creation
  
  return { mint, payer, mintAuthority };
}

// Run the example
if (require.main === module) {
  createTokenExample()
    .then((result) => {
      console.log('\nToken creation completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Error creating tokens:', error);
      process.exit(1);
    });
}

export { createTokenExample, createTokenWithMetadata };