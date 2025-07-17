import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
export declare function getFifoStatePDA(): [PublicKey, number];
export declare function getPoolRegistryPDA(poolId: PublicKey): [PublicKey, number];
export declare function getPoolAuthorityPDA(poolId: PublicKey): [PublicKey, number];
export declare function getOrderPDA(user: PublicKey, sequence: BN): [PublicKey, number];
