import { TransactionInstruction, PublicKey, SystemProgram } from '@solana/web3.js';
import { CONTINUUM_PROGRAM_ID } from '../constants';
import { getFifoStatePDA } from '../utils/pda';
import * as anchor from '@coral-xyz/anchor';

export function createInitializeInstruction(
  admin: PublicKey
): TransactionInstruction {
  const [fifoState] = getFifoStatePDA();
  
  const keys = [
    { pubkey: fifoState, isSigner: false, isWritable: true },
    { pubkey: admin, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Discriminator for initialize: [175, 175, 109, 31, 13, 152, 155, 237]
  const data = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);

  return new TransactionInstruction({
    keys,
    programId: CONTINUUM_PROGRAM_ID,
    data,
  });
}