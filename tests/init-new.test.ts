import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { expect } from 'chai';

describe('Initialize New Continuum', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.ContinuumCpSwap as Program;
  const admin = provider.wallet as anchor.Wallet;

  it('Initialize FIFO state with current wallet', async () => {
    const [fifoStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('fifo_state')],
      program.programId
    );

    console.log('Program ID:', program.programId.toString());
    console.log('FIFO State PDA:', fifoStatePDA.toString());
    console.log('Admin wallet:', admin.publicKey.toString());

    // Initialize
    await program.methods
      .initialize()
      .accounts({
        fifoState: fifoStatePDA,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Verify
    const fifoState = await program.account.fifoState.fetch(fifoStatePDA);
    expect(fifoState.currentSequence.toNumber()).to.equal(0);
    expect(fifoState.admin.toString()).to.equal(admin.publicKey.toString());
    expect(fifoState.emergencyPause).to.equal(false);

    console.log('✅ FIFO state initialized successfully');
    console.log('Admin:', fifoState.admin.toString());
    console.log('Current sequence:', fifoState.currentSequence.toNumber());
  });
});