# Continuum Relayer Service

A high-performance relayer service for executing Continuum CP-Swap orders in FIFO sequence. This service provides HTTP and WebSocket APIs for client integrations.

## Features

- 🚀 **High Performance**: Processes orders with minimal latency
- 🔒 **Secure**: Rate limiting, input validation, and secure transaction handling
- 📡 **Real-time Updates**: WebSocket support for order status updates
- 🔄 **Auto-retry**: Configurable retry logic for failed transactions
- 📊 **Monitoring**: Built-in health checks and metrics
- 🐳 **Docker Support**: Easy deployment with Docker and Docker Compose
- 🔧 **Flexible Deployment**: Standalone, PM2, or containerized options

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/continuum-finance/continuum-cp-swap
cd continuum-cp-swap/relayer
npm install
```

### 2. Configure

Create a `.env` file:

```env
# RPC Configuration
RPC_URL=https://api.mainnet-beta.solana.com
WS_URL=wss://api.mainnet-beta.solana.com

# Relayer Configuration
RELAYER_KEYPAIR_PATH=./relayer-keypair.json
RELAYER_FEE_BPS=10  # 0.1% fee

# Program IDs
CONTINUUM_PROGRAM_ID=A548C9LR926hnAWvYDjsXJddidhfzLf3bRb8dmYPgRKn
CP_SWAP_PROGRAM_ID=GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp

# Server Configuration
PORT=8080
ALLOWED_ORIGINS=https://app.continuum.fi,http://localhost:3000

# Performance Settings
POLL_INTERVAL_MS=1000
MAX_CONCURRENT_EXECUTIONS=5
RETRY_ATTEMPTS=3
```

### 3. Start the Relayer

```bash
# Generate keypair (first time only)
./start-relayer.sh start

# The script will:
# - Generate a relayer keypair if needed
# - Check prerequisites
# - Install dependencies
# - Build the project
# - Start the service
```

### 4. Fund the Relayer

Send SOL to the relayer address shown in the startup logs for transaction fees.

## API Endpoints

### HTTP API

#### Health Check
```http
GET /health
```

Response:
```json
{
  "status": "healthy",
  "relayer": "GsV1jugD8ftfWBYNykA9SLK2V4mQqUW2sLop8MAfjVRq",
  "timestamp": "2024-01-15T12:00:00.000Z",
  "version": "1.0.0"
}
```

#### Get Relayer Info
```http
GET /api/v1/info
```

Response:
```json
{
  "relayerAddress": "GsV1jugD8ftfWBYNykA9SLK2V4mQqUW2sLop8MAfjVRq",
  "continuumProgram": "A548C9LR926hnAWvYDjsXJddidhfzLf3bRb8dmYPgRKn",
  "cpSwapProgram": "GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp",
  "fee": 10,
  "minOrderSize": "1000000",
  "maxOrderSize": "1000000000000",
  "supportedPools": [...],
  "performance": {
    "successRate": 0.98,
    "avgExecutionTime": 2500,
    "totalOrders": 15234
  }
}
```

#### Submit Order
```http
POST /api/v1/orders
Content-Type: application/json

{
  "transaction": "base64_encoded_partial_signed_tx",
  "poolId": "BhPUKnKuzpEYNhSSNxkze51tMVza25rgXfEv5LWgGng2",
  "amountIn": "1000000000",
  "minAmountOut": "950000000",
  "isBaseInput": true,
  "userPublicKey": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
}
```

Response:
```json
{
  "success": true,
  "orderId": "ord_1234567890",
  "orderPda": "5nAnakPoRCpiMPAVm9mew5rCwz2But8DjDTwapYzCBSW",
  "sequence": "42",
  "estimatedExecutionTime": 5000,
  "fee": "100000"
}
```

#### Get Order Status
```http
GET /api/v1/orders/{orderId}
```

Response:
```json
{
  "orderId": "ord_1234567890",
  "status": "executed",
  "sequence": "42",
  "poolId": "BhPUKnKuzpEYNhSSNxkze51tMVza25rgXfEv5LWgGng2",
  "userPublicKey": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  "amountIn": "1000000000",
  "actualAmountOut": "985000000",
  "executionPrice": 0.985,
  "signature": "5eykt4UsFv8P8NJdTREpY1vzqYqyTZwkGZ7JZv7owLmnRmAMvRt2UHgGTVL3rSJE9SS",
  "executedAt": "2024-01-15T12:00:05.000Z"
}
```

#### Cancel Order
```http
DELETE /api/v1/orders/{orderId}
Authorization: Bearer {user_signature}
```

#### Get Supported Pools
```http
GET /api/v1/pools
```

#### Get Statistics
```http
GET /api/v1/stats
```

### WebSocket API

#### Subscribe to Order Updates
```javascript
const ws = new WebSocket('ws://localhost:8080/ws/orders/{orderId}');

ws.on('message', (data) => {
  const update = JSON.parse(data);
  console.log('Order update:', update);
  // {
  //   type: 'order_executed',
  //   orderId: 'ord_1234567890',
  //   status: 'executed',
  //   signature: '...',
  //   executionPrice: 0.985,
  //   actualAmountOut: '985000000'
  // }
});
```

#### Subscribe to All Events
```javascript
const ws = new WebSocket('ws://localhost:8080/ws/feed');

