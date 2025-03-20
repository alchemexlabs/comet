/**
 * Logger utility for the Comet agent
 */

// Define log levels
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

// Get log level from environment or default to INFO
const LOG_LEVEL = process.env.COMET_LOG_LEVEL 
  ? getLogLevelFromString(process.env.COMET_LOG_LEVEL)
  : LogLevel.INFO;

// Convert string log level to enum
function getLogLevelFromString(level: string): LogLevel {
  switch (level.toLowerCase()) {
    case 'debug': return LogLevel.DEBUG;
    case 'info': return LogLevel.INFO;
    case 'warn': return LogLevel.WARN;
    case 'error': return LogLevel.ERROR;
    default: return LogLevel.INFO;
  }
}

// Format the current timestamp
function getTimestamp(): string {
  return new Date().toISOString();
}

// Format a log message
function formatLogMessage(level: string, message: string): string {
  return `[${getTimestamp()}] [${level}] ${message}`;
}

// Logger implementation
export const logger = {
  debug(message: string, ...args: any[]): void {
    if (LOG_LEVEL <= LogLevel.DEBUG) {
      console.debug(formatLogMessage('DEBUG', message), ...args);
    }
  },

  info(message: string, ...args: any[]): void {
    if (LOG_LEVEL <= LogLevel.INFO) {
      console.info(formatLogMessage('INFO', message), ...args);
    }
  },

  warn(message: string, ...args: any[]): void {
    if (LOG_LEVEL <= LogLevel.WARN) {
      console.warn(formatLogMessage('WARN', message), ...args);
    }
  },

  error(message: string, ...args: any[]): void {
    if (LOG_LEVEL <= LogLevel.ERROR) {
      console.error(formatLogMessage('ERROR', message), ...args);
    }
  },

  // Log execution time of a function
  async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
    if (LOG_LEVEL <= LogLevel.DEBUG) {
      console.time(label);
      try {
        return await fn();
      } finally {
        console.timeEnd(label);
      }
    } else {
      return fn();
    }
  },
};