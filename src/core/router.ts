/**
 * Core routing engine v2.0
 * Implements Rubik's Cube 5-move dispatch
 */

import { getEnabledProviders, incrementRouteCount, resetCountersIfNeeded, loadConfig, type ModelRecord } from './config.js';
import { createProvider } from '../providers/index.js';
import { shouldAllowRequest, recordSuccess, recordFailure, initCircuit } from './circuit-breaker.js';
import { scanAndCount } from './privacy-counter.js';
import { recordRouteSuccess, recordRouteFailure, recordFallback } from './telemetry.js';
import type { Provider } from '../providers/index.js';
import { classifyComplexityAdaptive } from './adaptive-classifier.js';
import { scoreProviders, recordLatency, type ProviderCandidate } from './optimizer.js';
import { evaluateQuality } from './quality-gate.js';
import { getGlobalCache } from './response-cache.js';
import { scanMessagesForPii } from './semantic-pii.js';
import { getCurrentTier, getTierLimits, stripForbiddenFeatures } from './tier-gate.js';
import { createRoutingTable, type RoutingTable } from './routing-table.js';

// Layer 3 pipeline components
import { getMIScorer } from './mi-scorer.js';
import { scanStructuralPatterns } from './structural-scanner.js';
import { classifyWithLLM } from './llm-classifier.js';
import { assembleVector } from './vector-assembly.js';

// Global routing table instance
let globalRoutingTable: RoutingTable | null = null;

// Daily cloud spend tracker (resets at midnight)
let cloudSpendToday = 0;
let lastSpendResetDate = new Date().toDateString();

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

export interface RouteOptions {
  /** Force a specific provider by name */
  forceProvider?: string;
  /** Force a specific model */
  forceModel?: string;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Temperature (0-1) */
  temperature?: number;
  /** Enable streaming */
  stream?: boolean;
  /** Tool/function definitions */
  tools?: any[];
  /** Tool choice strategy */
  tool_choice?: any;
}

export interface RouteResult {
  /** The response content */
  content: string;
  /** Provider that handled the request */
  provider: string;
  /** Model that was used */
  model: string;
  /** Latency in milliseconds */
  latencyMs: number;
  /** Complexity tier assigned */
  tier: 'simple' | 'medium' | 'complex' | 'expert';
  /** Routing decision reason */
  reason: string;
  /** Whether PII was detected */
  piiDetected: boolean;
  /** Whether request was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Tool calls in response */
  tool_calls?: any[];
  /** Feature 1: Classification method used */
  classificationMethod?: 'llm' | 'keyword' | 'cache';
  /** Feature 2: Provider score from optimizer */
  providerScore?: number;
  /** Feature 3: Quality gate results */
  escalated?: boolean;
  originalTier?: string;
  qualityScore?: number;
  /** Feature 5: Enhanced PII detection */
  piiTypes?: string[];
  piiSeverity?: string;
}

type ComplexityTier = 'simple' | 'medium' | 'complex' | 'expert';

/**
 * Get or initialize the global routing table
 */
function getRoutingTable(): RoutingTable {
  // Use pre-seeded table from serve if available
  if ((globalThis as any).__360routerTable) {
    return (globalThis as any).__360routerTable as RoutingTable;
  }
  if (!globalRoutingTable) {
    const tier = getCurrentTier();
    globalRoutingTable = createRoutingTable(tier);
  }
  return globalRoutingTable;
}

/**
 * Reset daily cloud spend if it's a new day
 */
function resetCloudSpendIfNeeded(): void {
  const today = new Date().toDateString();
  if (lastSpendResetDate !== today) {
    cloudSpendToday = 0;
    lastSpendResetDate = today;
  }
}

/**
 * Record cloud spend for daily budget tracking
 */
function recordCloudSpend(costUsd: number): void {
  resetCloudSpendIfNeeded();
  cloudSpendToday += costUsd;
}

/**
 * Check if daily cloud budget has been exceeded
 */
function isDailyCloudBudgetExceeded(): boolean {
  resetCloudSpendIfNeeded();
  const config = loadConfig();
  const budget = config.dailyCloudBudgetUsd || Infinity;
  return cloudSpendToday >= budget;
}

// (stubs removed — real pipeline components imported above)

/**
 * Classify request complexity based on message content
 */
