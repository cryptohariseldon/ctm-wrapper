"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const relayer_1 = require("./relayer");
const config_1 = require("./config");
const logger_1 = require("./logger");
async function main() {
    try {
        logger_1.logger.info('Starting Continuum CP-Swap Relayer...');
        const relayer = new relayer_1.Relayer(config_1.config);
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            logger_1.logger.info('Shutting down relayer...');
            await relayer.stop();
            process.exit(0);
        });
        // Start the relayer
        await relayer.start();
    }
    catch (error) {
        logger_1.logger.error('Failed to start relayer:', error);
        process.exit(1);
    }
}
main();
