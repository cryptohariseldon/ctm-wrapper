import { TransactionInstruction, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
export declare function createCancelOrderInstruction(user: PublicKey, sequence: BN): TransactionInstruction;
