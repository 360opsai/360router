/**
 * Cost-Latency-Quality Optimizer
 * Pareto-optimal provider selection.
 * Scores each candidate: score = (quality^qW) * (1/cost)^cW * (1/latency)^lW
 * where qW, cW, lW are user-tunable weights (default: balanced)
 */

type ComplexityTier = 'simple' | 'medium' | 'complex' | 'expert';

export interface ProviderCandidate {
  name: string;
  kind: 'local' | 'cloud';
  bestModel?: string;
  baseUrl?: string;
}

export interface ProviderScore {
  provider: string;
  model: string;
  score: number;
  quality: number;   // 0-1 based on tier match
  costPer1k: number; // $/1K tokens
  avgLatencyMs: number;
}

export interface OptimizerWeights {
  quality: number;
  cost: number;
  latency: number;
}

// Cloud model pricing (per 1M tokens: input / output)
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

// Model tier mapping (what tier each model is best for)
const MODEL_TIER_MAP: Record<string, ComplexityTier> = {
  // Claude models
  'claude-haiku-4-5-20251001': 'simple',
  'claude-sonnet-4-20250514': 'complex',
  'claude-opus-4-20250514': 'expert',
  // OpenAI models
  'gpt-4o-mini': 'simple',
  'gpt-4.1': 'medium',
  'gpt-4o': 'complex',
  'gpt-4-turbo': 'expert',
  // Groq models
  'llama-3.1-8b-instant': 'simple',
  'llama-3.1-70b-versatile': 'complex',
  // Gemini models
  'gemini-2.0-flash': 'medium',
  'gemini-1.5-pro': 'complex',
  // Grok models
  'grok-3-mini': 'medium',
  'grok-3': 'expert',
};

// Model name patterns for local models
const LOCAL_MODEL_TIERS: Array<{ pattern: RegExp; tier: ComplexityTier }> = [
  { pattern: /llama3\.2|gemma2:2b|phi3|qwen2:1\.5b|tinyllama/i, tier: 'simple' },
  { pattern: /llama3\.1:8b|mistral:7b|gemma2:9b|qwen2:7b/i, tier: 'medium' },
  { pattern: /llama3\.1:70b|mixtral:8x7b|qwen2\.5:32b/i, tier: 'complex' },
  { pattern: /llama3\.1:405b|qwen2\.5:72b|deepseek-coder/i, tier: 'expert' },
];

// Latency tracker (simple rolling average)
interface LatencyStats {
  totalMs: number;
  count: number;
}

const latencyTracker = new Map<string, LatencyStats>();

/**
 * Record latency for a provider
 */
export function recordLatency(provider: string, latencyMs: number): void {
  const stats = latencyTracker.get(provider) || { totalMs: 0, count: 0 };
  stats.totalMs += latencyMs;
  stats.count += 1;
  latencyTracker.set(provider, stats);
}

/**
 * Get average latency for a provider (defaults to 1000ms if no data)
 */
export function getAvgLatency(provider: string): number {
  const stats = latencyTracker.get(provider);
  if (!stats || stats.count === 0) {
    // Default estimates
    if (provider === 'local' || provider.includes('ollama')) return 500;
    return 1000; // Cloud default
  }
  return stats.totalMs / stats.count;
}

/**
 * Estimate cost per 1K tokens for a model (average of input/output)
 */
function getCostPer1k(model: string): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0; // Local models are free
  // Average of input and output pricing per 1M tokens, converted to per 1K
  return ((pricing.input + pricing.output) / 2) / 1000;
}

/**
 * Determine the tier a model is best suited for
 */
function getModelTier(model: string, kind: 'local' | 'cloud'): ComplexityTier {
  if (kind === 'cloud') {
    return MODEL_TIER_MAP[model] || 'medium';
  }

  // Local model: match by pattern
  for (const { pattern, tier } of LOCAL_MODEL_TIERS) {
    if (pattern.test(model)) return tier;
  }

  return 'medium'; // Default
}

/**
 * Calculate quality score based on tier match
 * 1.0 if model tier matches request tier
 * 0.7 if one tier off
 * 0.3 if two tiers off
 */
function calculateQualityScore(requestTier: ComplexityTier, modelTier: ComplexityTier): number {
  const tierOrder: ComplexityTier[] = ['simple', 'medium', 'complex', 'expert'];
  const requestIdx = tierOrder.indexOf(requestTier);
  const modelIdx = tierOrder.indexOf(modelTier);

  const distance = Math.abs(requestIdx - modelIdx);

  if (distance === 0) return 1.0;
  if (distance === 1) return 0.7;
  if (distance === 2) return 0.4;
  return 0.2;
}

/**
 * Score providers using Pareto-optimal selection
 */
export function scoreProviders(
  tier: ComplexityTier,
  candidates: ProviderCandidate[],
  weights: OptimizerWeights = { quality: 0.4, cost: 0.3, latency: 0.3 }
): ProviderScore[] {
  const scores: ProviderScore[] = [];

  for (const candidate of candidates) {
    // Determine best model for this provider
    const model = candidate.bestModel || 'unknown';
    const modelTier = getModelTier(model, candidate.kind);

    // Calculate metrics
    const quality = calculateQualityScore(tier, modelTier);
    const costPer1k = getCostPer1k(model);
    const avgLatencyMs = getAvgLatency(candidate.name);

    // Pareto scoring: higher is better
    // score = (quality^qW) * (1/cost)^cW * (1/latency)^lW
    // Add 1 to denominators to avoid division by zero
    const costScore = 1 / (costPer1k + 0.01); // Small offset for free models
    const latencyScore = 1 / (avgLatencyMs + 1);

    const score =
      Math.pow(quality, weights.quality) *
      Math.pow(costScore, weights.cost) *
      Math.pow(latencyScore, weights.latency);

    scores.push({
      provider: candidate.name,
      model,
      score,
      quality,
      costPer1k,
      avgLatencyMs
    });
  }

  // Sort by score descending (highest score = best choice)
  return scores.sort((a, b) => b.score - a.score);
}

/**
 * Get model pricing for external use
 */
export function getModelPricing(): Record<string, { input: number; output: number }> {
  return MODEL_PRICING;
}

/**
 * Clear latency tracking data
 */
export function clearLatencyData(): void {
  latencyTracker.clear();
}
