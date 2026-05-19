/**
 * Component 4: LLM Classifier
 *
 * Classifies requests using WHATEVER provider the user has configured.
 * No Ollama dependency. No specific model required.
 *
 * Priority order:
 *   1. Local provider (free, fast) — smallest model available
 *   2. Cloud provider (cheap) — Groq > Gemini > OpenAI > Anthropic
 *   3. Keyword fallback (zero-cost, less accurate)
 *
 * The classifier NEVER blocks routing. If all providers fail,
 * keyword heuristic runs instantly and routing continues.
 */

import { getEnabledProviders } from './config.js';
import type { ProviderConfig } from './config.js';

// Lazy engine check — avoid loading engine module at CLI startup
function getEngineState(): { running: boolean; url: string } {
  try {
    // @ts-ignore — dynamic require for CJS compatibility
    const mod = require('../engine/manager.js');
    return { running: mod.isEngineRunning?.() || false, url: mod.getEngineUrl?.() || '' };
  } catch {
    return { running: false, url: '' };
  }
}

// LOCKED SYSTEM PROMPT - DO NOT MODIFY WITHOUT ios + Claude REVIEW
const SYSTEM_PROMPT = `You are a routing signal extractor. Read the user input. Output ONLY this JSON. No explanation. No preamble. No markdown.
{
  "intent": "resolve|create|explain|decide|retrieve|execute",
  "depth": "fast|standard|strong|expert",
  "output_type": "answer|steps|code|analysis|summary|creative",
  "urgency": "none|low|medium|high|critical",
  "context_load": "low|medium|high"
}`;

const LLM_TIMEOUT = 800; // ms — generous enough for cloud, tight enough to not block

export interface LLMClassificationResult {
  intent: 'resolve' | 'create' | 'explain' | 'decide' | 'retrieve' | 'execute';
  depth: 'fast' | 'standard' | 'strong' | 'expert';
  output_type: 'answer' | 'steps' | 'code' | 'analysis' | 'summary' | 'creative';
  urgency: 'none' | 'low' | 'medium' | 'high' | 'critical';
  context_load: 'low' | 'medium' | 'high';
  parseMethod: 'llm' | 'keyword';
  classifierProvider?: string; // which provider handled classification
}

/**
 * Keyword-based fallback classifier (v1.0.4 heuristic)
 * Used when no LLM is available or all providers fail
 */
function keywordFallback(text: string): LLMClassificationResult {
  const lower = text.toLowerCase();
  const wordCount = lower.split(/\s+/).length;

  let intent: LLMClassificationResult['intent'] = 'explain';
  if (/\b(fix|solve|resolve|repair|help me)\b/.test(lower)) intent = 'resolve';
  else if (/\b(create|build|make|generate|write|draft)\b/.test(lower)) intent = 'create';
  else if (/\b(decide|choose|compare|which|should i)\b/.test(lower)) intent = 'decide';
  else if (/\b(find|search|look up|get|fetch|show)\b/.test(lower)) intent = 'retrieve';
  else if (/\b(run|execute|deploy|start|launch|install)\b/.test(lower)) intent = 'execute';

  let depth: LLMClassificationResult['depth'] = 'standard';
  if (wordCount > 100 || /\b(analyze|architect|design|implement|algorithm)\b/.test(lower)) depth = 'expert';
  else if (wordCount > 50 || /\b(explain|compare|why|how does)\b/.test(lower)) depth = 'strong';
  else if (wordCount < 10) depth = 'fast';

  let output_type: LLMClassificationResult['output_type'] = 'answer';
  if (/\b(step|steps|how to|guide|tutorial|instructions)\b/.test(lower)) output_type = 'steps';
  else if (/\b(code|function|script|program|class|api)\b/.test(lower)) output_type = 'code';
  else if (/\b(analyze|analysis|evaluate|assess|review)\b/.test(lower)) output_type = 'analysis';
  else if (/\b(summarize|summary|tldr|brief|overview)\b/.test(lower)) output_type = 'summary';
  else if (/\b(creative|story|poem|idea|brainstorm)\b/.test(lower)) output_type = 'creative';

  let urgency: LLMClassificationResult['urgency'] = 'none';
  if (/\b(critical|emergency|asap|urgent|immediately)\b/.test(lower)) urgency = 'critical';
  else if (/\b(soon|quickly|deadline|today)\b/.test(lower)) urgency = 'medium';

  let context_load: LLMClassificationResult['context_load'] = 'low';
  if (text.length > 1000) context_load = 'high';
  else if (text.length > 300) context_load = 'medium';

  return { intent, depth, output_type, urgency, context_load, parseMethod: 'keyword' };
}

