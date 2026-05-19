/**
 * Quality Feedback Loop
 * Post-routing quality check. If the response quality is too low
 * for the tier, auto-escalate to a higher-tier model.
 *
 * Quick quality signals (no LLM call needed):
 *   - Response length vs tier expectation
 *   - Refusal detection ("I can't", "I'm not able", "As an AI")
 *   - Error patterns in output
 *   - Coherence: does response relate to input?
 *
 * If quality < threshold → re-route to next tier up
 * Max 1 retry (don't loop forever)
 */

type ComplexityTier = 'simple' | 'medium' | 'complex' | 'expert';

export interface QualityResult {
  score: number;       // 0-1
  passed: boolean;
  reason: string;
  shouldEscalate: boolean;
  suggestedTier?: ComplexityTier;
  signals: {
    lengthCheck: number;
    refusalDetected: boolean;
    errorDetected: boolean;
    relevanceScore: number;
    coherenceCheck: boolean;
  };
}

// Refusal patterns
const REFUSAL_PATTERNS = [
  /i\s+can'?t\s+help/i,
  /i'?m\s+unable/i,
  /i\s+cannot/i,
  /as\s+an\s+ai\s+language\s+model/i,
  /i\s+don'?t\s+have\s+access/i,
  /i'?m\s+not\s+able\s+to/i,
  /i\s+apologize,?\s+but/i,
  /sorry,?\s+i\s+can'?t/i,
];

// Error patterns — strict: only match when output IS an error, not discusses one
const ERROR_PATTERNS = [
  /^undefined$/i,                     // entire response is "undefined"
  /^null$/i,                          // entire response is "null"
  /^error:/i,                         // starts with "error:"
  /internal server error/i,           // server error leaked
  /unhandled.*exception/i,            // crash trace
  /stack\s*trace/i,                   // stack trace in output
];

/**
 * Expected word count range by tier
 * NOTE: min is soft — short answers to short questions are fine.
 * The length check scales down when the input is short.
 */
const EXPECTED_LENGTH: Record<ComplexityTier, { min: number; max: number }> = {
  simple: { min: 1, max: 200 },
  medium: { min: 5, max: 500 },
  complex: { min: 20, max: 1000 },
  expert: { min: 50, max: 2000 },
};

/**
 * Check if output contains refusal language
 */
function detectRefusal(output: string): boolean {
  for (const pattern of REFUSAL_PATTERNS) {
    if (pattern.test(output)) return true;
  }
  return false;
}

/**
 * Check if output contains error patterns
 */
function detectErrors(output: string): boolean {
  // Check for repeated text (likely generation error)
  const words = output.split(/\s+/);
  if (words.length > 10) {
    const firstWord = words[0];
    let repeatCount = 0;
    for (const word of words) {
      if (word === firstWord) repeatCount++;
    }
    if (repeatCount > words.length * 0.3) return true; // 30% repetition = error
  }

  // Check error keywords
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(output)) return true;
  }

  return false;
}

/**
 * Calculate relevance score using bag-of-words overlap
 */
function calculateRelevance(input: string, output: string): number {
  // Extract keywords (remove common words)
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can']);

  const extractKeywords = (text: string): Set<string> => {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w))
    );
  };

  const inputKeywords = extractKeywords(input);
  const outputKeywords = extractKeywords(output);

  if (inputKeywords.size === 0) return 1.0; // No keywords to match

  // Count overlapping keywords
  let overlap = 0;
  for (const keyword of inputKeywords) {
    if (outputKeywords.has(keyword)) overlap++;
  }

  return overlap / inputKeywords.size;
}

/**
 * Check output length vs tier expectations
 */
