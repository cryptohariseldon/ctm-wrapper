import React, { useState, useCallback, useMemo } from 'react';
import { 
  Connection, 
  PublicKey, 
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  TransactionInstruction,
  Keypair
} from '@solana/web3.js';
import {
  useWallet,
  useConnection,
  WalletProvider,
  ConnectionProvider
} from '@solana/wallet-adapter-react';
import {
  WalletModalProvider,
  WalletMultiButton
} from '@solana/wallet-adapter-react-ui';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  BackpackWalletAdapter
} from '@solana/wallet-adapter-wallets';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { Program, AnchorProvider, Idl, BN, Wallet } from '@coral-xyz/anchor';
import axios from 'axios';

// Import wallet adapter styles
import '@solana/wallet-adapter-react-ui/styles.css';

// Configuration
const RELAYER_URL = process.env.REACT_APP_RELAYER_URL || 'http://localhost:8085';
const RPC_URL = process.env.REACT_APP_RPC_URL || 'https://api.devnet.solana.com';

// Program IDs
const CONTINUUM_PROGRAM_ID = new PublicKey('EaeWUSam5Li1fzCcCs33oE4jCLQT4F6RJXgrPYZaoKqq');
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

interface SwapFormData {
  poolId: string;
  amountIn: string;
  minAmountOut: string;
  isBaseInput: boolean;
}

interface PoolInfo {
  tokenA: {
    symbol: string;
    mint: string;
  };
  tokenB: {
    symbol: string;
    mint: string;
  };
  price: {
    USDCPerWSOL: number;
  };
}

