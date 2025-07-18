# Relayer Update Plan: Mock to Real Blockchain Integration

## Overview
The relayer needs to transition from mock execution to real blockchain transactions using the Continuum CP-Swap integration. Additionally, we need to add endpoints for airdrop and current price queries.

## Current State
- **Mock Implementation**: RelayerService provides mock order execution with 2-second delays
- **Hardcoded Data**: Pool configurations and prices are static
- **No Blockchain Interaction**: Orders don't result in actual token transfers
- **Missing Features**: No airdrop capability, no real price queries

## Phase 1: Infrastructure Updates

### 1.1 Configuration
Add environment variables and configuration for:
- RPC endpoint (default: http://localhost:8899)
- Relayer keypair path
- Continuum program ID: `EaeWUSam5Li1fzCcCs33oE4jCLQT4F6RJXgrPYZaoKqq`
- CP-Swap program ID: `GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp`
- Supported pool configurations

**Files to modify:**
- `/relayer/src/config.ts` - Add configuration structure
- `/relayer/.env.example` - Document environment variables

### 1.2 Connection Setup
- Initialize Solana connection with proper commitment level
- Load relayer keypair for transaction signing
- Set up SDK client instances
- Create connection pool for high throughput

**Files to create/modify:**
- `/relayer/src/connection.ts` - Connection management
- `/relayer/src/keypair.ts` - Keypair loading utilities

## Phase 2: Replace Mock Implementations

### 2.1 Update RelayerService (`relayerService.ts`)

#### Replace mock `executeOrder()` method:
```typescript
// Current: Mock execution with timeout
// New: Real blockchain execution
- Build transaction using SDK's ContinuumClient
- Sign with relayer keypair
- Submit to blockchain
- Monitor confirmation
- Update order status based on results
```

#### Update pool methods:
- `getSupportedPools()` - Return actual pool configurations from config
- `getSupportedPoolsWithInfo()` - Fetch real pool data from blockchain

### 2.2 Complete Relayer Implementation (`relayer.ts`)
- Implement `findOrderBySequence()` - Query on-chain FIFO state
- Complete `parseOrderState()` - Deserialize account data
- Implement `getCpSwapAccounts()` - Build proper account lists for CPI

### 2.3 Transaction Building
Create proper instruction builders for:
- Submit order (FIFO mode)
- Execute order with CPI to CP-Swap
- Swap immediate (atomic submit + execute)
- Cancel order

Handle:
- Compute budget optimization
- Priority fees for faster confirmation
- Transaction versioning
- Retry logic for failed transactions

## Phase 3: Add New Endpoints

### 3.1 Airdrop Endpoint
```typescript
POST /api/v1/airdrop
Content-Type: application/json

{
  "address": "wallet_pubkey",
  "amount": 1000000000  // lamports (1 SOL)
}

Response:
{
  "success": true,
  "signature": "transaction_signature",
  "amount": 1000000000
}
```

Implementation:
- Validate address format
- Check rate limits (prevent abuse)
- Use connection.requestAirdrop()
- Wait for confirmation
- Return transaction signature

### 3.2 Current Price Endpoint
```typescript
GET /api/v1/pools/:poolId/price

Response:
{
  "poolId": "pool_address",
  "token0": {
    "mint": "token0_mint_address",
    "symbol": "WSOL",
    "decimals": 9
  },
  "token1": {
    "mint": "token1_mint_address", 
    "symbol": "USDC",
    "decimals": 6
  },
  "price": {
    "token0PerToken1": "1.234567",
    "token1PerToken0": "0.810372"
  },
  "liquidity": {
    "token0": "10000000000000",
    "token1": "10000000000"
  },
  "lastUpdate": "2024-01-20T12:00:00Z"
}
```

Implementation:
- Fetch pool state from CP-Swap
- Calculate current price from vault balances
- Apply proper decimal scaling
- Cache results for performance

## Phase 4: Update Examples

### 4.1 Example Client Updates (`examples/`)
Update all example scripts to:
- Use real transaction building
- Check balances before submission
- Display transaction signatures
- Handle real confirmation times
- Show actual token movements

### 4.2 New Testing Scripts
Create scripts for:
- `/examples/airdrop.ts` - Request SOL airdrop
- `/examples/check-price.ts` - Query current pool prices
- `/examples/swap-with-monitoring.ts` - Submit and monitor real swap
- `/examples/load-test.ts` - Submit multiple concurrent orders

## Phase 5: Error Handling & Monitoring

### 5.1 Enhanced Error Handling
Implement proper handling for:
- Insufficient balance errors
- Slippage tolerance violations
- Network timeouts
- Transaction simulation failures
- Rate limiting
- Invalid pool/token addresses

### 5.2 Logging & Metrics
Add structured logging:
- Order lifecycle events
- Transaction submissions/confirmations
- Error occurrences with context
- Performance metrics

Track metrics:
- Order submission rate
- Execution success rate
- Average confirmation time
- Failed transaction reasons
- API endpoint response times

## Implementation Order

1. **Configuration & Connection Setup** (Phase 1)
   - Set up environment variables
   - Initialize connections
   - Load keypairs

2. **Add Airdrop Endpoint** (Phase 3.1)
   - Needed for testing
   - Simple to implement
   - Validates connection setup

3. **Add Price Endpoint** (Phase 3.2)
   - Useful for debugging
   - Required for UI
   - Tests pool data fetching

4. **Update executeOrder** (Phase 2.1)
   - Core functionality
   - Most complex change
   - Enables real swaps

5. **Complete Remaining Integrations** (Phase 2.2-2.3)
   - Full blockchain integration
   - Order querying
   - State parsing

6. **Update Examples & Documentation** (Phase 4)
   - Test all functionality
   - Provide usage examples
   - Document changes

## Key Files to Modify

### Core Files:
1. `/relayer/src/config.ts` - Configuration management
2. `/relayer/src/server.ts` - Add new endpoints
3. `/relayer/src/relayerService.ts` - Replace mock implementations
4. `/relayer/src/relayer.ts` - Complete blockchain integration
5. `/relayer/src/types.ts` - Add types for new responses

### New Files:
1. `/relayer/src/connection.ts` - Connection management
2. `/relayer/src/keypair.ts` - Keypair utilities
3. `/relayer/src/endpoints/airdrop.ts` - Airdrop endpoint
4. `/relayer/src/endpoints/price.ts` - Price endpoint
5. `/relayer/src/services/poolService.ts` - Pool data service

### Examples:
1. `/relayer/examples/airdrop.ts` - Airdrop example
2. `/relayer/examples/check-price.ts` - Price query example
3. `/relayer/examples/swap-realtime.ts` - Real swap example

## Testing Plan

### Unit Tests:
- Mock Solana connection responses
- Test transaction building logic
- Validate error handling

### Integration Tests:
- Use local validator
- Test full order flow
- Verify token transfers

### End-to-End Tests:
- Submit orders through API
- Monitor execution
- Verify final balances

### Load Tests:
- Multiple concurrent orders
- Measure throughput
- Identify bottlenecks

## Success Criteria

1. **Functionality**:
   - [ ] Real token swaps execute successfully
   - [ ] Airdrop endpoint works reliably
   - [ ] Price endpoint returns accurate data
   - [ ] All examples work with real transactions

2. **Performance**:
   - [ ] Order execution < 5 seconds (95th percentile)
   - [ ] API response time < 100ms
   - [ ] Handle 50+ concurrent orders
   - [ ] No memory leaks over time

3. **Reliability**:
   - [ ] Graceful error handling
   - [ ] Automatic retry on failures
   - [ ] Clear error messages
   - [ ] Comprehensive logging

## Rollback Plan

If issues arise:
1. Keep mock implementation available via feature flag
2. Switch between mock/real mode without restart
3. Preserve all order data during transition
4. Document rollback procedure

## Next Steps

1. Begin Phase 1 implementation
2. Set up development environment
3. Create test wallets and tokens
4. Implement endpoints incrementally
5. Test each phase thoroughly

This plan ensures a systematic transition from mock to real blockchain integration while maintaining system stability and adding requested features.