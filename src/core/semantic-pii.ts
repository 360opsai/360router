/**
 * Semantic PII Detection
 * Enhanced PII detection using:
 * 1. Existing regex patterns (SSN, email, phone, CC)
 * 2. Keyword context detection (catches "my social is..." patterns)
 * 3. Named entity patterns (addresses, dates of birth, etc.)
 *
 * Does NOT use embeddings (too slow for inline routing).
 * Uses expanded pattern library + contextual keyword matching.
 */

export interface PiiDetectionResult {
  detected: boolean;
  types: string[];
  severity: 'low' | 'medium' | 'high';
  recommendation: 'allow' | 'warn' | 'block';
  details: Array<{ type: string; match: string; context?: string }>;
}

// ── Core PII Patterns (from existing privacy-counter.ts) ────────────────────

const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
const PHONE_PATTERN = /\b(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/;
const CC_PATTERN = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/;

// ── Contextual PII Patterns ─────────────────────────────────────────────────

const PII_CONTEXT_PATTERNS = [
  // SSN context: "my social is", "SSN:", "social security"
  { pattern: /(?:social\s*security|ssn|my\s*social)\s*(?:is|number|#|:)\s*\d{3}[\s-]?\d{2}[\s-]?\d{4}/i, type: 'ssn_context', severity: 'high' as const },

  // DOB context
  { pattern: /(?:born|birthday|date\s*of\s*birth|dob)\s*(?:is|:)?\s*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/i, type: 'dob', severity: 'medium' as const },

  // Address patterns (street addresses)
  { pattern: /\b\d{1,5}\s+[\w\s]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|way|place|pl)\b/i, type: 'address', severity: 'medium' as const },

  // Medical record number
  { pattern: /(?:medical\s*record|mrn|patient\s*id)\s*(?:#|:)?\s*\w+/i, type: 'medical_id', severity: 'high' as const },

  // Passport
  { pattern: /(?:passport)\s*(?:#|number|:)\s*\w+/i, type: 'passport', severity: 'high' as const },

  // Driver's license
  { pattern: /(?:driver'?s?\s*licen[sc]e|DL)\s*(?:#|number|:)\s*\w+/i, type: 'drivers_license', severity: 'high' as const },

  // Bank account
  { pattern: /(?:account|routing)\s*(?:#|number|:)\s*\d{4,}/i, type: 'bank_account', severity: 'high' as const },

  // IP address (in context of personal info)
  { pattern: /(?:my\s*ip|ip\s*address)\s*(?:is|:)\s*\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i, type: 'ip_address', severity: 'low' as const },

  // Login credentials
  { pattern: /(?:password|passwd|pwd)\s*(?:is|:)\s*\S+/i, type: 'password', severity: 'high' as const },

  // API keys
  { pattern: /(?:api[_\s]?key|token)\s*(?:is|:)\s*[\w\-]{20,}/i, type: 'api_key', severity: 'high' as const },
];

/**
 * Luhn algorithm to validate credit card numbers
 */
function luhnCheck(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let isEven = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i], 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

/**
 * Detect enhanced PII with severity and recommendation
 */
export function detectPiiEnhanced(text: string): PiiDetectionResult {
  const types: string[] = [];
  const details: Array<{ type: string; match: string; context?: string }> = [];
  let highestSeverity: 'low' | 'medium' | 'high' = 'low';

  // Check SSN (high severity)
  const ssnMatches = text.match(new RegExp(SSN_PATTERN, 'g'));
  if (ssnMatches) {
    types.push('ssn');
    highestSeverity = 'high';
    for (const match of ssnMatches) {
      details.push({ type: 'ssn', match });
    }
  }

  // Check credit card with Luhn validation (high severity)
  const ccMatches = text.match(new RegExp(CC_PATTERN, 'g'));
  if (ccMatches) {
    for (const match of ccMatches) {
      if (luhnCheck(match)) {
        if (!types.includes('credit_card')) {
          types.push('credit_card');
          highestSeverity = 'high';
        }
        details.push({ type: 'credit_card', match: match.replace(/\d(?=\d{4})/g, '*') });
      }
    }
  }

  // Check email (medium severity)
  const emailMatches = text.match(new RegExp(EMAIL_PATTERN, 'g'));
  if (emailMatches) {
    types.push('email');
    if (highestSeverity === 'low') highestSeverity = 'medium';
    for (const match of emailMatches.slice(0, 3)) { // Limit details
      details.push({ type: 'email', match });
    }
  }

  // Check phone (medium severity)
  const phoneMatches = text.match(new RegExp(PHONE_PATTERN, 'g'));
  if (phoneMatches) {
    types.push('phone');
    if (highestSeverity === 'low') highestSeverity = 'medium';
    for (const match of phoneMatches.slice(0, 3)) {
      details.push({ type: 'phone', match });
    }
  }

  // Check contextual patterns
  for (const { pattern, type, severity } of PII_CONTEXT_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      if (!types.includes(type)) {
        types.push(type);
      }

      // Update severity
      if (severity === 'high') {
        highestSeverity = 'high';
      } else if (severity === 'medium' && highestSeverity === 'low') {
        highestSeverity = 'medium';
      }

      // Add detail with limited context
      for (const match of matches.slice(0, 2)) {
        const context = extractContext(text, match);
        details.push({ type, match: match.substring(0, 50), context });
      }
    }
  }

  // Determine recommendation based on severity
  let recommendation: 'allow' | 'warn' | 'block';
  if (highestSeverity === 'high') {
    recommendation = 'block';
  } else if (highestSeverity === 'medium') {
    recommendation = 'warn';
  } else {
    recommendation = 'allow';
  }

  return {
    detected: types.length > 0,
    types,
    severity: types.length > 0 ? highestSeverity : 'low',
    recommendation,
    details
  };
}

/**
 * Extract surrounding context for a match (20 chars before/after)
 */
function extractContext(text: string, match: string): string {
  const index = text.indexOf(match);
  if (index === -1) return '';

  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + match.length + 20);

  let context = text.substring(start, end);
  if (start > 0) context = '...' + context;
  if (end < text.length) context = context + '...';

  return context;
}

/**
 * Scan messages for PII (convenience wrapper for router)
 */
export function scanMessagesForPii(messages: Array<{ role: string; content: string }>): PiiDetectionResult {
  const fullText = messages.map(m => m.content).join('\n');
  return detectPiiEnhanced(fullText);
}

/**
 * Format PII detection result for logging
 */
export function formatPiiResult(result: PiiDetectionResult): string {
  if (!result.detected) return 'No PII detected';

  const typeStr = result.types.join(', ');
  const icon = result.severity === 'high' ? '🚫' : result.severity === 'medium' ? '⚠️' : 'ℹ️';

  return `${icon} PII detected (${result.severity}): ${typeStr} → ${result.recommendation}`;
}