/**
 * Call any OpenAI-compatible endpoint for classification
 */
async function callOpenAICompat(
  text: string,
  baseUrl: string,
  model: string,
  apiKey?: string,
): Promise<LLMClassificationResult | null> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text.slice(0, 500) }, // truncate for speed
        ],
        max_tokens: 100,
        temperature: 0,
        stream: false,
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT),
    });

    if (!response.ok) return null;
    const data = await response.json() as any;
    return parseClassification(data.choices?.[0]?.message?.content || '');
  } catch {
    return null;
  }
}

/**
 * Call Ollama native API for classification
 */
async function callOllama(
  text: string,
  baseUrl: string,
  model: string,
): Promise<LLMClassificationResult | null> {
  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text.slice(0, 500) },
        ],
        stream: false,
        options: { temperature: 0, num_predict: 100 },
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT),
    });

    if (!response.ok) return null;
    const data = await response.json() as any;
    return parseClassification(data.message?.content || '');
  } catch {
    return null;
  }
}

/**
 * Parse classification JSON from LLM response
 */
function parseClassification(content: string): LLMClassificationResult | null {
  try {
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```(?:json)?\n?/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr);

    if (!parsed.intent || !parsed.depth || !parsed.output_type || !parsed.urgency || !parsed.context_load) {
      return null;
    }

    return {
      intent: parsed.intent,
      depth: parsed.depth,
      output_type: parsed.output_type,
      urgency: parsed.urgency,
      context_load: parsed.context_load,
      parseMethod: 'llm',
    };
  } catch {
    return null;
  }
}

/**
 * Pick the cheapest/fastest provider for classification
 * Priority: local (free) > groq (fast+free) > gemini (cheap) > openai > anthropic
 */
const CLOUD_PRIORITY: Record<string, number> = {
  groq: 1,     // free tier, fastest cloud
  gemini: 2,   // cheap
  grok: 3,     // cheap
  openai: 4,   // moderate
  anthropic: 5, // most expensive
};

const CLOUD_CLASSIFIER_MODELS: Record<string, string> = {
  groq: 'llama-3.1-8b-instant',
  gemini: 'gemini-2.0-flash',
  grok: 'grok-3-mini',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
};

function pickClassifierProvider(providers: ProviderConfig[]): {
  provider: ProviderConfig;
  model: string;
  method: 'ollama' | 'openai-compat';
} | null {
  // 0. Built-in engine (highest priority — free, no network, always available)
  const engine = getEngineState();
  if (engine.running) {
    return {
      provider: { name: 'engine', kind: 'local', enabled: true, baseUrl: engine.url, label: 'Built-in Engine' },
      model: 'llama-3.2-1b',
      method: 'openai-compat',
    };
  }

  // 1. Try local providers (free)
  const locals = providers.filter(p => p.kind === 'local' && p.enabled && p.baseUrl);
  if (locals.length > 0) {
    return {
      provider: locals[0],
      model: '', // use whatever model is available
      method: 'ollama', // try Ollama API first, fall back to OpenAI-compat
    };
  }

  // 2. Try cloud providers in cost order
  const clouds = providers
    .filter(p => p.kind === 'cloud' && p.enabled && p.apiKey)
    .sort((a, b) => (CLOUD_PRIORITY[a.name] ?? 99) - (CLOUD_PRIORITY[b.name] ?? 99));

  if (clouds.length > 0) {
    const picked = clouds[0];
    return {
      provider: picked,
      model: CLOUD_CLASSIFIER_MODELS[picked.name] || '',
      method: 'openai-compat',
    };
  }

  return null; // no providers available → keyword fallback
}

/**
 * Find smallest model on a local endpoint
 */
async function findSmallestLocalModel(baseUrl: string): Promise<string | null> {
  // Try Ollama
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json() as any;
      const models = (data.models || []).map((m: any) => m.name) as string[];
      const small = ['1b', '2b', '3b', 'mini', 'small', 'tiny'];
      for (const pattern of small) {
        const match = models.find(m => m.toLowerCase().includes(pattern));
        if (match) return match;
      }
      return models[0] || null;
    }
  } catch { /* not Ollama */ }

  // Try OpenAI-compat /v1/models
  try {
    const res = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json() as any;
      const models = (data.data || []).map((m: any) => m.id) as string[];
      const small = ['1b', '2b', '3b', 'mini', 'small', 'tiny'];
      for (const pattern of small) {
        const match = models.find(m => m.toLowerCase().includes(pattern));
        if (match) return match;
      }
      return models[0] || null;
    }
  } catch { /* nothing */ }

  return null;
}

// Cache the picked provider to avoid re-scanning every request
let _cachedPick: { provider: string; model: string; method: string; baseUrl: string; apiKey?: string } | null = null;
let _cacheTs = 0;
const CACHE_TTL = 60000; // 1 minute

/**
 * Classify text using the best available provider
 *
 * Tries: local → cheapest cloud → keyword fallback
 * NEVER blocks. NEVER fails. Always returns a result.
 */
export async function classifyWithLLM(
  text: string,
  tier: 'free' | 'pro' = 'free',
  endpoint?: string, // ignored — we auto-detect from config
  userModel?: string,
): Promise<LLMClassificationResult> {

  // Use cached pick if fresh
  if (_cachedPick && Date.now() - _cacheTs < CACHE_TTL) {
    let result: LLMClassificationResult | null = null;

    if (_cachedPick.method === 'ollama') {
      result = await callOllama(text, _cachedPick.baseUrl, _cachedPick.model);
      if (!result) result = await callOpenAICompat(text, _cachedPick.baseUrl, _cachedPick.model, _cachedPick.apiKey);
    } else {
      result = await callOpenAICompat(text, _cachedPick.baseUrl, _cachedPick.model, _cachedPick.apiKey);
    }

    if (result) {
      result.classifierProvider = _cachedPick.provider;
      return result;
    }
    // Cache miss — provider died, re-scan
    _cachedPick = null;
  }

  // Scan configured providers
  const providers = getEnabledProviders();
  const pick = pickClassifierProvider(providers);

  if (!pick) {
    // No providers at all → keyword fallback
    return keywordFallback(text);
  }

  // Resolve model for local providers
  let model = userModel || pick.model;
  let baseUrl = pick.provider.baseUrl || '';

  if (pick.method === 'ollama' && !model) {
    model = await findSmallestLocalModel(baseUrl) || '';
    if (!model) {
      return keywordFallback(text); // local provider has no models
    }
  }

  // For cloud providers, construct the base URL
  if (pick.provider.kind === 'cloud') {
    const cloudUrls: Record<string, string> = {
      groq: 'https://api.groq.com/openai',
      openai: 'https://api.openai.com',
      gemini: 'https://generativelanguage.googleapis.com',
      grok: 'https://api.x.ai',
      anthropic: 'https://api.anthropic.com',
    };
    baseUrl = cloudUrls[pick.provider.name] || '';
  }

  // Cache for next request
  _cachedPick = {
    provider: pick.provider.label || pick.provider.name,
    model,
    method: pick.method,
    baseUrl,
    apiKey: pick.provider.apiKey,
  };
  _cacheTs = Date.now();

  // Try classification
  let result: LLMClassificationResult | null = null;

  if (pick.method === 'ollama') {
    result = await callOllama(text, baseUrl, model);
    if (!result) result = await callOpenAICompat(text, baseUrl, model, pick.provider.apiKey);
  } else {
    result = await callOpenAICompat(text, baseUrl, model, pick.provider.apiKey);
  }

  if (result) {
    result.classifierProvider = pick.provider.label || pick.provider.name;
    return result;
  }

  // All providers failed → keyword fallback
  return keywordFallback(text);
}

/**
 * Check if a model is available at an endpoint
 */
export async function isModelAvailable(
  model: string,
  endpoint: string = 'http://localhost:11434'
): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json() as any;
      return (data.models || []).some((m: any) => m.name === model);
    }
  } catch { /* */ }
  return false;
}

/**
 * Get recommended model for a tier
 */
export function getRecommendedModel(tier: 'free' | 'pro'): string {
  return tier === 'pro' ? 'phi-4-mini' : 'llama3.2:1b';
}
