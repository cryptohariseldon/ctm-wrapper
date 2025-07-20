#!/usr/bin/env ts-node

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const PROGRAM_ID = 'EaeWUSam5Li1fzCcCs33oE4jCLQT4F6RJXgrPYZaoKqq';

async function deployProgram() {
  console.log('🚀 Deploying Continuum CP-Swap with Admin Setup\n');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const adminKeypairPath = args.find(arg => arg.startsWith('--admin='))?.split('=')[1] || 
                          path.join(process.env.HOME!, '.config/solana/admin-keypair.json');
  const cluster = args.find(arg => arg.startsWith('--cluster='))?.split('=')[1] || 'devnet';
  
  // Load admin keypair
  let adminKeypair: Keypair;
  if (fs.existsSync(adminKeypairPath)) {
    console.log(`Loading admin keypair from: ${adminKeypairPath}`);
    const keypairData = JSON.parse(fs.readFileSync(adminKeypairPath, 'utf8'));
    adminKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
  } else {
    console.log('Admin keypair not found, generating new one...');
    adminKeypair = Keypair.generate();
    fs.writeFileSync(adminKeypairPath, JSON.stringify(Array.from(adminKeypair.secretKey)));
    console.log(`Admin keypair saved to: ${adminKeypairPath}`);
  }
  
  console.log(`Admin address: ${adminKeypair.publicKey.toBase58()}`);
  console.log(`Cluster: ${cluster}\n`);

  // Setup connection and provider
  const connection = new Connection(
    cluster === 'devnet' ? 'https://api.devnet.solana.com' : 
    cluster === 'mainnet' ? 'https://api.mainnet-beta.solana.com' : 
    'http://localhost:8899'
  );

  // Check admin balance
  const balance = await connection.getBalance(adminKeypair.publicKey);
  console.log(`Admin balance: ${balance / 1e9} SOL`);
  
  if (balance < 2 * 1e9) {
    if (cluster === 'devnet') {
      console.log('Low balance, requesting airdrop...');
      const sig = await connection.requestAirdrop(adminKeypair.publicKey, 2 * 1e9);
      await connection.confirmTransaction(sig);
      console.log('Airdrop confirmed\n');
    } else {
      console.error('Insufficient balance for deployment. Please fund the admin account.');
      process.exit(1);
    }
  }

  // Build the program
  console.log('📦 Building program...');
  const programDir = path.join(__dirname, '../programs/continuum-cp-swap');
  process.chdir(programDir);
  
  try {
    execSync('anchor build', { stdio: 'inherit' });
    console.log('✅ Build successful\n');
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }

  // Deploy the program
  console.log('📤 Deploying program...');
  try {
    execSync(`anchor deploy --provider.cluster ${cluster} --provider.wallet ${adminKeypairPath}`, { 
      stdio: 'inherit' 
    });
    console.log('✅ Deployment successful\n');
  } catch (error) {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  }

  // Initialize the program
  console.log('🔧 Initializing program state...');
  
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(adminKeypair),
    { commitment: 'confirmed' }
  );
  anchor.setProvider(provider);

  // Load the IDL
  const idlPath = path.join(programDir, 'target/idl/continuum_cp_swap.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
  
  const program = new Program(idl, PROGRAM_ID, provider);
  
  // Derive PDAs
  const [fifoState] = PublicKey.findProgramAddressSync(
    [Buffer.from('fifo_state')],
    program.programId
  );

  try {
    // Check if already initialized
    const account = await connection.getAccountInfo(fifoState);
    if (account) {
      console.log('Program already initialized');
      const fifoData = await program.account.fifoState.fetch(fifoState);
      console.log('Current admin:', fifoData.admin.toBase58());
      console.log('Current sequence:', fifoData.currentSequence.toString());
      console.log('Authorized relayers:', fifoData.authorizedRelayers.map(r => r.toBase58()));
    } else {
      // Initialize
      const tx = await program.methods
        .initialize()
        .accounts({
          fifoState,
          admin: adminKeypair.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      
      console.log('✅ Program initialized');
      console.log('Transaction signature:', tx);
    }
  } catch (error) {
    console.error('Initialization error:', error);
  }

  // Save deployment info
  const deploymentInfo = {
    programId: PROGRAM_ID,
    adminPublicKey: adminKeypair.publicKey.toBase58(),
    fifoState: fifoState.toBase58(),
    cluster,
    deployedAt: new Date().toISOString(),
  };
  
  const deploymentPath = path.join(__dirname, `../deployment-${cluster}.json`);
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n📄 Deployment info saved to: ${deploymentPath}`);
  
  console.log('\n✨ Deployment complete!');
  console.log('\nNext steps:');
  console.log('1. Add authorized relayers:');
  console.log(`   ts-node scripts/add-relayer.ts --admin=${adminKeypairPath} --relayer=<RELAYER_PUBKEY>`);
  console.log('2. Update relayer configuration with the program ID');
  console.log('3. Start the relayer service');
}

deployProgram()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Deployment failed:', error);
    process.exit(1);
  });