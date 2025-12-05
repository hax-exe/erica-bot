import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino(
    config.bot.isDev
        ? {
            level: config.logging.level,
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                },
            },
        }
        : {
            level: config.logging.level,
        }
);

export const createLogger = (name: string) => {
    return logger.child({ module: name });
};
