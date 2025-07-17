import { spawn } from 'child_process';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Simple relayer setup and start examples
 */

/**
 * Setup relayer configuration
 */
async function setupRelayer() {
  console.log('=== Setting up Relayer ===\n');
  
  const connection = new Connection('http://localhost:8899', 'confirmed');
  const relayerDir = path.join(__dirname, '../../relayer');
  
  // Generate relayer keypair
  const relayerKeypair = Keypair.generate();
  console.log('Relayer address:', relayerKeypair.publicKey.toBase58());
  
  // Fund relayer
  console.log('Funding relayer account...');
  const airdropSig = await connection.requestAirdrop(
    relayerKeypair.publicKey,
    5 * LAMPORTS_PER_SOL
  );
  await connection.confirmTransaction(airdropSig);
  console.log('Relayer funded with 5 SOL');
  
  // Save keypair
  const keypairPath = path.join(relayerDir, 'relayer-keypair-test.json');
  fs.writeFileSync(
    keypairPath,
    JSON.stringify(Array.from(relayerKeypair.secretKey))
  );
  console.log('Keypair saved to:', keypairPath);
  
  // Create simple config
  const config = {
    port: 8080,
    rpc: {
      endpoint: 'http://localhost:8899',
      websocket: 'ws://localhost:8900'
    },
    relayer: {
      keypairPath: './relayer-keypair-test.json',
      programId: 'A548C9LR926hnAWvYDjsXJddidhfzLf3bRb8dmYPgRKn',
      cpSwapProgramId: 'GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp'
    },
    monitoring: {
      logLevel: 'info',
      executionInterval: 5000
    }
  };
  
  const configPath = path.join(relayerDir, 'config-test.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('Config saved to:', configPath);
  
  console.log('\n✅ Relayer setup complete!');
  console.log('\nTo start the relayer:');
  console.log(`  cd ${relayerDir}`);
  console.log('  npm install');
  console.log('  npm run build');
  console.log('  npm start');
}

/**
 * Start relayer with Node.js
 */
async function startRelayerNode() {
  console.log('=== Starting Relayer with Node.js ===\n');
  
  const relayerDir = path.join(__dirname, '../../relayer');
  
  // Check if dependencies are installed
  if (!fs.existsSync(path.join(relayerDir, 'node_modules'))) {
    console.log('Installing dependencies...');
    const install = spawn('npm', ['install'], {
      cwd: relayerDir,
      stdio: 'inherit'
    });
    
    await new Promise(resolve => {
      install.on('close', resolve);
    });
  }
  
  // Build if needed
  if (!fs.existsSync(path.join(relayerDir, 'dist'))) {
    console.log('Building TypeScript...');
    const build = spawn('npm', ['run', 'build'], {
      cwd: relayerDir,
      stdio: 'inherit'
    });
    
    await new Promise(resolve => {
      build.on('close', resolve);
    });
  }
  
  // Start the relayer
  console.log('Starting relayer...');
  const relayer = spawn('npm', ['start'], {
    cwd: relayerDir,
    stdio: 'pipe'
  });
  
  relayer.stdout.on('data', (data) => {
    console.log(`[Relayer] ${data.toString().trim()}`);
  });
  
  relayer.stderr.on('data', (data) => {
    console.error(`[Relayer Error] ${data.toString().trim()}`);
  });
  
  relayer.on('close', (code) => {
    console.log(`Relayer exited with code ${code}`);
  });
  
  // Give it time to start
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log('\nRelayer should be starting...');
  console.log('Check http://localhost:8080/health');
  
  return relayer;
}

/**
 * Start relayer with Docker
 */
function startRelayerDocker() {
  console.log('=== Starting Relayer with Docker ===\n');
  
  const relayerDir = path.join(__dirname, '../../relayer');
  
  console.log('Starting with docker-compose...');
  const docker = spawn('docker-compose', ['up'], {
    cwd: relayerDir,
    stdio: 'inherit'
  });
  
  docker.on('error', (error) => {
    console.error('Docker error:', error);
    console.log('\nMake sure Docker is installed and running');
  });
  
  return docker;
}

/**
 * Create systemd service file
 */
function createSystemdService() {
  console.log('=== Creating Systemd Service ===\n');
  
  const relayerDir = path.resolve(path.join(__dirname, '../../relayer'));
  
  const serviceContent = `[Unit]
Description=Continuum Relayer
After=network.target

[Service]
Type=simple
User=${process.env.USER}
WorkingDirectory=${relayerDir}
ExecStart=/usr/bin/node ${relayerDir}/dist/index.js
Restart=always
RestartSec=10
Environment="NODE_ENV=production"

[Install]
WantedBy=multi-user.target`;
  
  console.log('Service file content:\n');
  console.log(serviceContent);
  
  const servicePath = path.join(relayerDir, 'continuum-relayer.service');
  fs.writeFileSync(servicePath, serviceContent);
  
  console.log('\nService file saved to:', servicePath);
  console.log('\nTo install:');
  console.log('  sudo cp', servicePath, '/etc/systemd/system/');
  console.log('  sudo systemctl daemon-reload');
  console.log('  sudo systemctl enable continuum-relayer');
  console.log('  sudo systemctl start continuum-relayer');
}

// Main function to run examples
async function main() {
  const command = process.argv[2] || 'setup';
  
  try {
    switch (command) {
      case 'setup':
        await setupRelayer();
        break;
        
      case 'start':
        await startRelayerNode();
        break;
        
      case 'docker':
        startRelayerDocker();
        break;
        
      case 'service':
        createSystemdService();
        break;
        
      default:
        console.log('Usage: ts-node start-relayer-simple.ts [setup|start|docker|service]');
        console.log('  setup   - Setup relayer configuration');
        console.log('  start   - Start relayer with Node.js');
        console.log('  docker  - Start relayer with Docker');
        console.log('  service - Create systemd service file');
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { setupRelayer, startRelayerNode, startRelayerDocker, createSystemdService };