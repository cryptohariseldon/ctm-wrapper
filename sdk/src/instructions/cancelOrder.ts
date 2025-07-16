import { TransactionInstruction, PublicKey, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';
import { CONTINUUM_PROGRAM_ID } from '../constants';
import { getOrderPDA } from '../utils/pda';
import BN from 'bn.js';

export function createCancelOrderInstruction(
  user: PublicKey,
  sequence: BN
): TransactionInstruction {
  const [orderState] = getOrderPDA(user, sequence);
  
  const keys = [
    { pubkey: orderState, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
  ];

  // Discriminator for cancel_order: [95, 129, 237, 240, 8, 49, 223, 132]
  const data = Buffer.from([95, 129, 237, 240, 8, 49, 223, 132]);

  return new TransactionInstruction({
    keys,
    programId: CONTINUUM_PROGRAM_ID,
    data,
  });
}