function classifyComplexity(messages: Message[]): ComplexityTier {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return 'simple';

  const content = lastMessage.content.toLowerCase();
  const wordCount = content.split(/\s+/).length;

  // Expert: code generation, analysis, complex reasoning
  if (
    content.includes('analyze') ||
    content.includes('implement') ||
    content.includes('design') ||
    content.includes('architecture') ||
    content.includes('algorithm') ||
    wordCount > 100
  ) {
    return 'expert';
  }

  // Complex: multi-step reasoning, explanations
  if (
    content.includes('explain') ||
    content.includes('compare') ||
    content.includes('why') ||
    content.includes('how does') ||
    wordCount > 50
  ) {
    return 'complex';
  }

  // Medium: general questions, moderate length
  if (wordCount > 20) {
    return 'medium';
  }

  // Simple: short questions, basic tasks
  return 'simple';
}

/**
 * Select appropriate model based on complexity tier
 */
function selectModelForTier(tier: ComplexityTier, availableModels: string[]): string | undefined {
  const tierPreferences: Record<ComplexityTier, string[]> = {
    simple: ['llama3.2', 'gemma2', 'phi3', 'qwen2'],
    medium: ['llama3.1', 'mistral', 'mixtral', 'gemma2:9b'],
    complex: ['llama3.1:70b', 'mixtral:8x7b', 'qwen2.5:32b'],
    expert: ['llama3.1:405b', 'qwen2.5:72b', 'deepseek-coder']
  };

  const preferences = tierPreferences[tier];

  // Try to find preferred model
  for (const pref of preferences) {
    const match = availableModels.find(m =>
      m.toLowerCase().includes(pref.toLowerCase())
    );
    if (match) return match;
  }

  // Fallback: use first available model
  return availableModels[0];
}

/**
 * Route a request using Rubik's Cube 5-move dispatch (v2.0)
 * Section 7 of spec: Sensitivity lock → Tier filter → Budget gate → Health confirm → Pareto winner
 */
