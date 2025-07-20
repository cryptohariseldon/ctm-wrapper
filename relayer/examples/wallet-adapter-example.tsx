import React, { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useConnection } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Configuration
const RELAYER_URL = process.env.REACT_APP_RELAYER_URL || 'http://localhost:8085';
const CONTINUUM_PROGRAM_ID = new PublicKey('9tcAhE4XGcZZTE8ez1EW8FF7rxyBN8uat2kkepgaeyEa');
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

interface SwapButtonProps {
  poolId: string;
  amountIn: string;
  minAmountOut?: string;
  isBaseInput?: boolean;
}

export function SwapButton({ 
  poolId, 
  amountIn, 
  minAmountOut = '0',
  isBaseInput = true 
}: SwapButtonProps) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [orderId, setOrderId] = useState<string>('');

  const buildSwapInstruction = useCallback(async (
    userPublicKey: PublicKey,
    relayerPublicKey: PublicKey,
    poolInfo: any
  ) => {
    // Import anchor dynamically to avoid SSR issues
    const anchor = await import('@coral-xyz/anchor');
    const { Program } = anchor;
    
    // Load IDL (in production, this should be imported properly)
    const idlResponse = await fetch('/continuum_cp_swap.json');
    const idl = await idlResponse.json();
    
    // Create program interface
    const program = new Program(idl, CONTINUUM_PROGRAM_ID);
    
    // Derive PDAs
    const [fifoState] = PublicKey.findProgramAddressSync(
      [Buffer.from('fifo_state')],
      CONTINUUM_PROGRAM_ID
    );
    
    const poolPubkey = new PublicKey(poolId);
    const [poolAuthority, poolAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('cp_pool_authority'), poolPubkey.toBuffer()],
      CONTINUUM_PROGRAM_ID
    );
    
    const [cpSwapAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault_and_lp_mint_auth_seed')],
      CP_SWAP_PROGRAM_ID
    );
    
    // Parse pool data
    const tokenAMint = new PublicKey(poolInfo.tokenA.mint);
    const tokenBMint = new PublicKey(poolInfo.tokenB.mint);
    const ammConfig = new PublicKey(poolInfo.ammConfig || '5XoBUe5w3xSjRMgaPSwyA2ujH7eBBH5nD5L9H2ws841B');
    const observationState = new PublicKey(poolInfo.observationState || '7GZfqjfsHzWu68DMtgCbpjN18a1e3hrZ1kqS2zWhJVHP');
    
    // Get user token accounts
    const userTokenA = getAssociatedTokenAddressSync(tokenAMint, userPublicKey);
    const userTokenB = getAssociatedTokenAddressSync(tokenBMint, userPublicKey);
    
    // Determine input/output accounts
    const userInputAccount = isBaseInput ? userTokenA : userTokenB;
    const userOutputAccount = isBaseInput ? userTokenB : userTokenA;
    
    // Build instruction
    const swapIx = await program.methods
      .swapImmediate(
        new BN(amountIn),
        new BN(minAmountOut),
        isBaseInput,
        poolPubkey,
        poolAuthorityBump
      )
      .accountsPartial({
        fifoState,
        relayer: relayerPublicKey, // Relayer as co-signer
        cpSwapProgram: CP_SWAP_PROGRAM_ID,
      })
      .remainingAccounts([
        // CP-Swap accounts
        { pubkey: userPublicKey, isSigner: true, isWritable: false },
        { pubkey: cpSwapAuthority, isSigner: false, isWritable: false },
        { pubkey: ammConfig, isSigner: false, isWritable: false },
        { pubkey: poolPubkey, isSigner: false, isWritable: true },
        { pubkey: userInputAccount, isSigner: false, isWritable: true },
        { pubkey: userOutputAccount, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(poolInfo.tokenAVault), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(poolInfo.tokenBVault), isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: tokenAMint, isSigner: false, isWritable: false },
        { pubkey: tokenBMint, isSigner: false, isWritable: false },
        { pubkey: observationState, isSigner: false, isWritable: true },
      ])
      .instruction();
    
    return swapIx;
  }, [poolId, amountIn, minAmountOut, isBaseInput]);

  const handleSwap = useCallback(async () => {
    if (!publicKey || !signTransaction) {
      alert('Please connect your wallet');
      return;
    }
    
    setLoading(true);
    setStatus('Preparing swap...');
    
    try {
      // 1. Get relayer info
      setStatus('Fetching relayer info...');
      const relayerResponse = await fetch(`${RELAYER_URL}/api/v1/info`);
      const relayerInfo = await relayerResponse.json();
      const relayerPublicKey = new PublicKey(relayerInfo.relayerAddress);
      
      // 2. Get pool info
      setStatus('Fetching pool info...');
      const poolResponse = await fetch(`${RELAYER_URL}/api/v1/pools/${poolId}/price`);
      const poolInfo = await poolResponse.json();
      
      // 3. Build swap instruction
      setStatus('Building transaction...');
      const swapIx = await buildSwapInstruction(publicKey, relayerPublicKey, poolInfo);
      
      // 4. Add compute budget
      const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 300000
      });
      
      // 5. Check if output token account exists
      const outputMint = isBaseInput ? 
        new PublicKey(poolInfo.tokenB.mint) : 
        new PublicKey(poolInfo.tokenA.mint);
      const outputAccount = getAssociatedTokenAddressSync(outputMint, publicKey);
      
      const instructions = [computeBudgetIx];
      
      const outputAccountInfo = await connection.getAccountInfo(outputAccount);
      if (!outputAccountInfo) {
        setStatus('Creating output token account...');
        const { createAssociatedTokenAccountInstruction, ASSOCIATED_TOKEN_PROGRAM_ID } = 
          await import('@solana/spl-token');
        
        instructions.push(
          createAssociatedTokenAccountInstruction(
            publicKey,
            outputAccount,
            publicKey,
            outputMint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      }
      
      instructions.push(swapIx);
      
      // 6. Create versioned transaction
      setStatus('Creating transaction...');
      const { blockhash } = await connection.getLatestBlockhash();
      
      const messageV0 = new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message();
      
      const transaction = new VersionedTransaction(messageV0);
      
      // 7. Sign with wallet (user signature only)
      setStatus('Please sign the transaction...');
      const signedTransaction = await signTransaction(transaction);
      
      // 8. Submit to relayer
      setStatus('Submitting to relayer...');
      const submitResponse = await fetch(`${RELAYER_URL}/api/v1/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction: Buffer.from(signedTransaction.serialize()).toString('base64'),
          poolId,
          amountIn,
          minAmountOut,
          isBaseInput,
          userPublicKey: publicKey.toBase58(),
        }),
      });
      
      if (!submitResponse.ok) {
        const error = await submitResponse.json();
        throw new Error(error.error || 'Failed to submit order');
      }
      
      const result = await submitResponse.json();
      setOrderId(result.orderId);
      setStatus('Order submitted! Waiting for execution...');
      
      // 9. Monitor order status via WebSocket
      const wsUrl = RELAYER_URL.replace('http', 'ws');
      const ws = new WebSocket(`${wsUrl}/ws/orders/${result.orderId}`);
      
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.status === 'executed') {
          setStatus(`✅ Swap executed! Tx: ${data.signature.substring(0, 8)}...`);
          ws.close();
        } else if (data.status === 'failed') {
          setStatus(`❌ Swap failed: ${data.error}`);
          ws.close();
        }
      };
      
      ws.onerror = () => {
        setStatus('Connection error. Check console for details.');
      };
      
    } catch (error: any) {
      console.error('Swap error:', error);
      setStatus(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [publicKey, signTransaction, connection, poolId, amountIn, minAmountOut, isBaseInput, buildSwapInstruction]);

  return (
    <div className="swap-container">
      <button 
        onClick={handleSwap} 
        disabled={!publicKey || loading}
        className="swap-button"
      >
        {loading ? 'Processing...' : 'Swap Tokens'}
      </button>
      
      {status && (
        <div className="status-message">
          {status}
        </div>
      )}
      
      {orderId && (
        <div className="order-info">
          Order ID: {orderId}
        </div>
      )}
    </div>
  );
}

// Example usage in a component
export function SwapInterface() {
  const { publicKey } = useWallet();
  const [amountIn, setAmountIn] = useState('1000000'); // 1 USDC
  
  return (
    <div className="swap-interface">
      <h2>Continuum CP-Swap</h2>
      
      <div className="input-group">
        <label>Amount (in smallest units):</label>
        <input 
          type="text" 
          value={amountIn} 
          onChange={(e) => setAmountIn(e.target.value)}
          placeholder="1000000 = 1 USDC"
        />
      </div>
      
      <SwapButton
        poolId="9AJUf9ZQ2sWq93ose12BePBn4sq36cyqE98MiZraFLJT"
        amountIn={amountIn}
        minAmountOut="0"
        isBaseInput={true}
      />
      
      {publicKey && (
        <div className="wallet-info">
          Connected: {publicKey.toBase58().substring(0, 8)}...
        </div>
      )}
    </div>
  );
}

// CSS styles (add to your stylesheet)
const styles = `
.swap-container {
  margin: 20px 0;
}

.swap-button {
  background: #512da8;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 16px;
  cursor: pointer;
  transition: background 0.3s;
}

.swap-button:hover:not(:disabled) {
  background: #673ab7;
}

.swap-button:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.status-message {
  margin-top: 10px;
  padding: 10px;
  background: #f5f5f5;
  border-radius: 4px;
  font-size: 14px;
}

.order-info {
  margin-top: 10px;
  font-family: monospace;
  font-size: 12px;
  color: #666;
}

.swap-interface {
  max-width: 400px;
  margin: 0 auto;
  padding: 20px;
  border: 1px solid #ddd;
  border-radius: 8px;
}

.input-group {
  margin-bottom: 20px;
}

.input-group label {
  display: block;
  margin-bottom: 5px;
  font-weight: 500;
}

.input-group input {
  width: 100%;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 16px;
}

.wallet-info {
  margin-top: 20px;
  text-align: center;
  color: #666;
  font-size: 14px;
}
`;