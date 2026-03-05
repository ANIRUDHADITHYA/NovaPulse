'use strict';

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const logsDir = path.join(__dirname, '../../logs');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack }) =>
      `${timestamp} [${level.toUpperCase()}] ${stack || message}`
    )
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message }) =>
          `${timestamp} [${level}] ${message}`
        )
      ),
    }),
    new DailyRotateFile({
      dirname: logsDir,
      filename: 'novapulse-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      maxSize: '20m',
    }),
    new DailyRotateFile({
      dirname: logsDir,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxFiles: '30d',
    }),
  ],
});

module.exports = logger;
