import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import BN from 'bn.js';
import { CONTINUUM_PROGRAM_ID } from '../constants';
import { getFifoStatePDA } from '../utils';

export interface SwapImmediateParams {
  user: PublicKey;
  cpSwapProgram: PublicKey;
  poolId: PublicKey;
  amountIn: BN;
  minAmountOut: BN;
  isBaseInput: boolean;
  poolAuthorityBump: number;
  remainingAccounts: Array<{
    pubkey: PublicKey;
    isSigner: boolean;
    isWritable: boolean;
  }>;
}

export function createSwapImmediateInstruction(
  params: SwapImmediateParams
): TransactionInstruction {
  const {
    user,
    cpSwapProgram,
    poolId,
    amountIn,
    minAmountOut,
    isBaseInput,
    poolAuthorityBump,
    remainingAccounts
  } = params;

  const [fifoState] = getFifoStatePDA();

  const keys = [
    { pubkey: fifoState, isSigner: false, isWritable: true },
    { pubkey: cpSwapProgram, isSigner: false, isWritable: false },
    ...remainingAccounts
  ];

  // Instruction discriminator for swap_immediate
  const discriminator = Buffer.from([175, 131, 44, 121, 171, 170, 38, 18]);
  
  const data = Buffer.concat([
    discriminator,
    amountIn.toArrayLike(Buffer, 'le', 8),
    minAmountOut.toArrayLike(Buffer, 'le', 8),
    Buffer.from([isBaseInput ? 1 : 0]),
    poolId.toBuffer(),
    Buffer.from([poolAuthorityBump])
  ]);

  return new TransactionInstruction({
    keys,
    programId: CONTINUUM_PROGRAM_ID,
    data
  });
}