/**
 * Component 2: PMI/MI Combo Scorer
 *
 * Implements Pointwise Mutual Information (PMI) scoring for domain classification
 * and sensitivity detection. Loads disambiguation_combos data from seed file.
 *
 * PMI formula: PMI(x,y) = log2[ P(x,y) / (P(x) * P(y)) ]
 * Normalized: NPMI(x,y) = PMI(x,y) / -log2 P(x,y)  (range -1.0 to +1.0)
 *
 * Thresholds:
 * - MI_HIGH: PMI > 1.5 → strong domain signal
 * - MI_NEG: PMI < -1.0 → domain eliminator
 * - MI_NOISE: |PMI| < 0.5 → filter out (never enters combo table)
 * - MI_OUTPUT: avg > 0.3 → output validator (Pro only)
 *
 * Free tier: platform + industry combos (no scrubbing)
 * Pro tier: includes phi_* / pii_* combos + scrubbing
 */

import { getSeedCombos, type DisambiguationCombo } from './seed-disambiguation-combos.js';

// PMI thresholds per spec Section 5.2
const MI_HIGH = 1.5;      // Strong domain signal
const MI_NEG = -1.0;      // Hard domain eliminator
const MI_NOISE = 0.5;     // Noise filter threshold (absolute value)
const MI_OUTPUT = 0.3;    // Output validator threshold (Pro only)

export interface MIScoreResult {
  domainScores: Record<string, number>;
  sensitivityFlag: 0 | 1;
}

/**
 * Tokenize input text for PMI matching
 * Lowercases, removes punctuation, splits on whitespace
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 0);
}

/**
 * Generate bigrams and trigrams from token array
 */
function generateNGrams(tokens: string[]): string[][] {
  const ngrams: string[][] = [];

  // Bigrams
  for (let i = 0; i < tokens.length - 1; i++) {
    ngrams.push([tokens[i], tokens[i + 1]]);
  }

  // Trigrams
  for (let i = 0; i < tokens.length - 2; i++) {
    ngrams.push([tokens[i], tokens[i + 1], tokens[i + 2]]);
  }

  return ngrams;
}

/**
 * Check if two token arrays match (order-independent for small sets)
 */
function tokensMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;

  // For bigrams/trigrams, check both ordered and unordered matches
  // Ordered match
  if (a.every((token, i) => token === b[i])) return true;

  // Unordered match (allows for slight word order variation)
  const aSet = new Set(a);
  const bSet = new Set(b);
  if (aSet.size !== bSet.size) return false;

  for (const token of aSet) {
    if (!bSet.has(token)) return false;
  }

  return true;
}

/**
 * MI Scorer class
 */
export class MIScorer {
  private combos: DisambiguationCombo[];
  private tier: 'free' | 'pro';

  constructor(tier: 'free' | 'pro' = 'free') {
    this.tier = tier;
    this.combos = getSeedCombos(tier);
  }

  /**
   * Score message text and return domain scores + sensitivity flag
   *
   * @param text - Raw human input text
   * @returns MIScoreResult with domain scores and sensitivity flag
   */
  score(text: string): MIScoreResult {
    const tokens = tokenize(text);
    const ngrams = generateNGrams(tokens);

    const domainScores: Record<string, number> = {};
    let sensitivityDetected = false;

    // Match ngrams against combo table
    for (const ngram of ngrams) {
      for (const combo of this.combos) {
        if (tokensMatch(ngram, combo.tokens)) {
          const { domain, pmi } = combo;

          // Check sensitivity domains (phi_* or pii_*)
          if (domain.startsWith('phi_') || domain.startsWith('pii_')) {
            sensitivityDetected = true;
          }

          // Apply PMI threshold filters
          if (Math.abs(pmi) < MI_NOISE) {
            // Noise - skip
            continue;
          }

          // Initialize domain score if not exists
          if (!domainScores[domain]) {
            domainScores[domain] = 0;
          }

          // Accumulate PMI score
          if (pmi > MI_HIGH) {
            // Strong positive signal
            domainScores[domain] += pmi;
          } else if (pmi < MI_NEG) {
            // Negative signal - subtract from domain score
            domainScores[domain] += pmi; // pmi is already negative
          } else {
            // Medium signal
            domainScores[domain] += pmi * 0.5; // Dampen medium signals
          }
        }
      }
    }

    // Remove domains with negative or zero total scores
    for (const domain in domainScores) {
      if (domainScores[domain] <= 0) {
        delete domainScores[domain];
      }
    }

    return {
      domainScores,
      sensitivityFlag: sensitivityDetected ? 1 : 0,
    };
  }

