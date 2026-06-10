import { config } from './config.js';
import { EricaClient } from './client.js';

const client = new EricaClient();

async function main(): Promise<void> {
  try {
    client.logger.info('Erica is starting up...');
    await client.login(config.DISCORD_TOKEN);
    client.logger.info('Erica is online and ready!');
  } catch (error) {
    client.logger.fatal('Failed to start Erica:', error);
    client.destroy();
    process.exit(1);
  }
}

process.on('unhandledRejection', (error: Error) => {
  client.logger.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error: Error) => {
  client.logger.fatal('Uncaught exception:', error);
  client.destroy();
  process.exit(1);
});

main();
