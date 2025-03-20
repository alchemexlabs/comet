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

// Start the server
serve({
  fetch: api.fetch,
  port: PORT
});

logger.info(`Comet Agent API server started on port ${PORT}`);

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down Comet Agent API server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down Comet Agent API server...');
  process.exit(0);
});