  /**
   * Validate output text against resolved domain (Pro only)
   *
   * Checks if answer vocabulary aligns with the resolved domain.
   * Returns true if avg MI > MI_OUTPUT threshold (0.3)
   *
   * @param outputText - Generated answer text
   * @param domain - Resolved domain from routing
   * @returns boolean - true if output passes validation
   */
  validateOutput(outputText: string, domain: string): boolean {
    if (this.tier !== 'pro') {
      // Output validation only available in Pro tier
      return true;
    }

    const tokens = tokenize(outputText);
    const ngrams = generateNGrams(tokens);

    let totalPMI = 0;
    let matchCount = 0;

    // Check output ngrams against domain combos
    for (const ngram of ngrams) {
      for (const combo of this.combos) {
        if (combo.domain === domain && tokensMatch(ngram, combo.tokens)) {
          totalPMI += combo.pmi;
          matchCount++;
        }
      }
    }

    if (matchCount === 0) {
      // No domain-specific vocabulary found - could be generic answer
      // Allow it but flag for review
      return true;
    }

    const avgMI = totalPMI / matchCount;
    return avgMI > MI_OUTPUT;
  }

  /**
   * Get the top-scoring domain
   *
   * @param domainScores - Domain scores from score()
   * @returns Top domain name or null if no domains scored
   */
  getTopDomain(domainScores: Record<string, number>): string | null {
    const domains = Object.entries(domainScores);
    if (domains.length === 0) return null;

    domains.sort((a, b) => b[1] - a[1]);
    return domains[0][0];
  }

  /**
   * Check if text contains sensitive data
   *
   * @param text - Raw human input text
   * @returns boolean - true if phi_* or pii_* domains detected
   */
  hasSensitiveData(text: string): boolean {
    const result = this.score(text);
    return result.sensitivityFlag === 1;
  }

  /**
   * Scrub sensitive data from text (Pro only)
   *
   * Replaces sensitive tokens with [REDACTED] markers
   *
   * @param text - Raw text potentially containing sensitive data
   * @returns Scrubbed text
   */
  scrubSensitiveData(text: string): string {
    if (this.tier !== 'pro') {
      // Scrubbing only available in Pro tier
      return text;
    }

    let scrubbedText = text;
    const tokens = tokenize(text);
    const ngrams = generateNGrams(tokens);

    // Find sensitive combos
    const sensitiveMatches: string[][] = [];
    for (const ngram of ngrams) {
      for (const combo of this.combos) {
        if (
          (combo.domain.startsWith('phi_') || combo.domain.startsWith('pii_')) &&
          tokensMatch(ngram, combo.tokens)
        ) {
          sensitiveMatches.push(combo.tokens);
        }
      }
    }

    // Replace sensitive patterns with [REDACTED]
    // Use case-insensitive regex replacement
    for (const match of sensitiveMatches) {
      const pattern = new RegExp(match.join('\\s+'), 'gi');
      scrubbedText = scrubbedText.replace(pattern, '[REDACTED]');
    }

    return scrubbedText;
  }

  /**
   * Get loaded combo count for diagnostics
   */
  getComboCount(): number {
    return this.combos.length;
  }
}

/**
 * Create a singleton instance for the current tier
 */
let _instance: MIScorer | null = null;

export function getMIScorer(tier: 'free' | 'pro' = 'free'): MIScorer {
  if (!_instance || _instance['tier'] !== tier) {
    _instance = new MIScorer(tier);
  }
  return _instance;
}