ws.send(JSON.stringify({
  type: 'subscribe',
  events: ['order_submitted', 'order_executed', 'order_failed']
}));
```

## Client Integration Example

### JavaScript/TypeScript

```typescript
class ContinuumRelayerClient {
  constructor(private relayerUrl: string) {}

  async submitOrder(params: {
    transaction: Transaction;
    poolId: PublicKey;
    amountIn: BN;
    minAmountOut: BN;
    isBaseInput: boolean;
    userPublicKey: PublicKey;
  }) {
    const response = await fetch(`${this.relayerUrl}/api/v1/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transaction: params.transaction.serialize().toString('base64'),
        poolId: params.poolId.toBase58(),
        amountIn: params.amountIn.toString(),
        minAmountOut: params.minAmountOut.toString(),
        isBaseInput: params.isBaseInput,
        userPublicKey: params.userPublicKey.toBase58()
      })
    });

    if (!response.ok) {
      throw new Error(`Relayer error: ${response.statusText}`);
    }

    return response.json();
  }

  subscribeToOrder(orderId: string): WebSocket {
    const ws = new WebSocket(
      `${this.relayerUrl.replace('http', 'ws')}/ws/orders/${orderId}`
    );
    return ws;
  }
}

// Usage
const client = new ContinuumRelayerClient('http://localhost:8080');

// Submit order
const result = await client.submitOrder({
  transaction: partiallySignedTx,
  poolId,
  amountIn,
  minAmountOut,
  isBaseInput: true,
  userPublicKey: wallet.publicKey
});

// Monitor execution
const ws = client.subscribeToOrder(result.orderId);
ws.on('message', (data) => {
  const update = JSON.parse(data.toString());
  if (update.status === 'executed') {
    console.log('Swap completed!', update.signature);
  }
});
```

## Deployment Options

### Option 1: Standalone

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

### Option 2: PM2 (Recommended for Production)

```bash
# Start with PM2
RELAYER_MODE=pm2 ./start-relayer.sh start

# View logs
pm2 logs continuum-relayer

# Monitor
pm2 monit
```

### Option 3: Docker

```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f relayer

# Stop
docker-compose down
```

### Option 4: Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: continuum-relayer
spec:
  replicas: 3
  selector:
    matchLabels:
      app: continuum-relayer
  template:
    metadata:
      labels:
        app: continuum-relayer
    spec:
      containers:
      - name: relayer
        image: continuum/relayer:latest
        ports:
        - containerPort: 8080
        env:
        - name: NODE_ENV
          value: "production"
        envFrom:
        - secretRef:
            name: relayer-secrets
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
```

## Monitoring and Observability

### Prometheus Metrics

The relayer exposes metrics at `/metrics` when `ENABLE_METRICS=true`:

- `continuum_orders_total` - Total orders processed
- `continuum_orders_success` - Successful executions
- `continuum_orders_failed` - Failed executions
- `continuum_execution_time` - Order execution time histogram
- `continuum_queue_size` - Current queue size

### Grafana Dashboard

Import the provided dashboard from `grafana/dashboards/relayer.json` for visualization.

### Logging

Logs are written to:
- Console (with colors in development)
- `logs/relayer.log` (JSON format in production)

Configure log level with `LOG_LEVEL` environment variable (debug, info, warn, error).

## Security Considerations

1. **Keep your relayer keypair secure** - Never commit it to version control
2. **Use HTTPS in production** - Deploy behind a reverse proxy (nginx, Cloudflare)
3. **Configure CORS properly** - Set `ALLOWED_ORIGINS` to specific domains
4. **Monitor for anomalies** - Set up alerts for unusual activity
5. **Regular updates** - Keep dependencies updated for security patches

## Performance Tuning

### Configuration Options

```env
# Increase for higher throughput
MAX_CONCURRENT_EXECUTIONS=10

# Decrease for lower latency
POLL_INTERVAL_MS=500

# Adjust based on network conditions
RETRY_ATTEMPTS=5
RETRY_DELAY_MS=2000

# Connection pooling
CONNECTION_POOL_SIZE=10
PREFLIGHT_COMMITMENT=processed
```

### Scaling Horizontally

Run multiple relayer instances with a load balancer:

```nginx
upstream relayers {
    least_conn;
    server relayer1:8080;
    server relayer2:8080;
    server relayer3:8080;
}

server {
    listen 443 ssl http2;
    server_name relayer.continuum.fi;
    
    location / {
        proxy_pass http://relayers;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## Troubleshooting

### Common Issues

1. **"Insufficient balance"**
   - Fund the relayer wallet with SOL
   - Check `RELAYER_FEE_BPS` is set correctly

2. **"Transaction simulation failed"**
   - Verify program IDs are correct
   - Check RPC endpoint is accessible
   - Ensure partial transaction is properly signed

3. **"WebSocket connection failed"**
   - Check firewall rules
   - Verify WebSocket upgrade headers are passed through proxy

4. **High latency**
   - Use a dedicated RPC node
   - Deploy relayer geographically close to RPC
   - Tune performance settings

### Debug Mode

Enable verbose logging:

```env
LOG_LEVEL=debug
DEBUG=continuum:*
```

## Support

- Documentation: https://docs.continuum.fi
- Discord: https://discord.gg/continuum
- Issues: https://github.com/continuum-finance/relayer/issues

## License

MIT License - see LICENSE file for details