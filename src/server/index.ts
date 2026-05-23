/**
 * 360Router proxy server
 * Listens on port 3600 and acts as an OpenAI-compatible API endpoint
 */

import http from 'http';
import express from 'express';
import cors from 'cors';
import { createRoutes } from './routes.js';
import { createOllamaRoutes } from './ollama-routes.js';
import { authMiddleware, rateLimitMiddleware } from './middleware.js';

/**
 * Creates and starts the proxy server.
 * Returns the raw http.Server so the caller can attach error handlers
 * (e.g. EADDRINUSE) and perform proper cleanup before exiting.
 */
export function startServer(port: number = 3600): http.Server {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Mount auth and rate limiting before routes
  app.use(authMiddleware());
  app.use(rateLimitMiddleware());

  // Mount OpenAI-compatible routes
  createRoutes(app);

  // Mount Ollama-compatible routes
  createOllamaRoutes(app);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '1.0.4', port, protocols: ['openai', 'ollama'] });
  });

  // No auto-print — serve.ts owns the UI. No error handler here — caller owns it.
  const server = app.listen(port);
  return server;
}