export async function route(
  messages: Message[],
  options: RouteOptions = {},
  _internalEscalation = false
): Promise<RouteResult> {
  const start = Date.now();
  resetCountersIfNeeded();
  incrementRouteCount();

  const config = loadConfig();
  const tier = getCurrentTier();
  const limits = getTierLimits(tier);

  // Strip forbidden features based on tier
  options = stripForbiddenFeatures(options);

  // If free tier requested streaming, convert to non-streaming
  if (tier === 'free' && options.stream) {
    options.stream = false;
  }

  // ── Cache check (tier-sized) ─────────────────────────────────────────────
  if (config.cacheEnabled !== false && !options.stream && !options.tools && !_internalEscalation) {
    const cache = getGlobalCache(
      limits.cacheMaxSize,
      limits.cacheTtlSeconds * 1000
    );
    const cached = cache.get(messages, options.forceModel);
    if (cached) {
      return {
        ...cached,
        latencyMs: Date.now() - start,
        reason: 'cache_hit',
        success: true
      } as RouteResult;
    }
  }

  // ── Layer 3 Pipeline ─────────────────────────────────────────────────────
  const lastUserMsg = messages.findLast(m => m.role === 'user')?.content || '';
  const currentTier = getCurrentTier();

  // 1. MI Scorer → domainScores, sensitivityFlag
  const miScorer = getMIScorer(currentTier);
  const pmiResult = miScorer.score(lastUserMsg);
  const sensitivityFlag = pmiResult.sensitivityFlag;

  // 2. Structural Scanner → urgency signals
  const structuralResult = scanStructuralPatterns(lastUserMsg);

  // 3. LLM Classifier → intent/depth/output/urgency/context JSON
  const localProviders = getEnabledProviders().filter(p => p.kind === 'local');
  const localEndpoint = localProviders[0]?.baseUrl || 'http://localhost:11434';
  let classifierResult;
  try {
    classifierResult = await classifyWithLLM(lastUserMsg, currentTier, localEndpoint);
  } catch {
    classifierResult = {
      intent: 'explain' as const, depth: 'standard' as const,
      output_type: 'answer' as const, urgency: 'medium' as const,
      context_load: 'medium' as const, parseMethod: 'keyword' as const
    };
  }

  // 4. Vector Assembly → V, tier_score, tier_index
  const vectorResult = assembleVector(classifierResult, pmiResult, structuralResult);
  const { V, tier_score, tier_index, tier_name } = vectorResult;

  // ── RUBIK'S CUBE DISPATCH (5 moves) ──────────────────────────────────────
  const routingTable = getRoutingTable();
  routingTable.updateCooldowns();  // Clear expired cooldowns

  // MOVE 1: Sensitivity lock
  let eliminateCloud = false;
  if (sensitivityFlag === 1) {
    if (tier === 'free') {
      console.warn('[360router] Potentially sensitive data detected. Consider upgrading to Pro for automatic scrubbing.');
    } else {
      eliminateCloud = true;
    }
  }

  // MOVE 2: Tier filter — fall back to all models if tier score returns nothing
  let candidates = routingTable.getByTierScore(tier_score);
  if (candidates.length === 0) {
    candidates = routingTable.getAll();
  }

  // If routing table is still empty, fall back to direct provider routing
  if (candidates.length === 0) {
    const providerConfigs = getEnabledProviders();
    const localProviders2 = providerConfigs.filter(p => p.kind === 'local');
    const cloudProviders2 = providerConfigs.filter(p => p.kind === 'cloud');
    const allProviders2   = [...localProviders2, ...cloudProviders2];

    for (const providerConfig of allProviders2) {
      try {
        const provider = createProvider(providerConfig);
        const result   = await provider.route(messages, {
          model:       options.forceModel,
          tools:       options.tools,
          tool_choice: options.tool_choice,
          maxTokens:   options.maxTokens,
          temperature: options.temperature
        });
        return {
          content:    result.content,
          provider:   providerConfig.name,
          model:      result.model ?? 'unknown',
          latencyMs:  Date.now() - start,
          tier:       tier_name as ComplexityTier,
          reason:     'direct-fallback (routing table empty)',
          piiDetected: sensitivityFlag === 1,
          success:    true,
          tool_calls: result.tool_calls,
        };
      } catch { continue; }
    }

    return {
      content: '', provider: 'none', model: 'none',
      latencyMs: Date.now() - start, tier: tier_name as ComplexityTier,
      reason: 'No models available after filtering', piiDetected: sensitivityFlag === 1,
      success: false, error: 'No models available after filtering. Check routing table and health status.',
      classificationMethod: 'llm'
    };
  }

  // MOVE 3: Budget gate
  if (isDailyCloudBudgetExceeded()) {
    eliminateCloud = true;
  }

  // Apply cloud elimination from Move 1 or Move 3
  if (eliminateCloud) {
    candidates = candidates.filter(m => m.provider === 'local');
  }

  // MOVE 4: Health confirm
  candidates = candidates.filter(m => m.status === 'alive');

  // MOVE 5: Pareto winner
  // Score: (quality^0.4) × (1/cost)^0.3 × (1/latency)^0.3
  const output_type = classifierResult.output_type;

  // Filter by capabilities if output_type=code
  if (output_type === 'code') {
    candidates = candidates.filter(m => m.capabilities.includes('code'));
  }

  // Calculate Pareto scores
  type ScoredCandidate = ModelRecord & { paretoScore: number };
  const scoredCandidates: ScoredCandidate[] = candidates.map(c => {
    const quality = tier_score;  // Use tier_score as quality proxy
    const cost = c.cost_per_1k;
    const latency = c.latency_avg;

    const paretoScore = Math.pow(quality, 0.4) * Math.pow(1 / cost, 0.3) * Math.pow(1 / latency, 0.3);

    return { ...c, paretoScore };
  });

  // Sort by score descending
  scoredCandidates.sort((a, b) => b.paretoScore - a.paretoScore);

  const winner = scoredCandidates[0];
  const fallback = scoredCandidates[1];
  const lastResort = scoredCandidates[2];

  if (!winner) {
    return {
      content: '',
      provider: 'none',
      model: 'none',
      latencyMs: Date.now() - start,
      tier: tier_name as ComplexityTier,
      reason: 'No models available after filtering',
      piiDetected: sensitivityFlag === 1,
      success: false,
      error: 'No models available after filtering. Check routing table and health status.',
      classificationMethod: 'llm'
    };
  }

  // ── Dispatch to winner, fallback, last resort ────────────────────────────
  const modelsToTry = [winner, fallback, lastResort].filter(Boolean);

  let lastError: string = 'Unknown error';
  let attemptedProvider: string | undefined;
  let providerScore: number | undefined;

  for (const modelCandidate of modelsToTry) {
    attemptedProvider = modelCandidate.provider;
    providerScore = modelCandidate.paretoScore;

    // Find provider config
    const providerConfigs = getEnabledProviders();
    const providerConfig = providerConfigs.find(
      p => p.name === modelCandidate.provider || p.kind === modelCandidate.provider
    );

    if (!providerConfig) continue;

    try {
      // Create provider instance
      const provider = createProvider(providerConfig);

      // Route request
      const providerStart = Date.now();
      const result = await provider.route(messages, {
        model: options.forceModel || modelCandidate.name,
        tools: options.tools,
        tool_choice: options.tool_choice,
        maxTokens: options.maxTokens,
        temperature: options.temperature
      });
      const providerLatency = Date.now() - providerStart;

      // Record success and latency
      routingTable.markSuccess(modelCandidate.name);
      routingTable.recordLatency(modelCandidate.name, providerLatency);
      recordSuccess(providerConfig.name);
      recordRouteSuccess(providerConfig.name, providerLatency);

      // Record cloud spend if cloud provider
      if (providerConfig.kind === 'cloud') {
        const estimatedTokens = result.content.length / 4;  // rough estimate
        const costUsd = (estimatedTokens / 1000) * modelCandidate.cost_per_1k;
        recordCloudSpend(costUsd);
      }

      // ── Quality Gate (tier-gated behavior) ───────────────────────────────
      let qualityScore: number | undefined;
      let escalated = false;
      let finalContent = result.content;
      let finalModel = result.model;
      let finalProvider = providerConfig.name;

      if (
        config.qualityGateEnabled !== false &&
        !options.tools &&
        !_internalEscalation
      ) {
        const lastMessage = messages[messages.length - 1];
        const input = lastMessage?.content || '';
        const threshold = config.qualityGateThreshold || 0.4;

        const qualityResult = evaluateQuality(input, result.content, tier_name as ComplexityTier, providerLatency, threshold);
        qualityScore = qualityResult.score;

        // Free tier: evaluate and log only, don't escalate
        // Pro tier: evaluate and escalate if needed
        if (tier === 'pro' && limits.qualityGateAutoEscalate && qualityResult.shouldEscalate && qualityResult.suggestedTier) {
          // Re-route with higher tier
          const escalatedResult = await route(
            messages,
            { ...options, forceModel: undefined },
            true // Mark as internal escalation to prevent infinite loop
          );

          if (escalatedResult.success) {
            escalated = true;
            finalContent = escalatedResult.content;
            finalModel = escalatedResult.model;
            finalProvider = escalatedResult.provider;
          }
        }
      }

      // ── MI Output Validator (Pro only) ────────────────────────────────────
      // TODO(v2.0): Agent 1 implements this
      // if (tier === 'pro' && limits.miOutputValidator) {
      //   const miScore = validateMIOutput(finalContent, pmiResult.domainScores);
      //   if (miScore < 0.3) {
      //     console.warn('[360router] MI output validator: score < 0.3, low domain alignment');
      //   }
      // }

      const routeResult: RouteResult = {
        content: finalContent,
        provider: finalProvider,
        model: finalModel,
        latencyMs: Date.now() - start,
        tier: tier_name as ComplexityTier,
        reason: escalated
          ? `Escalated from ${tier_name} (quality gate)`
          : `Pareto winner: ${modelCandidate.name} (score: ${providerScore?.toFixed(2) || 'N/A'})`,
        piiDetected: sensitivityFlag === 1,
        success: true,
        tool_calls: result.tool_calls,
        classificationMethod: 'llm',
        providerScore,
        escalated,
        originalTier: escalated ? tier_name : undefined,
        qualityScore
      };

      // ── Cache successful non-streaming responses (tier-sized) ─────────────
      if (config.cacheEnabled !== false && !options.stream && !options.tools) {
        const cache = getGlobalCache(
          limits.cacheMaxSize,
          limits.cacheTtlSeconds * 1000
        );
        cache.set(messages, {
          content: finalContent,
          provider: finalProvider,
          model: finalModel,
          tier: tier_name as ComplexityTier,
          piiDetected: sensitivityFlag === 1,
          tool_calls: result.tool_calls,
          timestamp: Date.now()
        }, options.forceModel);
      }

      return routeResult;
    } catch (error: any) {
      lastError = error.message || 'Unknown error';
      routingTable.markFailure(modelCandidate.name);
      recordFailure(providerConfig.name);
      recordRouteFailure(providerConfig.name, lastError);

      // Try next model (fallback, last resort)
      continue;
    }
  }

  // All models failed
  return {
    content: '',
    provider: 'none',
    model: 'none',
    latencyMs: Date.now() - start,
    tier: tier_name as ComplexityTier,
    reason: 'All models failed',
    piiDetected: sensitivityFlag === 1,
    success: false,
    error: lastError,
    classificationMethod: 'llm'
  };
}

