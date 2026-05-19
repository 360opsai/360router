/**
 * 360Router proxy server
 * Listens on port 3600 and acts as an OpenAI-compatible API endpoint
 */

import express from 'express';
import cors from 'cors';
import { createRoutes } from './routes.js';
import { createOllamaRoutes } from './ollama-routes.js';
import { authMiddleware, rateLimitMiddleware } from './middleware.js';

export function startServer(port: number = 3600): express.Application {
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
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '1.0.4', port, protocols: ['openai', 'ollama'] });
  });

  app.listen(port, () => {
    console.log(`\n360Router proxy running on http://localhost:${port}`);
    console.log(`  OpenAI apps:  http://localhost:${port}/v1`);
    console.log(`  Ollama apps:  http://localhost:${port}  (drop-in replacement)`);
    console.log(`Press Ctrl+C to stop.\n`);
  });

  return app;
}
