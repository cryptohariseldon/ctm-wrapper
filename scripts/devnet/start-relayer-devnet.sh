#!/bin/bash

echo "🚀 Starting Continuum Relayer on Devnet"
echo "======================================"

# Set environment variables
export NODE_ENV=development
export DEVNET_RPC_URL=https://api.devnet.solana.com
export DEVNET_WS_URL=wss://api.devnet.solana.com
export PORT=8085
export LOG_LEVEL=debug

# Check if relayer keypair exists
KEYPAIR_PATH="$HOME/.config/solana/id.json"
if [ ! -f "$KEYPAIR_PATH" ]; then
    echo "❌ Relayer keypair not found at $KEYPAIR_PATH"
    echo "Please ensure you have a Solana keypair configured"
    exit 1
fi

# Get relayer address
RELAYER_ADDRESS=$(solana address)
echo "Relayer address: $RELAYER_ADDRESS"

# Check balance
BALANCE=$(solana balance --url devnet)
echo "Relayer balance: $BALANCE"

# Navigate to relayer directory
cd "$(dirname "$0")/../../relayer" || exit 1

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Build the relayer
echo "🔨 Building relayer..."
npm run build

# Create a temporary config switcher
cat > src/config.ts << 'EOF'
// Temporary config router for devnet
export * from './config.devnet';
export { default } from './config.devnet';
EOF

# Start the relayer
echo ""
echo "🌐 Starting relayer server..."
echo "API endpoint: http://localhost:8085/api/v1"
echo "WebSocket endpoint: ws://localhost:8085/ws"
echo "Health check: http://localhost:8085/health"
echo ""

# Run with ts-node for development
npm run dev