import { TransactionInstruction, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
export declare function createSubmitOrderInstruction(user: PublicKey, poolId: PublicKey, amountIn: BN, minAmountOut: BN, isBaseInput: boolean, currentSequence: BN): Promise<TransactionInstruction>;
