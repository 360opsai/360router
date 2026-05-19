/**
 * Configuration persistence using the conf package
 * Cross-platform storage for provider settings and telemetry preferences
 */

import Conf from 'conf';

export interface ProviderConfig {
  name: string;
  kind: 'local' | 'cloud';
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
  label?: string;
}

/**
 * Model record in the routing table
 * Section 8 of v2.0 spec
 */
export interface ModelRecord {
  name: string;
  provider: string;
  tier: 'fast' | 'standard' | 'strong' | 'expert';
  tier_score_range: [number, number];  // e.g. [0.50, 0.75] for strong
  capabilities: string[];  // chat, code, vision, embed, classify, tools
  cost_per_1k: number;  // USD, $0.001 floor for local
  latency_avg: number;  // rolling average in ms
  context_window: number;
  status: 'alive' | 'cooldown' | 'unavailable';
  failure_count: number;
  cooldown_until: number | null;  // timestamp or null
  detected_at: string;  // ISO timestamp
  last_seen: string;  // ISO timestamp
  us_origin: boolean;  // for CMMC-aligned supply chain
}

export interface Config {
  version: string;
  telemetry: boolean;
  providers: ProviderConfig[];
  history: {
    totalRoutes: number;
    piiDetected: number;
    lastResetDate: string;
  };
  proxyApiKey?: string;
  rateLimitPerMinute?: number;
  // v2.0: Tier system
  tier?: 'free' | 'pro';
  licenseKey?: string;
  dailyCloudBudgetUsd?: number;
  regulatedMode?: boolean;
  // Feature 1: Adaptive Classifier
  useAdaptiveClassifier?: boolean;
  // Feature 2: Optimizer
  optimizerWeights?: {
    quality: number;
    cost: number;
    latency: number;
  };
  // Feature 3: Quality Gate
  qualityGateEnabled?: boolean;
  qualityGateThreshold?: number;
  // Feature 4: Response Cache
  cacheEnabled?: boolean;
  cacheTtlSeconds?: number;
  cacheMaxSize?: number;
  // v2.0: Model exclusion — pattern list. Supports exact match or glob (*)
  // Examples: ["phi4-mini", "qwen*", "*3b*", "claude-opus-*"]
  excludedModels?: string[];
  // v2.0: Explicit model allow-list. If set, only matching models can be used.
  // Overrides excludedModels. Empty/unset = allow all.
  allowedModels?: string[];
}

const schema = {
  version: {
    type: 'string',
    default: '1.0.0'
  },
  telemetry: {
    type: 'boolean',
    default: false
  },
  providers: {
    type: 'array',
    default: []
  },
  history: {
    type: 'object',
    default: {
      totalRoutes: 0,
      piiDetected: 0,
      lastResetDate: new Date().toISOString()
    }
  }
} as const;

const store = new Conf<Config>({
  projectName: '360router',
  schema: schema as any,
  defaults: {
    version: '1.0.0',
    telemetry: false,
    providers: [],
    history: {
      totalRoutes: 0,
      piiDetected: 0,
      lastResetDate: new Date().toISOString()
    }
  }
});

/**
 * Load configuration from disk
 */
export function loadConfig(): Config {
  return store.store;
}

/**
 * Alias for loadConfig (used in server code for consistency)
 */
export function getConfig(): Config {
  return loadConfig();
}

/**
 * Check if at least one provider is configured and enabled
 */
export function isConfigured(): boolean {
  const config = loadConfig();
  return config.providers.some(p => p.enabled);
}

/**
 * Save configuration to disk
 */
/**
 * Save config. MERGES with existing to prevent accidental data loss.
 * To do a full replace (e.g. uninstall), use `store.clear()` + `saveConfig()`.
 */
export function saveConfig(config: Partial<Config>): void {
  const existing = loadConfig();
  store.store = { ...existing, ...config } as Config;
}

/**
 * Add or update a provider in config
 */
export function upsertProvider(provider: ProviderConfig): void {
  const config = loadConfig();
  const index = config.providers.findIndex(p => p.name === provider.name);

  if (index >= 0) {
    config.providers[index] = provider;
  } else {
    config.providers.push(provider);
  }

  saveConfig(config);
}

/**
 * Remove a provider from config
 */
export function removeProvider(name: string): void {
  const config = loadConfig();
  config.providers = config.providers.filter(p => p.name !== name);
  saveConfig(config);
}

/**
 * Get enabled providers only
 */
export function getEnabledProviders(): ProviderConfig[] {
  const config = loadConfig();
  return config.providers.filter(p => p.enabled);
}

/**
 * Increment route counter
 */
export function incrementRouteCount(): void {
  const config = loadConfig();
  config.history.totalRoutes += 1;
  saveConfig(config);
}

/**
 * Increment PII detection counter
 */
export function incrementPiiCount(): void {
  const config = loadConfig();
  config.history.piiDetected += 1;
  saveConfig(config);
}

/**
 * Reset monthly counters if needed
 */
export function resetCountersIfNeeded(): void {
  const config = loadConfig();
  const lastReset = new Date(config.history.lastResetDate);
  const now = new Date();

  // Reset if we're in a new month
  if (lastReset.getMonth() !== now.getMonth() || lastReset.getFullYear() !== now.getFullYear()) {
    config.history.piiDetected = 0;
    config.history.lastResetDate = now.toISOString();
    saveConfig(config);
  }
}

/**
 * Enable or disable telemetry
 */
export function setTelemetry(enabled: boolean): void {
  const config = loadConfig();
  config.telemetry = enabled;
  saveConfig(config);
}

/**
 * Check if telemetry is enabled
 */
export function isTelemetryEnabled(): boolean {
  const config = loadConfig();
  return config.telemetry;
}

/**
 * Known models table (Section 8 of v2.0 spec)
 * Seed data for routing table initialization
 */
export const KNOWN_MODELS: Partial<ModelRecord>[] = [
  {
    name: 'llama3.2:1b',
    provider: 'local',
    tier: 'fast',
    tier_score_range: [0.0, 0.25],
    capabilities: ['chat', 'classify'],
    cost_per_1k: 0.001,
    context_window: 8192,
    us_origin: true  // Meta (US)
  },
  {
    name: 'phi4-mini',
    provider: 'local',
    tier: 'standard',
    tier_score_range: [0.25, 0.50],
    capabilities: ['chat', 'code', 'classify'],
    cost_per_1k: 0.001,
    context_window: 16384,
    us_origin: true  // Microsoft (US)
  },
  {
    name: 'qwen2.5:0.5b',
    provider: 'local',
    tier: 'fast',
    tier_score_range: [0.0, 0.25],
    capabilities: ['chat'],
    cost_per_1k: 0.001,
    context_window: 32768,
    us_origin: false  // Alibaba (CN) — user opt-in only
  }
];
