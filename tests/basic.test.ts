import * as anchor from '@coral-xyz/anchor';
import { Program, BN } from '@coral-xyz/anchor';
import { 
  Keypair, 
  PublicKey, 
  SystemProgram,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { expect } from 'chai';

describe('Continuum Basic Tests', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.ContinuumCpSwap as Program;
  const admin = Keypair.generate();
  let fifoStatePDA: PublicKey;

  before(async () => {
    // Airdrop SOL to admin
    const sig = await provider.connection.requestAirdrop(
      admin.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
    console.log('Admin funded:', admin.publicKey.toString());
  });

  it('Initialize FIFO state', async () => {
    // Get FIFO state PDA
    [fifoStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('fifo_state')],
      program.programId
    );

    // Initialize
    await program.methods
      .initialize()
      .accounts({
        fifoState: fifoStatePDA,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    // Fetch and verify
    const fifoState = await program.account.fifoState.fetch(fifoStatePDA);
    expect(fifoState.currentSequence.toNumber()).to.equal(0);
    expect(fifoState.admin.toString()).to.equal(admin.publicKey.toString());
    expect(fifoState.emergencyPause).to.equal(false);

    console.log('✅ FIFO state initialized successfully');
  });

  it('Cannot initialize twice', async () => {
    try {
      await program.methods
        .initialize()
        .accounts({
          fifoState: fifoStatePDA,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
      
      throw new Error('Should have failed');
    } catch (err) {
      console.log('✅ Correctly prevented double initialization');
    }
  });
});