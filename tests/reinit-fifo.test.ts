import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';

describe('Reinitialize FIFO', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.ContinuumCpSwap as Program;
  const admin = provider.wallet as anchor.Wallet;

  it('Close and reinitialize FIFO state', async () => {
    const [fifoStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('fifo_state')],
      program.programId
    );

    try {
      // Check current state
      const fifoState = await program.account.fifoState.fetch(fifoStatePDA);
      console.log('Current admin:', fifoState.admin.toString());
      console.log('Our wallet:', admin.publicKey.toString());
      
      if (!fifoState.admin.equals(admin.publicKey)) {
        console.log('Admin mismatch - we cannot proceed with the current wallet');
        console.log('The FIFO state is owned by another wallet');
        return;
      }
    } catch (err) {
      console.log('FIFO state not found, initializing...');
    }

    // Try to initialize with current wallet
    try {
      await program.methods
        .initialize()
        .accounts({
          fifoState: fifoStatePDA,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin.payer])
        .rpc();

      console.log('✅ FIFO state initialized with current wallet');
    } catch (err) {
      console.log('Failed to initialize:', err.message);
    }
  });
});