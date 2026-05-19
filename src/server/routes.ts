/**
 * OpenAI-compatible routes for the proxy server
 * Implements /v1/chat/completions and /v1/models
 */

import type { Express, Request, Response } from 'express';
import { route, routeStream, routeEmbedding } from '../core/router.js';
import { loadConfig } from '../core/config.js';
import { recordEvent } from '../core/telemetry.js';
import { createProvider } from '../providers/index.js';
import { getGlobalCache } from '../core/response-cache.js';
import { getCurrentTier, getTierLimits } from '../core/tier-gate.js';

export function createRoutes(app: Express): void {
  // ── GET /v1/models ──────────────────────────────────────────────────────────
  // Apps call this to discover available models
  // We return all models from all configured providers
  app.get('/v1/models', async (req: Request, res: Response) => {
    try {
      const config = loadConfig();
      const models: any[] = [];

      for (const provider of config.providers.filter(p => p.enabled)) {
        if (provider.kind === 'local' && provider.baseUrl) {
          // Probe local endpoint for models
          try {
            const r = await fetch(`${provider.baseUrl}/v1/models`, {
              headers: provider.apiKey
                ? { Authorization: `Bearer ${provider.apiKey}` }
                : {},
              signal: AbortSignal.timeout(3000),
            });
            if (r.ok) {
              const data = (await r.json()) as any;
              const providerModels = (data.data ?? []).map((m: any) => ({
                ...m,
                id: `${provider.label ?? provider.name}/${m.id}`,
                owned_by: provider.label ?? provider.name,
              }));
              models.push(...providerModels);
            }
          } catch {
            /* provider offline */
          }
        } else {
          // Cloud provider — return known models
          const cloudModels = getCloudModels(provider.name);
          models.push(
            ...cloudModels.map(m => ({
              id: m,
              object: 'model',
              owned_by: provider.name,
              created: Math.floor(Date.now() / 1000),
            }))
          );
        }
      }

      res.json({ object: 'list', data: models });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message, type: 'server_error' } });
    }
  });

  // ── POST /v1/chat/completions ────────────────────────────────────────────────
  // Main routing endpoint — every AI app sends chat requests here
  app.post('/v1/chat/completions', async (req: Request, res: Response) => {
    const start = Date.now();
    const body = req.body;

    try {
      // Streaming, tool calls, embeddings are ALL available on Free — no restrictions
      // (Free differentiates on business features: persistence, compliance, analytics)

      // Extract messages from request body
      const messages = body.messages ?? [];
      const isStreaming = body.stream === true;

      // Normalize model: strip provider prefix (e.g. "spartan-dgx-ios/llama3.2:3b" → "llama3.2:3b")
      // and treat "auto"/null/undefined as "let the router decide"
      let requestedModel: string | undefined = body.model;
      if (!requestedModel || requestedModel === 'auto') requestedModel = undefined;
      else if (requestedModel.includes('/')) requestedModel = requestedModel.split('/').slice(1).join('/');

      // Handle streaming requests
      if (isStreaming) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        try {
          for await (const chunk of routeStream(messages, {
            forceProvider: body.provider,
            forceModel: requestedModel,
            maxTokens: body.max_tokens ?? 4096,
            temperature: body.temperature ?? 0.7,
            tools: body.tools,
            tool_choice: body.tool_choice
          })) {
            res.write(`data: ${chunk}\n\n`);
          }

          res.write('data: [DONE]\n\n');
          res.end();

          const latency = Date.now() - start;
          recordEvent({ event: 'route_completed', provider: 'stream', latency_ms: latency, success: true });
          recordStat('stream', body.model || 'unknown', latency, true);
        } catch (err: any) {
          res.write(`data: ${JSON.stringify({ error: { message: err.message, type: 'server_error' } })}\n\n`);
          res.end();

          const latency = Date.now() - start;
          recordEvent({ event: 'route_failed', provider: 'stream', latency_ms: latency, success: false, error_code: 'streaming_error' });
          recordStat('stream', 'unknown', latency, false);
        }
        return;
      }

      // Non-streaming request
      const result = await route(messages, {
        forceProvider: body.provider,
        forceModel: requestedModel,
        maxTokens: body.max_tokens ?? 4096,
        temperature: body.temperature ?? 0.7,
        tools: body.tools,
        tool_choice: body.tool_choice
      });

      if (!result.success) {
        throw new Error(result.error ?? 'Routing failed');
      }

      // Determine finish_reason
      let finishReason: string = 'stop';
      if (result.tool_calls && result.tool_calls.length > 0) {
        finishReason = 'tool_calls';
      }

      // Return in OpenAI format so any app understands it
      const openAIResponse: any = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: result.model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: result.content,
              ...(result.tool_calls && result.tool_calls.length > 0 ? { tool_calls: result.tool_calls } : {})
            },
            finish_reason: finishReason,
          },
        ],
        usage: {
          prompt_tokens: 0, // TODO(0.3.0): track token usage
          completion_tokens: 0,
          total_tokens: 0,
        },
        // 360Router metadata (apps can ignore this)
        x_360router: {
          provider: result.provider,
          latency_ms: result.latencyMs,
          tier: result.tier,
          pii_detected: result.piiDetected,
        },
      };

      const latency = Date.now() - start;
      recordEvent({ event: 'route_completed', provider: result.provider, latency_ms: latency, success: true });
      recordStat(result.provider, result.model, latency, true);
      res.json(openAIResponse);
    } catch (err: any) {
      const latency = Date.now() - start;
      recordEvent({ event: 'route_failed', provider: 'unknown', latency_ms: latency, success: false, error_code: 'routing_error' });
      recordStat('unknown', 'unknown', latency, false);
      res.status(500).json({ error: { message: err.message ?? 'Routing failed', type: 'server_error', code: 'routing_error' } });
    }
  });

  // ── POST /v1/embeddings ──────────────────────────────────────────────────────
  // Embeddings endpoint for generating vector representations
  app.post('/v1/embeddings', async (req: Request, res: Response) => {
    const start = Date.now();
    const body = req.body;

    try {
      // Embeddings available on Free — no tier gate
      const input = body.input;
      const model = body.model;

      if (!input) {
        return res.status(400).json({
          error: { message: 'input is required', type: 'invalid_request_error' }
        });
      }

      const result = await routeEmbedding(input, model);

      // Return in OpenAI embeddings format
      const openAIResponse = {
        object: 'list',
        data: result.embeddings.map((embedding, index) => ({
          object: 'embedding',
          embedding,
          index
        })),
        model: result.model,
        usage: {
          prompt_tokens: 0,
          total_tokens: 0
        }
      };

      const latency = Date.now() - start;
      recordEvent({ event: 'embedding_completed', provider: result.provider, latency_ms: latency, success: true });
      recordStat(result.provider, result.model, latency, true);
      res.json(openAIResponse);
    } catch (err: any) {
      const latency = Date.now() - start;
      recordEvent({ event: 'embedding_failed', provider: 'unknown', latency_ms: latency, success: false, error_code: 'embedding_error' });
      recordStat('unknown', 'unknown', latency, false);
      res.status(500).json({ error: { message: err.message ?? 'Embedding failed', type: 'server_error', code: 'embedding_error' } });
    }
  });

  // ── Admin endpoints ─────────────────────────────────────────────────────────
  // GET /admin/status — live server status + provider health
  app.get('/admin/status', async (req: Request, res: Response) => {
    const config = loadConfig();
    const providers = config.providers.filter(p => p.enabled).map(p => ({
      name: p.name,
      kind: p.kind,
      label: p.label ?? p.name,
      baseUrl: p.baseUrl ?? null,
    }));
    res.json({
      status: 'running',
      version: '1.0.0',
      uptime: Math.floor((Date.now() - new Date(stats.startedAt).getTime()) / 1000),
      startedAt: stats.startedAt,
      providers,
      stats: {
        totalRequests: stats.totalRequests,
        successRate: stats.totalRequests > 0 ? Math.round((stats.successCount / stats.totalRequests) * 100) : 100,
      },
    });
  });

  // GET /admin/telemetry — routing telemetry summary
  app.get('/admin/telemetry', (req: Request, res: Response) => {
    const providerSummary = Object.entries(stats.byProvider).map(([name, data]) => ({
      provider: name,
      requests: data.count,
      avgLatencyMs: data.count > 0 ? Math.round(data.totalMs / data.count) : 0,
      errors: data.errors,
      successRate: data.count > 0 ? Math.round(((data.count - data.errors) / data.count) * 100) : 100,
      totalTokens: data.totalInputTokens + data.totalOutputTokens,
      costUsd: Math.round(data.totalCostUsd * 10000) / 10000,
    }));

    // Top models by usage
    const topModels = Object.entries(stats.byModel)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([model, count]) => ({ model, count }));

    const localPct = stats.totalRequests > 0 ? Math.round((stats.localCount / stats.totalRequests) * 100) : 100;

    res.json({
      startedAt: stats.startedAt,
      uptimeSeconds: Math.floor((Date.now() - new Date(stats.startedAt).getTime()) / 1000),
      totalRequests: stats.totalRequests,
      successCount: stats.successCount,
      failCount: stats.failCount,
      successRate: stats.totalRequests > 0 ? Math.round((stats.successCount / stats.totalRequests) * 100) : 100,
      routing: {
        localCount: stats.localCount,
        cloudCount: stats.cloudCount,
        localPct,
        privacySaves: stats.localCount, // every local route = data that stayed private
      },
      tokens: {
        totalInput: stats.totalInputTokens,
        totalOutput: stats.totalOutputTokens,
        total: stats.totalInputTokens + stats.totalOutputTokens,
      },
      cost: {
        totalUsd: Math.round(stats.totalCostUsd * 10000) / 10000,
        cloudOnlyUsd: Math.round(stats.totalCostUsd * 10000) / 10000,
        savedByLocal: `${stats.localCount} requests routed locally (free)`,
      },
      byProvider: providerSummary,
      topModels,
      recentRequests: stats.recentRequests.slice(-20),
    });
  });

  // GET /admin/cache — cache statistics (Feature 4)
  app.get('/admin/cache', (req: Request, res: Response) => {
    const config = loadConfig();
    const cache = getGlobalCache(
      config.cacheMaxSize || 500,
      (config.cacheTtlSeconds || 300) * 1000
    );
    const cacheStats = cache.stats();

    res.json({
      enabled: config.cacheEnabled !== false,
      maxSize: config.cacheMaxSize || 500,
      ttlSeconds: config.cacheTtlSeconds || 300,
      stats: cacheStats
    });
  });

  // GET /admin/tier — tier info and upgrade prompt
  app.get('/admin/tier', (req: Request, res: Response) => {
    const tier = getCurrentTier();
    const limits = getTierLimits(tier);

    res.json({
      tier,
      limits,
      upgradeUrl: 'https://360ops.ai/pricing',
      features: {
        streaming: limits.streaming,
        toolCalls: limits.toolCalls,
        embeddings: limits.embeddings,
        maxCloudProviders: limits.maxCloudProviders,
        cacheMaxSize: limits.cacheMaxSize,
        cacheTtlSeconds: limits.cacheTtlSeconds,
        qualityGateAutoEscalate: limits.qualityGateAutoEscalate,
        routingTablePersist: limits.routingTablePersist,
        persistentRequestLog: limits.persistentRequestLog,
        rateLimitMax: limits.rateLimitMax,
        analyticsHistorical: limits.analyticsHistorical,
        sensitivityScrubAndBlock: limits.sensitivityScrubAndBlock,
        miOutputValidator: limits.miOutputValidator,
        classifierModel: limits.classifierModel
      }
    });
  });

  // GET /admin/analytics/historical — Pro-only historical analytics
  app.get('/admin/analytics/historical', (req: Request, res: Response) => {
    const limits = getTierLimits(getCurrentTier());
    if (!limits.analyticsHistorical) {
      return res.status(403).json({
        error: {
          message: 'Historical analytics requires Pro tier. Upgrade at https://360ops.ai/pricing',
          type: 'tier_required',
          code: 'historical_analytics_requires_pro'
        }
      });
    }

    // TODO: Implement actual historical analytics (stub for now)
    res.json({
      message: 'Historical analytics coming soon',
      dailyStats: [],
      weeklyStats: [],
      monthlyStats: []
    });
  });

  // ── POST /v1/completions (legacy) ────────────────────────────────────────────
  // Some older apps use this endpoint
  app.post('/v1/completions', async (req: Request, res: Response) => {
    // Convert to chat format and reuse the same routing logic
    const prompt = req.body.prompt;
    if (typeof prompt !== 'string') {
      res.status(400).json({
        error: { message: 'prompt must be a string', type: 'invalid_request_error' },
      });
      return;
    }

    req.body.messages = [{ role: 'user', content: prompt }];

    // Forward to chat completions
    // Re-run the chat completions handler
    const chatCompletionHandler = async (req: Request, res: Response) => {
      const start = Date.now();
      const body = req.body;

      try {
        const messages = body.messages ?? [];
        const result = await route(messages, {
          forceProvider: body.provider,
          forceModel: body.model,
          maxTokens: body.max_tokens ?? 4096,
          temperature: body.temperature ?? 0.7,
          stream: body.stream ?? false,
        });

        if (!result.success) {
          throw new Error(result.error ?? 'Routing failed');
        }

        // Return in legacy completions format
        const legacyResponse = {
          id: `cmpl-${Date.now()}`,
          object: 'text_completion',
          created: Math.floor(Date.now() / 1000),
          model: result.model,
          choices: [
            {
              text: result.content,
              index: 0,
              logprobs: null,
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
        };

        recordEvent({
          event: 'route_completed',
          provider: result.provider,
          latency_ms: Date.now() - start,
          success: true,
        });

        res.json(legacyResponse);
      } catch (err: any) {
        recordEvent({
          event: 'route_failed',
          provider: 'unknown',
          latency_ms: Date.now() - start,
          success: false,
          error_code: 'routing_error',
        });

        res.status(500).json({
          error: {
            message: err.message ?? 'Routing failed',
            type: 'server_error',
            code: 'routing_error',
          },
        });
      }
    };

    await chatCompletionHandler(req, res);
  });
}

// ── Cloud model pricing (per 1M tokens: input / output) ─────────────────────
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'claude-opus-4-20250514': { input: 15.00, output: 75.00 },
  'gpt-4o': { input: 5.00, output: 15.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'llama-3.1-70b-versatile': { input: 0.59, output: 0.79 },
  'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'grok-3': { input: 3.00, output: 15.00 },
  'grok-3-mini': { input: 0.30, output: 0.50 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0; // local = free
  return ((inputTokens / 1_000_000) * pricing.input) + ((outputTokens / 1_000_000) * pricing.output);
}

// ── Runtime stats (in-memory, resets on restart) ────────────────────────────
interface RequestRecord {
  ts: string;
  provider: string;
  model: string;
  latencyMs: number;
  success: boolean;
  kind: 'local' | 'cloud';
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface ProviderStats {
  count: number;
  totalMs: number;
  errors: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

interface RuntimeStats {
  startedAt: string;
  totalRequests: number;
  successCount: number;
  failCount: number;
  localCount: number;
  cloudCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  byProvider: Record<string, ProviderStats>;
  byModel: Record<string, number>;
  recentRequests: RequestRecord[];
}

const stats: RuntimeStats = {
  startedAt: new Date().toISOString(),
  totalRequests: 0,
  successCount: 0,
  failCount: 0,
  localCount: 0,
  cloudCount: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCostUsd: 0,
  byProvider: {},
  byModel: {},
  recentRequests: [],
};

function recordStat(
  provider: string,
  model: string,
  latencyMs: number,
  success: boolean,
  inputTokens: number = 0,
  outputTokens: number = 0,
): void {
  const config = loadConfig();
  const providerConfig = config.providers.find(p => p.name === provider);
  const kind: 'local' | 'cloud' = providerConfig?.kind === 'cloud' ? 'cloud' : 'local';
  const costUsd = kind === 'cloud' ? estimateCost(model, inputTokens, outputTokens) : 0;

  stats.totalRequests++;
  if (success) stats.successCount++;
  else stats.failCount++;

  if (kind === 'local') stats.localCount++;
  else stats.cloudCount++;

  stats.totalInputTokens += inputTokens;
  stats.totalOutputTokens += outputTokens;
  stats.totalCostUsd += costUsd;

  // Per-provider
  if (!stats.byProvider[provider]) {
    stats.byProvider[provider] = { count: 0, totalMs: 0, errors: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0 };
  }
  const ps = stats.byProvider[provider];
  ps.count++;
  ps.totalMs += latencyMs;
  if (!success) ps.errors++;
  ps.totalInputTokens += inputTokens;
  ps.totalOutputTokens += outputTokens;
  ps.totalCostUsd += costUsd;

  // Per-model
  stats.byModel[model] = (stats.byModel[model] ?? 0) + 1;

  stats.recentRequests.push({ ts: new Date().toISOString(), provider, model, latencyMs, success, kind, inputTokens, outputTokens, costUsd });
  if (stats.recentRequests.length > 200) stats.recentRequests.shift();
}

export function getStats(): RuntimeStats {
  return stats;
}

function getCloudModels(provider: string): string[] {
  const models: Record<string, string[]> = {
    anthropic: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001', 'claude-opus-4-20250514'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    groq: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant'],
    gemini: ['gemini-2.0-flash', 'gemini-1.5-pro'],
    grok: ['grok-3', 'grok-3-mini'],
  };
  return models[provider] ?? [];
}