/**
 * Route a streaming request to the best available provider
 */
export async function* routeStream(
  messages: Message[],
  options: RouteOptions = {}
): AsyncGenerator<string> {
  const providerConfigs = getEnabledProviders();
  if (providerConfigs.length === 0) {
    throw new Error('No providers configured. Run `360router init` first.');
  }

  const localProviders = providerConfigs.filter(p => p.kind === 'local');
  const cloudProviders = providerConfigs.filter(p => p.kind === 'cloud');
  const allProviders = [...localProviders, ...cloudProviders];

  let providersToTry = allProviders;
  if (options.forceProvider) {
    providersToTry = allProviders.filter(p => p.name === options.forceProvider);
  }

  for (const config of providersToTry) {
    initCircuit(config.name);
    if (!shouldAllowRequest(config.name)) {
      continue;
    }

    try {
      const provider = createProvider(config);
      if (!provider.routeStream) {
        continue; // Provider doesn't support streaming
      }

      for await (const chunk of provider.routeStream(messages, {
        model: options.forceModel,
        tools: options.tools,
        tool_choice: options.tool_choice,
        maxTokens: options.maxTokens,
        temperature: options.temperature
      })) {
        yield chunk;
      }

      recordSuccess(config.name);
      return; // Success, exit
    } catch (error: any) {
      recordFailure(config.name);
      // Try next provider
      continue;
    }
  }

  throw new Error('All providers failed or do not support streaming');
}

