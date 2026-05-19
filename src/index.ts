/**
 * 360router v2.0.0 — Smart AI model router (local first, cloud when needed)
 * Layer 3: Rubik's Cube 5-move dispatch with mathematical routing vector
 * @module 360router
 */

export { route, healthCheckAll } from './core/router.js';
export type { RouteResult, RouteOptions, Message } from './core/router.js';
export { loadConfig, saveConfig } from './core/config.js';
export type { ProviderConfig, Config, ModelRecord } from './core/config.js';
export { scanLocalProviders } from './core/scanner.js';
export type { ScanResult } from './core/scanner.js';

// v2.0: Tier system
export { getCurrentTier, getTierLimits, isFeatureAvailable, enforceFeatureOrThrow } from './core/tier-gate.js';
export type { Tier, TierLimits } from './core/tier-gate.js';

// v2.0: Routing table
export { RoutingTable, createRoutingTable, getDefaultPersistPath } from './core/routing-table.js';

// Feature 1: Adaptive Complexity Classifier
export { classifyComplexityAdaptive, clearClassificationCache } from './core/adaptive-classifier.js';

// Feature 2: Cost-Latency-Quality Optimizer
export { scoreProviders, recordLatency, getAvgLatency, getModelPricing, clearLatencyData } from './core/optimizer.js';
export type { ProviderScore, OptimizerWeights, ProviderCandidate } from './core/optimizer.js';

// Feature 3: Quality Feedback Loop
export { evaluateQuality, formatQualityResult } from './core/quality-gate.js';
export type { QualityResult } from './core/quality-gate.js';

// Feature 4: Response Cache
export { ResponseCache, getGlobalCache, resetGlobalCache } from './core/response-cache.js';
export type { CachedResponse, CacheStats } from './core/response-cache.js';

// Feature 5: Semantic PII Detection
export { detectPiiEnhanced, scanMessagesForPii, formatPiiResult } from './core/semantic-pii.js';
export type { PiiDetectionResult } from './core/semantic-pii.js';

// Circuit breaker (exported for monitoring + testing)
export {
  initCircuit,
  getCircuitStatus,
  shouldAllowRequest,
  recordSuccess,
  recordFailure,
  resetCircuit,
  clearAllCircuits,
  getAllCircuitStatuses,
} from './core/circuit-breaker.js';
export type { CircuitState, CircuitStatus } from './core/circuit-breaker.js';

// v2.0: Layer 3 Pipeline Components (Components 2-5)
export { MIScorer, getMIScorer } from './core/mi-scorer.js';
export type { MIScoreResult } from './core/mi-scorer.js';
export { getSeedCombos, getSeedComboCount } from './core/seed-disambiguation-combos.js';
export type { DisambiguationCombo } from './core/seed-disambiguation-combos.js';
export { scanStructuralPatterns, getUrgencyLevel } from './core/structural-scanner.js';
export type { StructuralScanResult } from './core/structural-scanner.js';
export { classifyWithLLM, isModelAvailable, getRecommendedModel } from './core/llm-classifier.js';
export type { LLMClassificationResult } from './core/llm-classifier.js';
export { assembleVector, explainVector, urgencyScoreToLabel, adjustTier } from './core/vector-assembly.js';
export type { RoutingVector } from './core/vector-assembly.js';
