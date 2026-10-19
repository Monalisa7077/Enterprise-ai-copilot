import winston from 'winston';
import env from './env.js';

const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.colorize({ all: true }),
    winston.format.printf(({ level, message, timestamp, ...meta }) => {
      const extra = Object.keys(meta).length ? JSON.stringify(meta) : '';
      return `${timestamp} ${level}: ${message}${extra ? ` ${extra}` : ''}`;
    }),
  ),
  transports: [new winston.transports.Console()],
});

export default logger;