/**
 * Route an embedding request to the best available provider
 */
export async function routeEmbedding(
  input: string | string[],
  model?: string
): Promise<{
  embeddings: number[][];
  model: string;
  provider: string;
}> {
  const providerConfigs = getEnabledProviders();
  if (providerConfigs.length === 0) {
    throw new Error('No providers configured. Run `360router init` first.');
  }

  // Try local providers first
  const localProviders = providerConfigs.filter(p => p.kind === 'local');
  const cloudProviders = providerConfigs.filter(p => p.kind === 'cloud');
  const allProviders = [...localProviders, ...cloudProviders];

  let lastError = 'No providers support embeddings';

  for (const config of allProviders) {
    initCircuit(config.name);
    if (!shouldAllowRequest(config.name)) {
      continue;
    }

    try {
      const provider = createProvider(config);
      if (!provider.embed) {
        continue; // Provider doesn't support embeddings
      }

      const result = await provider.embed(input, model);
      recordSuccess(config.name);

      return {
        embeddings: result.embeddings,
        model: result.model,
        provider: config.name
      };
    } catch (error: any) {
      lastError = error.message;
      recordFailure(config.name);
      continue;
    }
  }

  throw new Error(lastError);
}

/**
 * Health check all configured providers
 */
export async function healthCheckAll(): Promise<
  Array<{
    name: string;
    kind: 'local' | 'cloud';
    online: boolean;
    latencyMs: number;
    modelCount: number;
    error?: string;
  }>
> {
  const providers = getEnabledProviders();
  const results = [];

  for (const config of providers) {
    const start = Date.now();
    try {
      const provider = createProvider(config);
      const healthy = await provider.health();
      const models = await provider.listModels();

      results.push({
        name: config.name,
        kind: config.kind,
        online: healthy,
        latencyMs: Date.now() - start,
        modelCount: models.length,
      });
    } catch (error: any) {
      results.push({
        name: config.name,
        kind: config.kind,
        online: false,
        latencyMs: Date.now() - start,
        modelCount: 0,
        error: error.message
      });
    }
  }

  return results;
}
