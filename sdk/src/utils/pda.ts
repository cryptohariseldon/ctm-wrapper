import { PublicKey } from '@solana/web3.js';
import { 
  CONTINUUM_PROGRAM_ID,
  FIFO_STATE_SEED,
  POOL_REGISTRY_SEED,
  CP_POOL_AUTHORITY_SEED,
  ORDER_SEED 
} from '../constants';
import BN from 'bn.js';

export function getFifoStatePDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [FIFO_STATE_SEED],
    CONTINUUM_PROGRAM_ID
  );
}

export function getPoolRegistryPDA(poolId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [POOL_REGISTRY_SEED, poolId.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );
}

export function getPoolAuthorityPDA(poolId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [CP_POOL_AUTHORITY_SEED, poolId.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );
}

export function getOrderPDA(user: PublicKey, sequence: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ORDER_SEED, user.toBuffer(), sequence.toArrayLike(Buffer, 'le', 8)],
    CONTINUUM_PROGRAM_ID
  );
}