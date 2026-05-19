/**
 * Component 5: Numeric Vector Assembly
 *
 * Maps all label outputs from components 2-4 to floats.
 * Applies weighted tier formula to produce routing vector V and tier index.
 *
 * V = [ intent_weight, depth_score, output_weight, urgency_score, context_load, sensitivity_flag ]
 *
 * Tier formula (Section 3.2):
 * TIER_SCORE = (intent × 0.25) + (depth × 0.40) + (output × 0.20) + (urgency × 0.10) + (context × 0.05)
 *
 * Tier boundaries:
 * - 0.00-0.25 → tier_index 0 (FAST)
 * - 0.25-0.50 → tier_index 1 (STANDARD)
 * - 0.50-0.75 → tier_index 2 (STRONG)
 * - 0.75-1.00 → tier_index 3 (EXPERT)
 */

import type { LLMClassificationResult } from './llm-classifier.js';
import type { MIScoreResult } from './mi-scorer.js';
import type { StructuralScanResult } from './structural-scanner.js';

// Numeric mappings per spec Section 3.1

const INTENT_WEIGHTS: Record<string, number> = {
  resolve: 0.95,
  create: 0.85,
  explain: 0.75,
  decide: 0.80,
  retrieve: 0.40,
  execute: 0.60,
};

const DEPTH_SCORES: Record<string, number> = {
  fast: 0.15,
  standard: 0.40,
  strong: 0.65,
  expert: 0.90,
};

const OUTPUT_WEIGHTS: Record<string, number> = {
  answer: 0.30,
  steps: 0.55,
  code: 0.80,
  analysis: 0.75,
  summary: 0.50,
  creative: 0.65,
};

const URGENCY_SCORES: Record<string, number> = {
  none: 0.10,
  low: 0.30,
  medium: 0.55,
  high: 0.80,
  critical: 1.00,
};

const CONTEXT_LOAD_SCORES: Record<string, number> = {
  low: 0.20,
  medium: 0.50,
  high: 0.85,
};

// Tier formula weights per spec Section 3.2
const TIER_WEIGHTS = {
  intent: 0.25,
  depth: 0.40,   // Highest weight - strongest predictor
  output: 0.20,
  urgency: 0.10,
  context: 0.05,
};

export interface RoutingVector {
  V: number[];            // [intent, depth, output, urgency, context, sensitivity]
  tier_score: number;     // Weighted sum 0.0-1.0
  tier_index: 0 | 1 | 2 | 3;  // FAST=0, STANDARD=1, STRONG=2, EXPERT=3
  tier_name: 'fast' | 'standard' | 'strong' | 'expert';
}

/**
 * Assemble routing vector from component outputs
 *
 * @param llmResult - Classification from 1B LLM or keyword fallback
 * @param miResult - PMI/MI scorer output
 * @param structuralResult - Structural scanner output
 * @returns RoutingVector with V array, tier_score, tier_index, tier_name
 */
