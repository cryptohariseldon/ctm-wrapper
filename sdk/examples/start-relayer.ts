import { spawn } from 'child_process';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Example: Start and configure a Continuum Relayer
 * This demonstrates different ways to start and interact with the relayer
 */

interface RelayerConfig {
  port: number;
  rpcUrl: string;
  wsUrl: string;
  relayerKeypair: string;
  programId: string;
  cpSwapProgramId: string;
  logLevel: string;
  maxOrdersPerBatch: number;
  executionInterval: number;
  monitoredPools: string[];
}

/**
 * Start relayer using Docker
 */
async function startRelayerWithDocker() {
  console.log('=== Starting Relayer with Docker ===\n');
  
  // Check if Docker is installed
  const dockerCheck = spawn('docker', ['--version']);
  
  await new Promise((resolve, reject) => {
    dockerCheck.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Docker not installed or not accessible'));
      } else {
        resolve(null);
      }
    });
  });
  
  console.log('Docker is available');
  
  // Navigate to relayer directory
  const relayerDir = path.join(__dirname, '../../relayer');
  
  // Start with docker-compose
  const dockerCompose = spawn('docker-compose', ['up', '-d'], {
    cwd: relayerDir,
    stdio: 'inherit'
  });
  
  await new Promise((resolve, reject) => {
    dockerCompose.on('close', (code) => {
      if (code === 0) {
        console.log('\nRelayer started successfully with Docker');
        resolve(null);
      } else {
        reject(new Error('Failed to start relayer with Docker'));
      }
    });
  });
  
  // Wait for relayer to be ready
  await waitForRelayer('http://localhost:8080');
  
  console.log('\nRelayer is running at http://localhost:8080');
  console.log('Prometheus metrics at http://localhost:9090');
}

/**
 * Start relayer using Node.js directly
 */
