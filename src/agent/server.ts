/**
 * Server for the Comet agent API
 */

import { serve } from '@hono/node-server';
import { logger } from './utils/logger';
import api from './api';

// Get port from environment or use default
const PORT = process.env.COMET_API_PORT 
  ? parseInt(process.env.COMET_API_PORT) 
  : 3001;

// Create server instance
let server;

// Start the server with error handling
try {
  server = serve({
    fetch: api.fetch,
    port: PORT,
    onError: (error, request) => {
      const url = request?.url || 'unknown URL';
      logger.error(`Server error handling request to ${url}:`, error);
      return new Response(JSON.stringify({
        status: 'error',
        error: 'Internal server error',
        message: error.message,
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });
  
  logger.info(`Comet Agent API server started on port ${PORT}`);
} catch (error) {
  logger.error('Failed to start server:', error);
  process.exit(1);
}

// Global error handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  // Keep the server running despite uncaught exceptions
  // but log them for investigation
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection:', reason);
  // Keep the server running despite unhandled rejections
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down Comet Agent API server...');
  if (server && server.close) {
    server.close(() => {
      logger.info('Server closed gracefully');
      process.exit(0);
    });
    
    // Force close after timeout
    setTimeout(() => {
      logger.warn('Forcing server shutdown after timeout');
      process.exit(1);
    }, 5000);
  } else {
    process.exit(0);
  }
});

process.on('SIGTERM', () => {
  logger.info('Shutting down Comet Agent API server...');
  if (server && server.close) {
    server.close(() => {
      logger.info('Server closed gracefully');
      process.exit(0);
    });
    
    // Force close after timeout
    setTimeout(() => {
      logger.warn('Forcing server shutdown after timeout');
      process.exit(1);
    }, 5000);
  } else {
    process.exit(0);
  }
});