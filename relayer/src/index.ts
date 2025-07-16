import { Relayer } from './relayer';
import { config } from './config';
import { logger } from './logger';

async function main() {
  try {
    logger.info('Starting Continuum CP-Swap Relayer...');
    
    const relayer = new Relayer(config);
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down relayer...');
      await relayer.stop();
      process.exit(0);
    });
    
    // Start the relayer
    await relayer.start();
    
  } catch (error) {
    logger.error('Failed to start relayer:', error);
    process.exit(1);
  }
}

main();