async function startRelayerWithNode() {
  console.log('=== Starting Relayer with Node.js ===\n');
  
  const relayerDir = path.join(__dirname, '../../relayer');
  
  // Generate or load relayer keypair
  const keypairPath = path.join(relayerDir, 'relayer-keypair.json');
  let relayerKeypair: Keypair;
  
  if (fs.existsSync(keypairPath)) {
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
    relayerKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
    console.log('Loaded existing relayer keypair');
  } else {
    relayerKeypair = Keypair.generate();
    fs.writeFileSync(keypairPath, JSON.stringify(Array.from(relayerKeypair.secretKey)));
    console.log('Generated new relayer keypair');
  }
  
  console.log('Relayer address:', relayerKeypair.publicKey.toBase58());
  
  // Create config file
  const config: RelayerConfig = {
    port: 8080,
    rpcUrl: 'http://localhost:8899',
    wsUrl: 'ws://localhost:8900',
    relayerKeypair: keypairPath,
    programId: 'YourContinuumProgramId', // Replace with actual program ID
    cpSwapProgramId: 'YourCpSwapProgramId', // Replace with actual program ID
    logLevel: 'info',
    maxOrdersPerBatch: 10,
    executionInterval: 5000, // 5 seconds
    monitoredPools: [] // Add pool IDs to monitor
  };
  
  const configPath = path.join(relayerDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('Created config file');
  
  // Install dependencies if needed
  console.log('\nInstalling dependencies...');
  const npmInstall = spawn('npm', ['install'], {
    cwd: relayerDir,
    stdio: 'inherit'
  });
  
  await new Promise((resolve) => {
    npmInstall.on('close', () => resolve(null));
  });
  
  // Build TypeScript
  console.log('\nBuilding TypeScript...');
  const npmBuild = spawn('npm', ['run', 'build'], {
    cwd: relayerDir,
    stdio: 'inherit'
  });
  
  await new Promise((resolve) => {
    npmBuild.on('close', () => resolve(null));
  });
  
  // Start the relayer
  console.log('\nStarting relayer...');
  const relayerProcess = spawn('npm', ['start'], {
    cwd: relayerDir,
    stdio: 'pipe',
    env: {
      ...process.env,
      CONFIG_PATH: configPath
    }
  });
  
  // Handle output
  relayerProcess.stdout.on('data', (data) => {
    console.log(`[Relayer] ${data.toString().trim()}`);
  });
  
  relayerProcess.stderr.on('data', (data) => {
    console.error(`[Relayer Error] ${data.toString().trim()}`);
  });
  
  // Wait for relayer to be ready
  await waitForRelayer('http://localhost:8080');
  
  console.log('\nRelayer is running!');
  
  return relayerProcess;
}

/**
 * Start relayer as a systemd service (Linux)
 */
async function startRelayerAsService() {
  console.log('=== Starting Relayer as Systemd Service ===\n');
  
  const servicePath = '/etc/systemd/system/continuum-relayer.service';
  const relayerDir = path.join(__dirname, '../../relayer');
  
  // Create service file content
  const serviceContent = `[Unit]
Description=Continuum Relayer Service
After=network.target

[Service]
Type=simple
User=${process.env.USER}
WorkingDirectory=${relayerDir}
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=continuum-relayer
Environment="NODE_ENV=production"
Environment="CONFIG_PATH=${relayerDir}/config.json"

[Install]
WantedBy=multi-user.target`;
  
  console.log('Service file content:');
  console.log(serviceContent);
  
  console.log('\nTo install as service, run:');
  console.log(`sudo tee ${servicePath} << EOF`);
  console.log(serviceContent);
  console.log('EOF');
  console.log('sudo systemctl daemon-reload');
  console.log('sudo systemctl enable continuum-relayer');
  console.log('sudo systemctl start continuum-relayer');
  console.log('sudo systemctl status continuum-relayer');
}

/**
 * Configure and monitor a running relayer
 */
async function configureRunningRelayer() {
  const relayerUrl = 'http://localhost:8080';
  
  console.log('=== Configuring Running Relayer ===\n');
  
  try {
    // Check relayer status
    const infoResponse = await fetch(`${relayerUrl}/api/v1/info`);
    const info = await infoResponse.json();
    
    console.log('Relayer Info:');
    console.log('  Version:', info.version);
    console.log('  Uptime:', info.uptime);
    console.log('  Orders processed:', info.ordersProcessed);
    console.log('  Monitored pools:', info.monitoredPools.length);
    
    // Add a pool to monitor
    const poolId = 'YourPoolIdHere'; // Replace with actual pool ID
    
    const addPoolResponse = await fetch(`${relayerUrl}/api/v1/pools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ poolId })
    });
    
    if (addPoolResponse.ok) {
      console.log('\nAdded pool to monitoring:', poolId);
    }
    
    // Get statistics
    const statsResponse = await fetch(`${relayerUrl}/api/v1/stats`);
    const stats = await statsResponse.json();
    
    console.log('\nRelayer Statistics:');
    console.log('  Total orders:', stats.totalOrders);
    console.log('  Successful executions:', stats.successfulExecutions);
    console.log('  Failed executions:', stats.failedExecutions);
    console.log('  Average execution time:', stats.avgExecutionTime, 'ms');
    
  } catch (error) {
    console.error('Error configuring relayer:', error);
  }
}

/**
 * Wait for relayer to be ready
 */
async function waitForRelayer(url: string, maxAttempts = 30) {
  console.log(`\nWaiting for relayer at ${url}...`);
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        console.log('Relayer is ready!');
        return;
      }
    } catch (error) {
      // Ignore connection errors while waiting
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    process.stdout.write('.');
  }
  
  throw new Error('Relayer failed to start within timeout');
}

/**
 * Example: Complete relayer setup
 */
async function completeRelayerSetup() {
  const connection = new Connection('http://localhost:8899', 'confirmed');
  
  console.log('=== Complete Relayer Setup ===\n');
  
  // 1. Generate relayer keypair
  const relayerKeypair = Keypair.generate();
  console.log('Relayer address:', relayerKeypair.publicKey.toBase58());
  
  // 2. Fund relayer (for transaction fees)
  console.log('\nFunding relayer account...');
  const airdropSig = await connection.requestAirdrop(
    relayerKeypair.publicKey,
    5e9 // 5 SOL
  );
  await connection.confirmTransaction(airdropSig);
  console.log('Relayer funded with 5 SOL');
  
  // 3. Save keypair
  const relayerDir = path.join(__dirname, '../../relayer');
  const keypairPath = path.join(relayerDir, 'relayer-keypair.json');
  fs.writeFileSync(keypairPath, JSON.stringify(Array.from(relayerKeypair.secretKey)));
  
  // 4. Create configuration
  const config = {
    relayer: {
      keypairPath,
      maxConcurrentExecutions: 5,
      executionInterval: 3000,
      retryAttempts: 3,
      retryDelay: 1000
    },
    rpc: {
      endpoint: 'http://localhost:8899',
      websocket: 'ws://localhost:8900',
      commitment: 'confirmed'
    },
    server: {
      port: 8080,
      cors: true,
      rateLimit: {
        windowMs: 60000,
        max: 100
      }
    },
    monitoring: {
      prometheus: {
        enabled: true,
        port: 9090
      }
    }
  };
  
  const configPath = path.join(relayerDir, 'config.advanced.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  
  console.log('\nRelayer setup complete!');
  console.log('Configuration saved to:', configPath);
  console.log('\nTo start the relayer:');
  console.log('  cd', relayerDir);
  console.log('  npm start -- --config', configPath);
}

// Run examples based on command line argument
if (require.main === module) {
  const mode = process.argv[2] || 'node';
  
  switch (mode) {
    case 'docker':
      startRelayerWithDocker()
        .then(() => console.log('\nDocker relayer started'))
        .catch(console.error);
      break;
      
    case 'service':
      startRelayerAsService()
        .then(() => console.log('\nService configuration displayed'))
        .catch(console.error);
      break;
      
    case 'configure':
      configureRunningRelayer()
        .then(() => console.log('\nRelayer configured'))
        .catch(console.error);
      break;
      
    case 'setup':
      completeRelayerSetup()
        .then(() => console.log('\nSetup complete'))
        .catch(console.error);
      break;
      
    case 'node':
    default:
      startRelayerWithNode()
        .then(() => {
          console.log('\nRelayer is running. Press Ctrl+C to stop.');
        })
        .catch(console.error);
  }
}

export { 
  startRelayerWithDocker, 
  startRelayerWithNode, 
  startRelayerAsService,
  configureRunningRelayer,
  completeRelayerSetup
};