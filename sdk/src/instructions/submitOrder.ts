import { TransactionInstruction, PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';
import { CONTINUUM_PROGRAM_ID } from '../constants';
import { getFifoStatePDA, getPoolRegistryPDA, getOrderPDA } from '../utils/pda';
import BN from 'bn.js';

export async function createSubmitOrderInstruction(
  user: PublicKey,
  poolId: PublicKey,
  amountIn: BN,
  minAmountOut: BN,
  isBaseInput: boolean,
  currentSequence: BN
): Promise<TransactionInstruction> {
  const [fifoState] = getFifoStatePDA();
  const [poolRegistry] = getPoolRegistryPDA(poolId);
  const nextSequence = currentSequence.add(new BN(1));
  const [orderState] = getOrderPDA(user, nextSequence);
  
  const keys = [
    { pubkey: fifoState, isSigner: false, isWritable: true },
    { pubkey: poolRegistry, isSigner: false, isWritable: false },
    { pubkey: orderState, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: poolId, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
  ];

  // Discriminator for submit_order: [230, 150, 200, 53, 92, 208, 109, 108]
  const discriminator = Buffer.from([230, 150, 200, 53, 92, 208, 109, 108]);
  
  // Encode arguments
  const data = Buffer.concat([
    discriminator,
    amountIn.toArrayLike(Buffer, 'le', 8),
    minAmountOut.toArrayLike(Buffer, 'le', 8),
    Buffer.from([isBaseInput ? 1 : 0]),
  ]);

  return new TransactionInstruction({
    keys,
    programId: CONTINUUM_PROGRAM_ID,
    data,
  });
}