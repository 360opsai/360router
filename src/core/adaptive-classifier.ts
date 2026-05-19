/**
 * Adaptive complexity classifier using LLM
 * Uses the cheapest available local model to classify request complexity
 * in ~100-200ms. Falls back to keyword heuristic if no local model available.
 */

import { createHash } from 'crypto';

type ComplexityTier = 'simple' | 'medium' | 'complex' | 'expert';

// Classification prompt (kept minimal for speed)
const CLASSIFY_PROMPT = `Rate this request's complexity as exactly one word: simple, medium, complex, or expert.
Request: "{INPUT}"
Complexity:`;

// LRU cache for classification results
interface CacheEntry {
  tier: ComplexityTier;
  timestamp: number;
}

class ClassificationCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize = 1000;
  private ttl = 300000; // 5 minutes

  private hash(input: string): string {
    return createHash('sha256').update(input).digest('hex').substring(0, 16);
  }

  get(input: string): ComplexityTier | null {
    const key = this.hash(input);
    const entry = this.cache.get(key);

    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.tier;
  }

  set(input: string, tier: ComplexityTier): void {
    const key = this.hash(input);

    // LRU eviction: if at capacity, remove oldest entry
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.cache.set(key, { tier, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

const cache = new ClassificationCache();

// Cache the smallest model discovery — avoid re-fetching model list on every request
let _cachedSmallestModel: string | null = null;
let _cachedSmallestModelEndpoint: string | null = null;
let _cachedSmallestModelTs = 0;
const MODEL_CACHE_TTL = 60000; // 1 minute

/**
 * Find the smallest/fastest local model for classification (cached)
 */
async function findSmallestModel(localEndpoint: string): Promise<string | null> {
  // Return cached model if fresh
  if (
    _cachedSmallestModel &&
    _cachedSmallestModelEndpoint === localEndpoint &&
    Date.now() - _cachedSmallestModelTs < MODEL_CACHE_TTL
  ) {
    return _cachedSmallestModel;
  }

  let found: string | null = null;

  try {
    const ollamaResponse = await fetch(`${localEndpoint}/api/tags`, {
      signal: AbortSignal.timeout(1500)
    });

    if (ollamaResponse.ok) {
      const data = await ollamaResponse.json();
      const models = (data.models || []).map((m: any) => m.name);

      const smallPatterns = ['mini', 'small', '1b', '3b', '2b', 'tiny'];
      for (const pattern of smallPatterns) {
        const match = models.find((m: string) => m.toLowerCase().includes(pattern));
        if (match) { found = match; break; }
      }

      if (!found) found = models[0] || null;
    }
  } catch {
    // Fall through
  }

  if (!found) {
    try {
      const response = await fetch(`${localEndpoint}/v1/models`, {
        signal: AbortSignal.timeout(1500)
      });

      if (response.ok) {
        const data = await response.json();
        const models = (data.data || []).map((m: any) => m.id);

        const smallPatterns = ['mini', 'small', '1b', '3b', '2b', 'tiny'];
        for (const pattern of smallPatterns) {
          const match = models.find((m: string) => m.toLowerCase().includes(pattern));
          if (match) { found = match; break; }
        }

        if (!found) found = models[0] || null;
      }
    } catch {
      // No models available
    }
  }

  // Cache result
  _cachedSmallestModel = found;
  _cachedSmallestModelEndpoint = localEndpoint;
  _cachedSmallestModelTs = Date.now();

  return found;
}

/**
 * Classify complexity using LLM
 */
async function classifyWithLLM(
  input: string,
  localEndpoint: string
): Promise<ComplexityTier | null> {
  try {
    // Find smallest model
    const model = await findSmallestModel(localEndpoint);
    if (!model) return null;

    // Build prompt
    const prompt = CLASSIFY_PROMPT.replace('{INPUT}', input.substring(0, 500)); // Truncate long inputs

    // Call local model
    const response = await fetch(`${localEndpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 5,
        temperature: 0,
        stream: false
      }),
      signal: AbortSignal.timeout(500)
    });

    if (!response.ok) return null;

    const data = await response.json();
    const content = (data.choices?.[0]?.message?.content || '').toLowerCase().trim();

    // Parse response: extract first word that matches our tiers
    const words = content.split(/\s+/);
    for (const word of words) {
      const cleaned = word.replace(/[^a-z]/g, '');
      if (cleaned === 'simple' || cleaned === 'medium' || cleaned === 'complex' || cleaned === 'expert') {
        return cleaned as ComplexityTier;
      }
    }

    return null;
  } catch {
    // Timeout or error
    return null;
  }
}

/**
 * Keyword-based fallback classifier (original logic)
 */
function classifyWithKeywords(input: string): ComplexityTier {
  const content = input.toLowerCase();
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
 * Main adaptive classifier function
 * Tries LLM first, falls back to keywords if unavailable or timeout
 */
export async function classifyComplexityAdaptive(
  input: string,
  options: {
    useAdaptive?: boolean;
    localEndpoint?: string;
  } = {}
): Promise<{
  tier: ComplexityTier;
  method: 'llm' | 'keyword' | 'cache';
}> {
  const { useAdaptive = true, localEndpoint = 'http://localhost:11434' } = options;

  // Check cache first
  const cached = cache.get(input);
  if (cached) {
    return { tier: cached, method: 'cache' };
  }

  // If adaptive disabled, use keyword
  if (!useAdaptive) {
    const tier = classifyWithKeywords(input);
    cache.set(input, tier);
    return { tier, method: 'keyword' };
  }

  // Try LLM classification
  const llmTier = await classifyWithLLM(input, localEndpoint);
  if (llmTier) {
    cache.set(input, llmTier);
    return { tier: llmTier, method: 'llm' };
  }

  // Fallback to keyword
  const tier = classifyWithKeywords(input);
  cache.set(input, tier);
  return { tier, method: 'keyword' };
}

/**
 * Clear the classification cache
 */
export function clearClassificationCache(): void {
  cache.clear();
}
