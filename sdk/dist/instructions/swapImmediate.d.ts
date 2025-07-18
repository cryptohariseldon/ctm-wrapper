import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import BN from 'bn.js';
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
export declare function createSwapImmediateInstruction(params: SwapImmediateParams): TransactionInstruction;
