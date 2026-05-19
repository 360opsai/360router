/**
 * Tier enforcement module — Free vs Pro feature gating
 *
 * STRATEGY: Free is the best developer tool for individual use.
 * Pro is compliance, persistence, and team features for businesses.
 *
 * Free must be fully functional for daily developer workflows —
 * streaming, tools, embeddings, unlimited providers all stay ON.
 * This drives adoption, brand, and trust.
 *
 * Pro differentiates on: compliance (scrub+block, audit), persistence
 * (SQLite log, routing table that learns), advanced routing (MI validator,
 * auto-escalation), and operations (historical analytics, teams).
 */

import { loadConfig } from './config.js';

export type Tier = 'free' | 'pro';

export interface TierLimits {
  // Daily-usability features (identical for free + pro)
  streaming: boolean;
  toolCalls: boolean;
  embeddings: boolean;
  maxCloudProviders: number;
  cacheMaxSize: number;
  cacheTtlSeconds: number;
  rateLimitMax: number;
  rateLimitConfigurable: boolean;
  modelRescanIntervalMs: number;

  // Business / compliance features (Pro only)
  qualityGateAutoEscalate: boolean;     // Pro: auto-retry on bigger model
  routingTablePersist: boolean;          // Pro: learns latency across restarts
  persistentRequestLog: boolean;         // Pro: SQLite audit log
  analyticsHistorical: boolean;          // Pro: 30/60/90 day trends
  sensitivityScrubAndBlock: boolean;     // Pro: scrubs + blocks cloud. Free: flag/warn only
  miOutputValidator: boolean;            // Pro: post-generation quality check
  auditLogging: boolean;                 // Pro: compliance-grade audit
  customOptimizerWeights: boolean;       // Pro: tune quality/cost/latency weights
  configProfiles: boolean;               // Pro: dev/staging/prod switching
  configExport: boolean;                 // Pro: export/backup config + telemetry
  classifierModel: string;               // 'llama3.2:1b' free | 'phi4-mini' pro
}

/**
 * FREE — fully functional developer tool
 * All daily-use features enabled. Unlimited providers. Generous rate limits.
 * Limits appear only in the business/compliance column.
 */
const FREE_LIMITS: TierLimits = {
  // Daily usability — FULLY ENABLED
  streaming: true,
  toolCalls: true,
  embeddings: true,
  maxCloudProviders: Infinity,
  cacheMaxSize: 500,
  cacheTtlSeconds: 300,
  rateLimitMax: 1000,                    // 1000 rpm — generous, way more than any dev needs
  rateLimitConfigurable: true,
  modelRescanIntervalMs: 60000,          // every 60s

  // Business / compliance — OFF
  qualityGateAutoEscalate: false,        // Free: reports quality score only
  routingTablePersist: false,            // Free: in-memory only (rebuilds on restart)
  persistentRequestLog: false,           // Free: session telemetry only
  analyticsHistorical: false,            // Free: live /admin/telemetry only
  sensitivityScrubAndBlock: false,       // Free: flag/warn only (per spec)
  miOutputValidator: false,              // Free: no post-generation quality check
  auditLogging: false,                   // Free: no compliance-grade audit
  customOptimizerWeights: false,         // Free: uses default 0.4/0.3/0.3 weights
  configProfiles: false,                 // Free: single config
  configExport: false,                   // Free: no export
  classifierModel: 'llama3.2:1b',        // per spec — US-built, MIT, ~700MB
};

/**
 * PRO — everything for business deployments
 */
const PRO_LIMITS: TierLimits = {
  // Daily usability — same as free (both fully enabled)
  streaming: true,
  toolCalls: true,
  embeddings: true,
  maxCloudProviders: Infinity,
  cacheMaxSize: 500,
  cacheTtlSeconds: 300,
  rateLimitMax: Infinity,                // unlimited
  rateLimitConfigurable: true,
  modelRescanIntervalMs: 60000,

  // Business / compliance — ALL ENABLED
  qualityGateAutoEscalate: true,
  routingTablePersist: true,
  persistentRequestLog: true,
  analyticsHistorical: true,
  sensitivityScrubAndBlock: true,
  miOutputValidator: true,
  auditLogging: true,
  customOptimizerWeights: true,
  configProfiles: true,
  configExport: true,
  classifierModel: 'phi4-mini',          // per spec — US-built, CMMC-aligned, ~2.3GB
};

/**
 * Get tier limits for a given tier
 */
export function getTierLimits(tier: Tier): TierLimits {
  return tier === 'pro' ? PRO_LIMITS : FREE_LIMITS;
}

/**
 * Get current tier from config
 */
export function getCurrentTier(): Tier {
  const config = loadConfig();
  return (config as any).tier || 'free';
}

/**
 * Check if a feature is available for current tier
 */
export function isFeatureAvailable(feature: keyof TierLimits): boolean {
  const tier = getCurrentTier();
  const limits = getTierLimits(tier);
  const value = limits[feature];

  if (typeof value === 'boolean') {
    return value;
  }

  // For numeric values, return true (caller must check the limit itself)
  return true;
}

/**
 * Enforce a feature or throw error (for routes that should 403 on free)
 * Only use this for features that are HARD BLOCKED on free tier.
 */
export function enforceFeatureOrThrow(feature: keyof TierLimits): void {
  const tier = getCurrentTier();
  const limits = getTierLimits(tier);

  const value = limits[feature];
  if (typeof value === 'boolean' && !value) {
    const err = new Error(
      `Feature "${feature}" requires Pro tier. ` +
      `Upgrade at https://360ops.ai/router/pro`
    );
    (err as any).code = 'TIER_REQUIRED';
    (err as any).feature = feature;
    (err as any).currentTier = tier;
    throw err;
  }
}

/**
 * No-op strip function — kept for API compatibility.
 * Free and Pro both support streaming, tools, embeddings — nothing to strip.
 */
export function stripForbiddenFeatures<T extends Record<string, any>>(options: T): T {
  return options;
}
