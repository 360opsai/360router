/**
 * Ollama-compatible routes for the proxy server
 *
 * Translates Ollama API format ↔ 360router core, so any Ollama client
 * (Open WebUI, Enchanted, CLI wrappers, etc.) can use 360router as a
 * drop-in replacement by changing the port from 11434 to 3600.
 *
 * Routes:
 *   POST /api/chat       — Ollama chat (streaming + non-streaming)
 *   POST /api/generate   — Ollama text generation
 *   GET  /api/tags       — List all models (all providers, Ollama format)
 *   GET  /api/version    — 360router version in Ollama format
 *   POST /api/show       — Model info (stub)
 *   POST /api/embeddings — Ollama embeddings format
 */

import type { Express, Request, Response } from 'express';
import { route, routeStream, routeEmbedding } from '../core/router.js';
import { loadConfig } from '../core/config.js';
import { recordEvent } from '../core/telemetry.js';

const ROUTER_VERSION = '1.0.3';

export function createOllamaRoutes(app: Express): void {

  // ── GET /api/tags — List models (Ollama format) ──────────────────────────
  app.get('/api/tags', async (req: Request, res: Response) => {
    try {
      const config = loadConfig();
      const models: any[] = [];

      for (const provider of config.providers.filter(p => p.enabled)) {
        if (provider.kind === 'local' && provider.baseUrl) {
          // Try Ollama native endpoint
          try {
            const r = await fetch(`${provider.baseUrl}/api/tags`, {
              signal: AbortSignal.timeout(3000),
            });
            if (r.ok) {
              const data = (await r.json()) as any;
              for (const m of data.models ?? []) {
                models.push({
                  name: m.name,
                  model: m.model ?? m.name,
                  modified_at: m.modified_at ?? new Date().toISOString(),
                  size: m.size ?? 0,
                  digest: m.digest ?? '',
                  details: m.details ?? {},
                });
              }
              continue;
            }
          } catch { /* try OpenAI format */ }

          // Try OpenAI-compatible /v1/models
          try {
            const r = await fetch(`${provider.baseUrl}/v1/models`, {
              headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
              signal: AbortSignal.timeout(3000),
            });
            if (r.ok) {
              const data = (await r.json()) as any;
              for (const m of data.data ?? []) {
                models.push({
                  name: m.id,
                  model: m.id,
                  modified_at: new Date(m.created * 1000).toISOString(),
                  size: 0,
                  digest: '',
                  details: { family: provider.label ?? provider.name },
                });
              }
            }
          } catch { /* offline */ }
        } else {
          // Cloud provider — list known models
          const cloudModels = getCloudModelsForOllama(provider.name);
          for (const name of cloudModels) {
            models.push({
              name,
              model: name,
              modified_at: new Date().toISOString(),
              size: 0,
              digest: '',
              details: { family: provider.name },
            });
          }
        }
      }

      res.json({ models });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/chat — Ollama chat format ──────────────────────────────────
  app.post('/api/chat', async (req: Request, res: Response) => {
    const start = Date.now();
    const body = req.body;
    const isStreaming = body.stream !== false; // Ollama defaults to streaming

    try {
      // Convert Ollama messages to OpenAI format
      const messages = (body.messages ?? []).map((m: any) => ({
        role: m.role,
        content: m.content,
      }));

      if (isStreaming) {
        // Ollama streaming: NDJSON (not SSE)
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.setHeader('Transfer-Encoding', 'chunked');

        try {
          let fullContent = '';
          for await (const chunk of routeStream(messages, {
            forceModel: body.model,
            maxTokens: body.options?.num_predict ?? 2048,
            temperature: body.options?.temperature ?? 0.7,
          })) {
            // chunk is OpenAI SSE JSON string — parse and convert to Ollama format
            try {
              const parsed = JSON.parse(chunk);
              const delta = parsed.choices?.[0]?.delta?.content ?? '';
              fullContent += delta;

              res.write(JSON.stringify({
                model: body.model ?? parsed.model ?? 'unknown',
                created_at: new Date().toISOString(),
                message: { role: 'assistant', content: delta },
                done: false,
              }) + '\n');
            } catch {
              // Skip unparseable chunks
            }
          }

          // Final done message
          const latency = Date.now() - start;
          res.write(JSON.stringify({
            model: body.model ?? 'unknown',
            created_at: new Date().toISOString(),
            message: { role: 'assistant', content: '' },
            done: true,
            total_duration: latency * 1_000_000, // ns
            eval_duration: latency * 1_000_000,
            eval_count: fullContent.split(/\s+/).length,
          }) + '\n');
          res.end();

          recordEvent({ event: 'route_completed', provider: 'ollama-compat', latency_ms: latency, success: true });
        } catch (err: any) {
          res.write(JSON.stringify({ error: err.message, done: true }) + '\n');
          res.end();
        }
        return;
      }

      // Non-streaming
      const result = await route(messages, {
        forceModel: body.model,
        maxTokens: body.options?.num_predict ?? 2048,
        temperature: body.options?.temperature ?? 0.7,
      });

      const latency = Date.now() - start;

      res.json({
        model: result.model,
        created_at: new Date().toISOString(),
        message: { role: 'assistant', content: result.content },
        done: true,
        total_duration: latency * 1_000_000,
        eval_duration: latency * 1_000_000,
        eval_count: result.content.split(/\s+/).length,
      });

      recordEvent({ event: 'route_completed', provider: result.provider, latency_ms: latency, success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/generate — Ollama text generation ──────────────────────────
  app.post('/api/generate', async (req: Request, res: Response) => {
    const start = Date.now();
    const body = req.body;
    const isStreaming = body.stream !== false;

    try {
      const messages = [
        ...(body.system ? [{ role: 'system' as const, content: body.system }] : []),
        { role: 'user' as const, content: body.prompt ?? '' },
      ];

      if (isStreaming) {
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.setHeader('Transfer-Encoding', 'chunked');

        let fullContent = '';
        try {
          for await (const chunk of routeStream(messages, {
            forceModel: body.model,
            maxTokens: body.options?.num_predict ?? 2048,
            temperature: body.options?.temperature ?? 0.7,
          })) {
            try {
              const parsed = JSON.parse(chunk);
              const delta = parsed.choices?.[0]?.delta?.content ?? '';
              fullContent += delta;
              res.write(JSON.stringify({
                model: body.model ?? 'unknown',
                created_at: new Date().toISOString(),
                response: delta,
                done: false,
              }) + '\n');
            } catch { /* skip */ }
          }

          const latency = Date.now() - start;
          res.write(JSON.stringify({
            model: body.model ?? 'unknown',
            created_at: new Date().toISOString(),
            response: '',
            done: true,
            total_duration: latency * 1_000_000,
            eval_count: fullContent.split(/\s+/).length,
          }) + '\n');
          res.end();
        } catch (err: any) {
          res.write(JSON.stringify({ error: err.message, done: true }) + '\n');
          res.end();
        }
        return;
      }

      // Non-streaming
      const result = await route(messages, {
        forceModel: body.model,
        maxTokens: body.options?.num_predict ?? 2048,
        temperature: body.options?.temperature ?? 0.7,
      });

      const latency = Date.now() - start;
      res.json({
        model: result.model,
        created_at: new Date().toISOString(),
        response: result.content,
        done: true,
        total_duration: latency * 1_000_000,
        eval_count: result.content.split(/\s+/).length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/embeddings — Ollama embeddings format ──────────────────────
  app.post('/api/embeddings', async (req: Request, res: Response) => {
    try {
      const body = req.body;
      const input = body.prompt ?? body.input ?? '';

      const result = await routeEmbedding(
        Array.isArray(input) ? input : [input],
        body.model
      );

      res.json({
        embedding: result.embeddings[0] ?? [],
        model: result.model,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /api/show — Model info (stub) ───────────────────────────────────
  app.post('/api/show', async (req: Request, res: Response) => {
    const model = req.body.name ?? req.body.model ?? 'unknown';
    res.json({
      modelfile: `# Model: ${model}\n# Served through 360Router`,
      parameters: 'temperature 0.7\nnum_predict 2048',
      template: '{{ .System }}\n{{ .Prompt }}',
      details: {
        format: 'gguf',
        family: '360router',
        parameter_size: 'varies',
        quantization_level: 'varies',
      },
    });
  });

  // ── GET /api/version — Version ───────────────────────────────────────────
  app.get('/api/version', (req: Request, res: Response) => {
    res.json({ version: ROUTER_VERSION });
  });

  // ── Ollama root endpoint (some clients check this) ───────────────────────
  app.get('/', (req: Request, res: Response) => {
    res.send('360Router is running');
  });
}

function getCloudModelsForOllama(provider: string): string[] {
  const models: Record<string, string[]> = {
    anthropic: ['claude-sonnet-4', 'claude-haiku-4.5', 'claude-opus-4'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    groq: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant'],
    gemini: ['gemini-2.0-flash', 'gemini-1.5-pro'],
    grok: ['grok-3', 'grok-3-mini'],
  };
  return models[provider] ?? [];
}
