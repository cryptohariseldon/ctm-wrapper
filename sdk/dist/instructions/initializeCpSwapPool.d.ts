import { TransactionInstruction, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
export interface InitializeCpSwapPoolParams {
    admin: PublicKey;
    poolState: PublicKey;
    initAmount0: BN;
    initAmount1: BN;
    openTime: BN;
    cpSwapAccounts: PublicKey[];
}
export declare function createInitializeCpSwapPoolInstruction(params: InitializeCpSwapPoolParams): TransactionInstruction;