function checkLength(output: string, tier: ComplexityTier): number {
  const wordCount = output.split(/\s+/).filter(w => w.length > 0).length;
  const expected = EXPECTED_LENGTH[tier];

  // Empty or too short
  if (wordCount === 0) return 0;
  if (wordCount < 5) return 0.1; // Just "OK" or "Sure" = bad

  // Within expected range = good
  if (wordCount >= expected.min && wordCount <= expected.max) {
    return 1.0;
  }

  // Too short for tier
  if (wordCount < expected.min) {
    return wordCount / expected.min; // Proportional score
  }

  // Too long (less penalized than too short)
  if (wordCount > expected.max) {
    return 0.8;
  }

  return 1.0;
}

/**
 * Get next tier up for escalation
 */
function getNextTier(currentTier: ComplexityTier): ComplexityTier | undefined {
  const tierOrder: ComplexityTier[] = ['simple', 'medium', 'complex', 'expert'];
  const currentIdx = tierOrder.indexOf(currentTier);
  if (currentIdx < tierOrder.length - 1) {
    return tierOrder[currentIdx + 1];
  }
  return undefined; // Already at expert
}

/**
 * Evaluate response quality and determine if escalation is needed
 */
export function evaluateQuality(
  input: string,
  output: string,
  tier: ComplexityTier,
  latencyMs: number,
  threshold: number = 0.4
): QualityResult {
  // Check coherence — scale expectation to input length
  const inputWordCount = input.split(/\s+/).filter(w => w.length > 0).length;
  const wordCount = output.split(/\s+/).filter(w => w.length > 0).length;
  // Short input (< 10 words) → even 1-word answer is coherent
  // Long input → expect more substance
  const minCoherentWords = inputWordCount < 10 ? 1 : inputWordCount < 30 ? 3 : 5;
  const coherenceCheck = wordCount >= minCoherentWords;

  // Length check
  const lengthScore = checkLength(output, tier);

  // Refusal detection
  const refusalDetected = detectRefusal(output);

  // Error detection
  const errorDetected = detectErrors(output);

  // Relevance check
  const relevanceScore = calculateRelevance(input, output);

  // Calculate overall quality score
  let score = 1.0;

  // Refusal = immediate low score
  if (refusalDetected) {
    score = 0.1;
  }
  // Error patterns = very low score
  else if (errorDetected) {
    score = 0.2;
  }
  // Empty or too short = low score
  else if (!coherenceCheck) {
    score = 0.15;
  }
  // Combine length and relevance
  else {
    score = (lengthScore * 0.6) + (relevanceScore * 0.4);
  }

  const passed = score >= threshold;
  const shouldEscalate = !passed && tier !== 'expert';
  const suggestedTier = shouldEscalate ? getNextTier(tier) : undefined;

  let reason = '';
  if (refusalDetected) {
    reason = 'Refusal language detected';
  } else if (errorDetected) {
    reason = 'Error patterns in output';
  } else if (!coherenceCheck) {
    reason = 'Response too short (< 5 words)';
  } else if (lengthScore < 0.5) {
    reason = `Response length (${wordCount} words) below tier expectation`;
  } else if (relevanceScore < 0.2) {
    reason = 'Low relevance to input';
  } else if (!passed) {
    reason = `Quality score ${score.toFixed(2)} below threshold ${threshold}`;
  } else {
    reason = `Quality score ${score.toFixed(2)} passed`;
  }

  return {
    score,
    passed,
    reason,
    shouldEscalate,
    suggestedTier,
    signals: {
      lengthCheck: lengthScore,
      refusalDetected,
      errorDetected,
      relevanceScore,
      coherenceCheck
    }
  };
}

/**
 * Helper to format quality result for logging
 */
export function formatQualityResult(result: QualityResult): string {
  const { score, passed, reason, shouldEscalate, suggestedTier, signals } = result;

  let output = `Quality: ${(score * 100).toFixed(0)}% ${passed ? '✓' : '✗'} - ${reason}`;

  if (shouldEscalate && suggestedTier) {
    output += ` → Escalate to ${suggestedTier}`;
  }

  return output;
}
