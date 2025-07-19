# Wallet Adapter Examples for Continuum CP-Swap

This directory contains examples of how to execute Continuum CP-Swap transactions using wallet adapters like Phantom, Solflare, and Backpack.

## Examples

### 1. HTML Example (`swap-with-wallet-adapter.html`)

A standalone HTML file that demonstrates swap execution using Phantom wallet directly in the browser.

**Usage:**
1. Ensure the relayer is running at `http://localhost:8085`
2. Copy the IDL file to be accessible: `cp ../../target/idl/continuum_cp_swap.json ./`
3. Serve the HTML file with a local server: `python3 -m http.server 8000`
4. Open `http://localhost:8000/swap-with-wallet-adapter.html` in your browser
5. Connect your Phantom wallet and execute swaps

**Features:**
- Connect/disconnect Phantom wallet
- Check SOL, USDC, and WSOL balances
- Configure swap parameters (pool ID, amounts, direction)
- Execute swaps with v0 transactions
- Monitor order status via WebSocket

### 2. React/TypeScript Example (`swap-with-wallet-adapter.tsx`)

A React component that integrates with Solana wallet adapter libraries for a production-ready implementation.

**Setup:**
```bash
# Create a new React app
npx create-react-app continuum-swap-app --template typescript
cd continuum-swap-app

# Install dependencies from wallet-adapter-example-package.json
npm install @coral-xyz/anchor @solana/spl-token @solana/wallet-adapter-base \
  @solana/wallet-adapter-react @solana/wallet-adapter-react-ui \
  @solana/wallet-adapter-phantom @solana/wallet-adapter-solflare \
  @solana/wallet-adapter-backpack @solana/wallet-adapter-wallets \
  @solana/web3.js axios bn.js

# Copy the component
cp path/to/swap-with-wallet-adapter.tsx src/App.tsx

# Copy the IDL
cp path/to/continuum_cp_swap.json public/

# Set environment variables
echo "REACT_APP_RELAYER_URL=http://localhost:8085" >> .env
echo "REACT_APP_RPC_URL=https://api.devnet.solana.com" >> .env

# Start the app
npm start
```

**Features:**
- Multi-wallet support (Phantom, Solflare, Backpack)
- Automatic wallet connection management
- Real-time balance updates
- TypeScript support for type safety
- WebSocket monitoring for order status
- Responsive UI with status messages

## Key Differences from the CLI Example

1. **Wallet Signing**: Instead of using a Keypair, transactions are signed by the connected wallet
2. **User Interaction**: The wallet prompts the user to approve each transaction
3. **Browser Environment**: Runs in the browser instead of Node.js
4. **Multi-Wallet Support**: Users can choose from different wallet providers

## Transaction Flow

1. User connects their wallet
2. Application fetches pool information from the relayer
3. Transaction is built with:
   - Compute budget instruction
   - Optional ATA creation instruction
   - Swap instruction with all required accounts
4. Transaction is compiled as a v0 versioned transaction
5. User signs the transaction in their wallet
6. Signed transaction is submitted to the relayer
7. Order status is monitored via WebSocket

## Notes

- Ensure you're connected to the correct network (devnet/mainnet)
- The examples use devnet token addresses - update for mainnet
- Make sure you have sufficient SOL for transaction fees
- For USDC swaps, ensure you have USDC tokens in your wallet
- The relayer must be running and accessible from your browser