# Relayer Troubleshooting Guide

This guide covers common issues and solutions when working with the Continuum CP-Swap relayer.

## Table of Contents
- [Transaction Already Processed Error](#transaction-already-processed-error)
- [WebSocket Connection Issues](#websocket-connection-issues)
- [CORS Errors](#cors-errors)
- [Insufficient Balance Errors](#insufficient-balance-errors)
- [Pool Not Found Errors](#pool-not-found-errors)
- [Signature Verification Failures](#signature-verification-failures)

## Transaction Already Processed Error

### Symptom
```
Order execution failed {"error":"Simulation failed. 
Message: Transaction simulation failed: This transaction has already been processed.
```

### Cause
When using wallet adapters with Anchor, the transaction may be automatically submitted to the blockchain before reaching the relayer. This happens because:
1. `AnchorProvider` with a real wallet can auto-submit transactions
2. Some wallet adapter configurations trigger automatic submission
3. The transaction gets confirmed on-chain before the relayer processes it

### Solution
Use a dummy wallet for building transactions with Anchor:

```typescript
// Create dummy wallet for Anchor (prevents auto-submission)
const dummyKeypair = Keypair.generate();
const dummyWallet = new Wallet(dummyKeypair);

// Use dummy wallet in provider
const provider = new AnchorProvider(
  connection,
  dummyWallet,
  { commitment: 'confirmed', skipPreflight: true }
);

// Build instruction
const instruction = await program.methods
  .swapImmediate(...)
  .instruction();

// Create transaction and sign with user's actual wallet
const transaction = new VersionedTransaction(messageV0);
const signedTx = await userWallet.signTransaction(transaction);

// Submit ONLY to relayer
await axios.post(`${RELAYER_URL}/api/v1/orders`, {
  transaction: Buffer.from(signedTx.serialize()).toString('base64'),
  ...
});
```

### Prevention
- Never use the user's wallet directly in `AnchorProvider` when building transactions for the relayer
- Always use `.instruction()` instead of `.rpc()` to get the instruction without sending
- Ensure no other code is calling `sendTransaction` or `sendAndConfirmTransaction`

## WebSocket Connection Issues

### Symptom
- Order status updates not received
- WebSocket disconnects immediately
- "Connection refused" errors

### Causes & Solutions

1. **Wrong WebSocket URL**
   ```javascript
   // Correct: Convert HTTP to WS
   const wsUrl = RELAYER_URL.replace('http', 'ws');
   const ws = new WebSocket(`${wsUrl}/ws/orders/${orderId}`);
   ```

2. **CORS/Origin Issues**
   - Ensure relayer allows WebSocket connections from your domain
   - Check browser console for CORS errors

3. **Firewall/Proxy Blocking**
   - WebSocket uses different ports than HTTP
   - Ensure port 8085 (or your configured port) allows WebSocket traffic

## CORS Errors

### Symptom
```
Access to fetch at 'http://localhost:8085/api/v1/orders' from origin 'http://localhost:3000' has been blocked by CORS policy
```

### Solution
1. Check relayer CORS configuration in `src/server.ts`
2. For development, ensure localhost is allowed:
   ```typescript
   app.use(cors({
     origin: ['http://localhost:3000', 'http://localhost:8000'],
     credentials: true
   }));
   ```
3. For production, configure specific allowed origins

## Insufficient Balance Errors

### Symptom
- "Insufficient funds" error when submitting order
- Transaction simulation fails with balance error

### Checks
1. **User has enough input tokens**:
   ```javascript
   const balance = await connection.getTokenAccountBalance(userInputAccount);
   if (balance.value.uiAmount < requestedAmount) {
     throw new Error('Insufficient token balance');
   }
   ```

2. **User has SOL for fees**:
   ```javascript
   const solBalance = await connection.getBalance(publicKey);
   if (solBalance < 0.01 * 1e9) { // 0.01 SOL minimum
     throw new Error('Insufficient SOL for fees');
   }
   ```

3. **Output token account exists or SOL for rent**:
   - The transaction may need to create an ATA
   - Ensure user has ~0.002 SOL for rent

## Pool Not Found Errors

### Symptom
- "Pool account not found" error
- Invalid pool ID errors

### Solutions
1. **Verify pool exists**:
   ```bash
   curl http://localhost:8085/api/v1/pools
   ```

2. **Check network mismatch**:
   - Ensure wallet, RPC, and pool ID are all on same network (devnet/mainnet)
   - Devnet pool IDs won't work on mainnet

3. **Pool may be inactive**:
   - Check pool status in relayer response
   - Only active pools can be used for swaps

## Signature Verification Failures

### Symptom
- "Invalid signature" errors
- "Signature verification failed"

### Common Causes

1. **Transaction modified after signing**:
   - Don't modify transaction after wallet signs it
   - Ensure all accounts/instructions are added before signing

2. **Wrong public key**:
   - Verify the signer's public key matches the transaction's fee payer
   - Check that all required signers are included

3. **Expired blockhash**:
   ```javascript
   // Get fresh blockhash right before signing
   const { blockhash } = await connection.getLatestBlockhash();
   ```

4. **Version mismatch**:
   - Ensure using VersionedTransaction for v0 transactions
   - Don't mix legacy and versioned transaction APIs

## Debug Tips

### Enable Verbose Logging
Set environment variable:
```bash
LOG_LEVEL=debug npm run dev
```

### Inspect Transaction Before Submission
```javascript
console.log('Transaction debug info:', {
  signatures: transaction.signatures.length,
  version: transaction.version,
  accounts: transaction.message.staticAccountKeys.length,
  serializedSize: transaction.serialize().length
});
```

### Monitor Network Requests
Use browser DevTools Network tab to inspect:
- Request payloads
- Response errors
- WebSocket frames

### Test with CLI First
If wallet adapter fails, test with CLI example to isolate issue:
```bash
ts-node examples/submit-swap.ts
```

## Getting Help

If you encounter issues not covered here:

1. Check relayer logs for detailed error messages
2. Ensure you're using the latest version of the SDK and examples
3. Try the working CLI examples first to verify relayer functionality
4. Open an issue with:
   - Error messages
   - Transaction details
   - Network (devnet/mainnet)
   - Browser/wallet version