export function assembleVector(
  llmResult: LLMClassificationResult,
  miResult: MIScoreResult,
  structuralResult: StructuralScanResult
): RoutingVector {
  // Map labels to numeric values
  const intent_weight = INTENT_WEIGHTS[llmResult.intent] ?? 0.75;
  const depth_score = DEPTH_SCORES[llmResult.depth] ?? 0.40;
  const output_weight = OUTPUT_WEIGHTS[llmResult.output_type] ?? 0.50;
  const context_load = CONTEXT_LOAD_SCORES[llmResult.context_load] ?? 0.50;

  // Urgency: combine LLM urgency with structural scanner urgency (take max)
  const llm_urgency = URGENCY_SCORES[llmResult.urgency] ?? 0.10;
  const structural_urgency = structuralResult.urgencyScore;
  const urgency_score = Math.max(llm_urgency, structural_urgency);

  // Sensitivity flag (0 or 1)
  const sensitivity_flag = miResult.sensitivityFlag;

  // Construct vector V
  const V = [
    intent_weight,
    depth_score,
    output_weight,
    urgency_score,
    context_load,
    sensitivity_flag,
  ];

  // Calculate tier score using weighted formula
  const tier_score =
    intent_weight * TIER_WEIGHTS.intent +
    depth_score * TIER_WEIGHTS.depth +
    output_weight * TIER_WEIGHTS.output +
    urgency_score * TIER_WEIGHTS.urgency +
    context_load * TIER_WEIGHTS.context;

  // Map tier_score to tier_index and tier_name
  let tier_index: 0 | 1 | 2 | 3;
  let tier_name: 'fast' | 'standard' | 'strong' | 'expert';

  if (tier_score >= 0.75) {
    tier_index = 3;
    tier_name = 'expert';
  } else if (tier_score >= 0.50) {
    tier_index = 2;
    tier_name = 'strong';
  } else if (tier_score >= 0.25) {
    tier_index = 1;
    tier_name = 'standard';
  } else {
    tier_index = 0;
    tier_name = 'fast';
  }

  return {
    V,
    tier_score,
    tier_index,
    tier_name,
  };
}

/**
 * Get human-readable breakdown of vector components
 * Useful for debugging and observability
 */
export function explainVector(vector: RoutingVector): {
  intent: number;
  depth: number;
  output: number;
  urgency: number;
  context: number;
  sensitivity: number;
  tier_score: number;
  tier_name: string;
} {
  return {
    intent: vector.V[0],
    depth: vector.V[1],
    output: vector.V[2],
    urgency: vector.V[3],
    context: vector.V[4],
    sensitivity: vector.V[5],
    tier_score: vector.tier_score,
    tier_name: vector.tier_name,
  };
}

/**
 * Map urgency score back to label for logging/debugging
 */
export function urgencyScoreToLabel(score: number): string {
  if (score >= 1.00) return 'critical';
  if (score >= 0.80) return 'high';
  if (score >= 0.55) return 'medium';
  if (score >= 0.30) return 'low';
  return 'none';
}

/**
 * Apply tier adjustment based on special conditions
 * (For future use - e.g., user preferences, override rules)
 */
export function adjustTier(
  vector: RoutingVector,
  adjustments: {
    forceMinTier?: 'fast' | 'standard' | 'strong' | 'expert';
    forceMaxTier?: 'fast' | 'standard' | 'strong' | 'expert';
    bumpTier?: number; // +1 or -1
  }
): RoutingVector {
  let tier_index = vector.tier_index;

  // Apply tier bump if specified
  if (adjustments.bumpTier !== undefined) {
    tier_index = Math.max(0, Math.min(3, tier_index + adjustments.bumpTier)) as 0 | 1 | 2 | 3;
  }

  // Apply min tier constraint
  if (adjustments.forceMinTier) {
    const minTierMap = { fast: 0, standard: 1, strong: 2, expert: 3 };
    const minIndex = minTierMap[adjustments.forceMinTier];
    tier_index = Math.max(tier_index, minIndex) as 0 | 1 | 2 | 3;
  }

  // Apply max tier constraint
  if (adjustments.forceMaxTier) {
    const maxTierMap = { fast: 0, standard: 1, strong: 2, expert: 3 };
    const maxIndex = maxTierMap[adjustments.forceMaxTier];
    tier_index = Math.min(tier_index, maxIndex) as 0 | 1 | 2 | 3;
  }

  // Map back to tier_name
  const tierNames: ('fast' | 'standard' | 'strong' | 'expert')[] = ['fast', 'standard', 'strong', 'expert'];
  const tier_name = tierNames[tier_index];

  // Recalculate tier_score to match new tier_index
  // Map tier_index to midpoint of its range
  const tier_score_map = [0.125, 0.375, 0.625, 0.875]; // Midpoints of each tier range
  const tier_score = tier_score_map[tier_index];

  return {
    ...vector,
    tier_index,
    tier_name,
    tier_score,
  };
}
