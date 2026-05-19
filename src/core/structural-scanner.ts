/**
 * Component 3: Structural Pattern Scanner
 *
 * Pure regex-based urgency detection. No model, no inference.
 * Detects: temporal/deadline, consequence, negation/blocker, imperative, escalation
 *
 * Patterns from spec Section 6:
 * - Temporal/deadline: "before friday", "by tonight", "asap", "deadline", "due"
 * - Consequence: "or else", "will penalize", "will fail", "at risk", "critical" (1.4x multiplier)
 * - Negation/blocker: "not responding", "can't reach", "won't", "haven't", "still not"
 * - Imperative: "i need to", "i have to", "must", "required" (urgency floor: medium)
 * - Escalation: "tried everything", "hours ago", "already", "still" (urgency bumped +1)
 *
 * Composite formula: urgency = (proximity * deadline_flag * stakes_multiplier) normalized to 0.0-1.0
 */

export interface StructuralScanResult {
  urgencyScore: number;      // 0.0-1.0
  deadline: boolean;
  consequence: boolean;
  blocker: boolean;
  imperative: boolean;
  escalation: boolean;
}

// Pattern definitions (case-insensitive)
const TEMPORAL_PATTERNS = [
  /\b(before|by)\s+(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\basap\b/i,
  /\b(urgent|urgently)\b/i,
  /\bdeadline\b/i,
  /\b(due|overdue)\b/i,
  /\bimmediately\b/i,
  /\bright\s+now\b/i,
  /\bthis\s+(morning|afternoon|evening)\b/i,
  /\bwithin\s+\d+\s+(hour|hours|day|days|minute|minutes)\b/i,
  /\bend\s+of\s+(day|week|month)\b/i,
  /\beod\b/i,
  /\beow\b/i,
  /\beom\b/i,
];

const CONSEQUENCE_PATTERNS = [
  /\bor\s+else\b/i,
  /\bwill\s+(penalize|fine|charge|fail|lose)\b/i,
  /\bat\s+risk\b/i,
  /\bcritical\b/i,
  /\bemergency\b/i,
  /\bwill\s+be\s+(fired|terminated|penalized)\b/i,
  /\bmiss\s+the\b/i,
  /\bcan't\s+afford\s+to\b/i,
  /\bwill\s+impact\b/i,
  /\bcatastrophic\b/i,
  /\bsevere\b/i,
];

const NEGATION_BLOCKER_PATTERNS = [
  /\b(not|isn't|aren't|wasn't|weren't)\s+responding\b/i,
  /\bcan't\s+(reach|contact|get\s+hold)\b/i,
  /\bwon't\s+(respond|reply|answer)\b/i,
  /\bhaven't\s+(heard|received|gotten)\b/i,
  /\bstill\s+not\b/i,
  /\bno\s+response\b/i,
  /\bunresponsive\b/i,
  /\bnot\s+working\b/i,
  /\bbroken\b/i,
  /\bdown\b/i,
  /\bblocked\b/i,
  /\bcan't\s+access\b/i,
  /\bunavailable\b/i,
];

const IMPERATIVE_PATTERNS = [
  /\bi\s+(need|have)\s+to\b/i,
  /\bmust\b/i,
  /\brequired\b/i,
  /\bnecessary\b/i,
  /\bhas\s+to\s+be\b/i,
  /\bneeds\s+to\s+be\b/i,
  /\bshould\s+be\b/i,
  /\bplease\s+(help|fix|resolve)\b/i,
  /\bessential\b/i,
  /\bimperative\b/i,
];

const ESCALATION_PATTERNS = [
  /\btried\s+(everything|multiple|several)\b/i,
  /\b(hours|days|weeks)\s+ago\b/i,
  /\balready\b/i,
  /\bstill\b/i,
  /\byet\s+again\b/i,
  /\bkeep\s+(trying|asking)\b/i,
  /\bmultiple\s+times\b/i,
  /\brepeatedly\b/i,
  /\bescalate\b/i,
  /\bmanager\b/i,
  /\bsupervisor\b/i,
];

/**
 * Calculate temporal proximity score
 * Returns higher score for nearer deadlines
 */
function calculateProximity(text: string): number {
  const lowerText = text.toLowerCase();

  // Immediate urgency
  if (
    /\b(now|immediately|asap|right\s+now|urgent)\b/.test(lowerText)
  ) {
    return 1.0;
  }

  // Same day
  if (
    /\b(today|tonight|this\s+(morning|afternoon|evening)|eod)\b/.test(lowerText)
  ) {
    return 0.9;
  }

  // Next day
  if (/\b(tomorrow|by\s+tomorrow)\b/.test(lowerText)) {
    return 0.75;
  }

  // Within hours
  if (/\bwithin\s+\d+\s+(hour|hours)\b/.test(lowerText)) {
    const match = lowerText.match(/\bwithin\s+(\d+)\s+hour/);
    if (match) {
      const hours = parseInt(match[1], 10);
      return Math.max(0.5, 1.0 - hours / 24);
    }
    return 0.7;
  }

  // This week
  if (
    /\b(this\s+week|by\s+(monday|tuesday|wednesday|thursday|friday)|eow)\b/.test(lowerText)
  ) {
    return 0.6;
  }

  // Within days
  if (/\bwithin\s+\d+\s+days?\b/.test(lowerText)) {
    const match = lowerText.match(/\bwithin\s+(\d+)\s+day/);
    if (match) {
      const days = parseInt(match[1], 10);
      return Math.max(0.3, 1.0 - days / 7);
    }
    return 0.5;
  }

  // End of month
  if (/\b(this\s+month|by\s+month\s+end|eom)\b/.test(lowerText)) {
    return 0.4;
  }

  // Generic deadline
  if (/\b(deadline|due)\b/.test(lowerText)) {
    return 0.5;
  }

  // No temporal signal
  return 0.2;
}

/**
 * Scan text for structural urgency patterns
 */
export function scanStructuralPatterns(text: string): StructuralScanResult {
  // Detect pattern presence
  const deadline = TEMPORAL_PATTERNS.some(pattern => pattern.test(text));
  const consequence = CONSEQUENCE_PATTERNS.some(pattern => pattern.test(text));
  const blocker = NEGATION_BLOCKER_PATTERNS.some(pattern => pattern.test(text));
  const imperative = IMPERATIVE_PATTERNS.some(pattern => pattern.test(text));
  const escalation = ESCALATION_PATTERNS.some(pattern => pattern.test(text));

  // Calculate base proximity score
  let proximity = calculateProximity(text);

  // Apply multipliers
  let stakesMultiplier = 1.0;
  if (consequence) {
    stakesMultiplier = 1.4; // Per spec Section 6
  }

  // Composite urgency calculation
  let urgency = proximity * (deadline ? 1.0 : 0.6) * stakesMultiplier;

  // Apply imperative floor (medium = 0.55 per spec Section 3.1)
  if (imperative && urgency < 0.55) {
    urgency = 0.55;
  }

  // Apply escalation bump (+1 level)
  if (escalation) {
    // Map current urgency to discrete levels, bump +1, remap to score
    const levels = [
      { threshold: 0.0, name: 'none', bump: 0.30 },     // none → low
      { threshold: 0.30, name: 'low', bump: 0.55 },     // low → medium
      { threshold: 0.55, name: 'medium', bump: 0.80 },  // medium → high
      { threshold: 0.80, name: 'high', bump: 1.00 },    // high → critical
      { threshold: 1.00, name: 'critical', bump: 1.00 }, // critical (max)
    ];

    for (let i = levels.length - 1; i >= 0; i--) {
      if (urgency >= levels[i].threshold) {
        urgency = levels[i].bump;
        break;
      }
    }
  }

  // Normalize to 0.0-1.0 range
  urgency = Math.max(0.0, Math.min(1.0, urgency));

  return {
    urgencyScore: urgency,
    deadline,
    consequence,
    blocker,
    imperative,
    escalation,
  };
}

/**
 * Get urgency level name from score
 * Maps scores to discrete urgency levels per spec Section 3.1
 */
export function getUrgencyLevel(score: number): 'none' | 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 1.00) return 'critical';
  if (score >= 0.80) return 'high';
  if (score >= 0.55) return 'medium';
  if (score >= 0.30) return 'low';
  return 'none';
}
