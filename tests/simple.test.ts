import * as anchor from '@coral-xyz/anchor';
import { Program, BN } from '@coral-xyz/anchor';
import { 
  Keypair, 
  PublicKey, 
  SystemProgram,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { expect } from 'chai';

describe('Simple Continuum Test', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.ContinuumCpSwap as Program;
  let fifoStatePDA: PublicKey;

  it('Check FIFO state', async () => {
    // Get FIFO state PDA
    [fifoStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('fifo_state')],
      program.programId
    );

    try {
      // Fetch existing FIFO state
      const fifoState = await program.account.fifoState.fetch(fifoStatePDA);
      console.log('✅ FIFO state exists');
      console.log('Current sequence:', fifoState.currentSequence.toNumber());
      console.log('Admin:', fifoState.admin.toString());
      console.log('Emergency pause:', fifoState.emergencyPause);
    } catch (err) {
      console.log('❌ FIFO state not found');
    }
  });

  it('Create AMM config on CP-Swap', async () => {
    const cpSwapProgram = anchor.workspace.RaydiumCpSwap as Program;
    
    // Try different indices
    for (let index = 0; index < 5; index++) {
      const [ammConfigPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('amm_config'),
          Buffer.from([index]),
        ],
        cpSwapProgram.programId
      );

      try {
        const config = await cpSwapProgram.account.ammConfig.fetch(ammConfigPDA);
        console.log(`✅ AMM config ${index} exists:`, ammConfigPDA.toString());
        return; // Found one, use it
      } catch (err) {
        // Try to create
        try {
          await cpSwapProgram.methods
            .createAmmConfig(
              index,
              new BN(10), // trade fee rate
              new BN(1000), // protocol fee rate  
              new BN(25000), // fund fee rate
              new BN(0) // create pool fee
            )
            .accounts({
              owner: provider.wallet.publicKey,
              ammConfig: ammConfigPDA,
              systemProgram: SystemProgram.programId,
            })
            .rpc();
          
          console.log(`✅ Created AMM config ${index}:`, ammConfigPDA.toString());
          return;
        } catch (createErr) {
          console.log(`Failed to create config ${index}:`, createErr.message);
        }
      }
    }
  });
});