const SwapComponent: React.FC = () => {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  
  const [formData, setFormData] = useState<SwapFormData>({
    poolId: '9AJUf9ZQ2sWq93ose12BePBn4sq36cyqE98MiZraFLJT',
    amountIn: '10',
    minAmountOut: '0',
    isBaseInput: true
  });
  
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ message: string; type: 'info' | 'error' | 'success' }>({ message: '', type: 'info' });
  const [balances, setBalances] = useState<{ sol: number; usdc: number; wsol: number }>({ sol: 0, usdc: 0, wsol: 0 });
  const [debugInfo, setDebugInfo] = useState<string>('');

  const checkBalances = useCallback(async () => {
    if (!publicKey) return;
    
    try {
      const solBalance = await connection.getBalance(publicKey);
      
      const usdcMint = new PublicKey('8eLeJssGBw8Z2z1y3uz1xCwzrWa2QjCqAtH7Y88MjTND');
      const wsolMint = new PublicKey('So11111111111111111111111111111111111111112');
      
      const usdcAccount = getAssociatedTokenAddressSync(usdcMint, publicKey);
      const wsolAccount = getAssociatedTokenAddressSync(wsolMint, publicKey);
      
      let usdcBalance = 0;
      let wsolBalance = 0;
      
      try {
        const usdcInfo = await connection.getTokenAccountBalance(usdcAccount);
        usdcBalance = usdcInfo.value.uiAmount || 0;
      } catch (e) {
        console.log('No USDC account');
      }
      
      try {
        const wsolInfo = await connection.getTokenAccountBalance(wsolAccount);
        wsolBalance = wsolInfo.value.uiAmount || 0;
      } catch (e) {
        console.log('No WSOL account');
      }
      
      setBalances({
        sol: solBalance / 1e9,
        usdc: usdcBalance,
        wsol: wsolBalance
      });
    } catch (error) {
      console.error('Failed to check balances:', error);
    }
  }, [connection, publicKey]);

  const executeSwap = useCallback(async () => {
    if (!publicKey || !signTransaction) {
      setStatus({ message: 'Please connect wallet first', type: 'error' });
      return;
    }
    
    setLoading(true);
    setStatus({ message: 'Building transaction...', type: 'info' });
    setDebugInfo('');
    
    try {
      // Fetch pool info
      const poolInfoResponse = await axios.get(`${RELAYER_URL}/api/v1/pools/${formData.poolId}/price`);
      const poolInfo: PoolInfo = poolInfoResponse.data;
      
      // Parse pool ID
      const poolId = new PublicKey(formData.poolId);
      
      // Determine token mints
      const tokenAMint = new PublicKey(poolInfo.tokenA.mint);
      const tokenBMint = new PublicKey(poolInfo.tokenB.mint);
      
      const inputMint = formData.isBaseInput ? tokenAMint : tokenBMint;
      const outputMint = formData.isBaseInput ? tokenBMint : tokenAMint;
      
      // User token accounts
      const userInputAccount = getAssociatedTokenAddressSync(inputMint, publicKey);
      const userOutputAccount = getAssociatedTokenAddressSync(outputMint, publicKey);
      
      // Load IDL (in production, bundle this properly)
      const idlResponse = await fetch('/continuum_cp_swap.json');
      const idl: Idl = await idlResponse.json();
      
      // IMPORTANT: Create a dummy wallet that won't send transactions
      // This prevents AnchorProvider from auto-submitting
      const dummyKeypair = Keypair.generate();
      const dummyWallet = new Wallet(dummyKeypair);
      
      // Create anchor provider with dummy wallet
      const anchorProvider = new AnchorProvider(
        connection,
        dummyWallet,
        { commitment: 'confirmed', skipPreflight: true }
      );
      const program = new Program(idl, anchorProvider);
      
      // Derive PDAs
      const [fifoState] = PublicKey.findProgramAddressSync(
        [Buffer.from('fifo_state')],
        CONTINUUM_PROGRAM_ID
      );
      
      const [poolAuthority, poolAuthorityBump] = PublicKey.findProgramAddressSync(
        [Buffer.from('cp_pool_authority'), poolId.toBuffer()],
        CONTINUUM_PROGRAM_ID
      );
      
      const [cpSwapAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault_and_lp_mint_auth_seed')],
        CP_SWAP_PROGRAM_ID
      );
      
      // Get pool state
      const poolAccount = await connection.getAccountInfo(poolId);
      if (!poolAccount) {
        throw new Error('Pool account not found');
      }
      
      // Parse pool state
      const ammConfigOffset = 8;
      const ammConfig = new PublicKey(poolAccount.data.slice(ammConfigOffset, ammConfigOffset + 32));
      
      const token0VaultOffset = 72;
      const token1VaultOffset = 104;
      const token0Vault = new PublicKey(poolAccount.data.slice(token0VaultOffset, token0VaultOffset + 32));
      const token1Vault = new PublicKey(poolAccount.data.slice(token1VaultOffset, token1VaultOffset + 32));
      
      const observationState = new PublicKey('7GZfqjfsHzWu68DMtgCbpjN18a1e3hrZ1kqS2zWhJVHP');
      
      // Calculate amounts with proper decimals
      const decimalsIn = formData.isBaseInput ? 6 : 9; // USDC: 6, WSOL: 9
      const decimalsOut = formData.isBaseInput ? 9 : 6;
      
      const amountIn = new BN(parseFloat(formData.amountIn) * Math.pow(10, decimalsIn));
      const minAmountOut = new BN(parseFloat(formData.minAmountOut) * Math.pow(10, decimalsOut));
      
      // Build swap instruction
      const swapIx = await program.methods
        .swapImmediate(
          amountIn,
          minAmountOut,
          formData.isBaseInput,
          poolId,
          poolAuthorityBump
        )
        .accountsPartial({
          fifoState: fifoState,
          cpSwapProgram: CP_SWAP_PROGRAM_ID,
        })
        .remainingAccounts([
          // IMPORTANT: Use the actual user's public key here, not the dummy wallet
          { pubkey: publicKey, isSigner: true, isWritable: false },
          { pubkey: cpSwapAuthority, isSigner: false, isWritable: false },
          { pubkey: ammConfig, isSigner: false, isWritable: false },
          { pubkey: poolId, isSigner: false, isWritable: true },
          { pubkey: userInputAccount, isSigner: false, isWritable: true },
          { pubkey: userOutputAccount, isSigner: false, isWritable: true },
          { pubkey: formData.isBaseInput ? token0Vault : token1Vault, isSigner: false, isWritable: true },
          { pubkey: formData.isBaseInput ? token1Vault : token0Vault, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: inputMint, isSigner: false, isWritable: false },
          { pubkey: outputMint, isSigner: false, isWritable: false },
          { pubkey: observationState, isSigner: false, isWritable: true },
        ])
        .instruction();
      
      // Build transaction
      const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
        units: 300000
      });
      
      const instructions: TransactionInstruction[] = [modifyComputeUnits];
      
      // Check if output account exists
      const outputAccountInfo = await connection.getAccountInfo(userOutputAccount);
      if (!outputAccountInfo) {
        instructions.push(
          createAssociatedTokenAccountInstruction(
            publicKey,
            userOutputAccount,
            publicKey,
            outputMint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      }
      
      instructions.push(swapIx);
      
      // Get blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      
      // Create v0 message with the user's public key as payer
      const messageV0 = new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message();
      
      // Create versioned transaction
      const transaction = new VersionedTransaction(messageV0);
      
      // Debug info
      const debugData = {
        userPublicKey: publicKey.toBase58(),
        poolId: formData.poolId,
        amountIn: amountIn.toString(),
        minAmountOut: minAmountOut.toString(),
        isBaseInput: formData.isBaseInput,
        instructionCount: instructions.length,
        hasATACreation: !outputAccountInfo,
        staticAccountKeys: messageV0.staticAccountKeys.length,
        transactionVersion: transaction.version
      };
      
      setDebugInfo(JSON.stringify(debugData, null, 2));
      
      setStatus({ message: 'Please approve transaction in your wallet...', type: 'info' });
      
      // Sign transaction with user's wallet
      const signedTransaction = await signTransaction(transaction);
      
      // Verify signatures
      const signaturesPresent = signedTransaction.signatures.filter(sig => sig !== null).length;
      console.log('Signatures present:', signaturesPresent);
      console.log('Transaction signed successfully');
      
      // IMPORTANT: Do NOT send the transaction here!
      // The transaction should only be sent to the relayer
      
      // Submit to relayer
      const orderData = {
        transaction: Buffer.from(signedTransaction.serialize()).toString('base64'),
        poolId: formData.poolId,
        amountIn: amountIn.toString(),
        minAmountOut: minAmountOut.toString(),
        isBaseInput: formData.isBaseInput,
        userPublicKey: publicKey.toBase58()
      };
      
      setStatus({ message: 'Submitting to relayer...', type: 'info' });
      
      console.log('Submitting order to relayer:', orderData);
      
      const response = await axios.post(`${RELAYER_URL}/api/v1/orders`, orderData);
      
      setStatus({ 
        message: `Swap submitted! Order ID: ${response.data.orderId}`, 
        type: 'success' 
      });
      
      // Monitor order via WebSocket
      monitorOrder(response.data.orderId);
      
      // Refresh balances after a delay
      setTimeout(() => checkBalances(), 5000);
      
    } catch (error: any) {
      console.error('Swap failed:', error);
      setStatus({ 
        message: `Swap failed: ${error.response?.data?.error || error.message}`, 
        type: 'error' 
      });
    } finally {
      setLoading(false);
    }
  }, [publicKey, signTransaction, connection, formData, checkBalances]);

  const monitorOrder = (orderId: string) => {
    const wsUrl = RELAYER_URL.replace('http', 'ws');
    const ws = new WebSocket(`${wsUrl}/ws/orders/${orderId}`);
    
    ws.onmessage = (event) => {
      const update = JSON.parse(event.data);
      console.log('Order update:', update);
      
      if (update.status === 'executed') {
        setStatus({ 
          message: `Swap executed! Tx: ${update.signature}`, 
          type: 'success' 
        });
        ws.close();
      } else if (update.status === 'failed') {
        setStatus({ 
          message: `Swap failed: ${update.error}`, 
          type: 'error' 
        });
        ws.close();
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  };

  return (
    <div className="swap-container" style={{ maxWidth: '600px', margin: '0 auto', padding: '20px' }}>
      <h2>Continuum CP-Swap (Fixed)</h2>
      <p style={{ fontSize: '14px', color: '#666' }}>
        This version prevents auto-submission of transactions to the blockchain
      </p>
      
      <div style={{ marginBottom: '20px' }}>
        <WalletMultiButton />
      </div>
      
      {publicKey && (
        <>
          <div style={{ marginBottom: '20px' }}>
            <h3>Balances</h3>
            <p>SOL: {balances.sol.toFixed(4)}</p>
            <p>USDC: {balances.usdc.toFixed(2)}</p>
            <p>WSOL: {balances.wsol.toFixed(4)}</p>
            <button onClick={checkBalances}>Refresh Balances</button>
          </div>
          
          <div style={{ marginBottom: '20px' }}>
            <h3>Swap Settings</h3>
            
            <div>
              <label>Pool ID:</label>
              <input
                type="text"
                value={formData.poolId}
                onChange={(e) => setFormData({ ...formData, poolId: e.target.value })}
                style={{ width: '100%', marginBottom: '10px' }}
              />
            </div>
            
            <div>
              <label>Amount In:</label>
              <input
                type="number"
                value={formData.amountIn}
                onChange={(e) => setFormData({ ...formData, amountIn: e.target.value })}
                step="0.01"
                style={{ marginBottom: '10px' }}
              />
            </div>
            
            <div>
              <label>Min Amount Out:</label>
              <input
                type="number"
                value={formData.minAmountOut}
                onChange={(e) => setFormData({ ...formData, minAmountOut: e.target.value })}
                step="0.001"
                style={{ marginBottom: '10px' }}
              />
            </div>
            
            <div>
              <label>
                <input
                  type="checkbox"
                  checked={formData.isBaseInput}
                  onChange={(e) => setFormData({ ...formData, isBaseInput: e.target.checked })}
                />
                Swap USDC → WSOL (unchecked: WSOL → USDC)
              </label>
            </div>
          </div>
          
          <button 
            onClick={executeSwap} 
            disabled={loading}
            style={{ 
              padding: '10px 20px', 
              fontSize: '16px',
              backgroundColor: loading ? '#ccc' : '#512da8',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'Processing...' : 'Execute Swap'}
          </button>
        </>
      )}
      
      {status.message && (
        <div style={{ 
          marginTop: '20px', 
          padding: '10px', 
          backgroundColor: status.type === 'error' ? '#ffebee' : status.type === 'success' ? '#e8f5e9' : '#e3f2fd',
          color: status.type === 'error' ? '#c62828' : status.type === 'success' ? '#2e7d32' : '#1565c0',
          borderRadius: '4px'
        }}>
          {status.message}
        </div>
      )}
      
      {debugInfo && (
        <div style={{ marginTop: '20px' }}>
          <h4>Debug Info:</h4>
          <pre style={{ 
            backgroundColor: '#f5f5f5', 
            padding: '10px', 
            borderRadius: '4px',
            fontSize: '12px',
            overflow: 'auto'
          }}>
            {debugInfo}
          </pre>
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => {
  const endpoint = useMemo(() => RPC_URL, []);
  
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new BackpackWalletAdapter(),
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <SwapComponent />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default App;