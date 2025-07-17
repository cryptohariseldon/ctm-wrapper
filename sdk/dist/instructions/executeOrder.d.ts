import { TransactionInstruction, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
export interface ExecuteOrderParams {
    executor: PublicKey;
    orderUser: PublicKey;
    sequence: BN;
    poolId: PublicKey;
    userSource: PublicKey;
    userDestination: PublicKey;
    cpSwapRemainingAccounts: PublicKey[];
}
export declare function createExecuteOrderInstruction(params: ExecuteOrderParams): TransactionInstruction;
