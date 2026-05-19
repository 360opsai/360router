/**
 * Basic PII detection for privacy counter
 * This is NOT the full 11-vertical scrubber — just simple pattern matching
 * Only runs on cloud-bound requests to track potential sensitive data
 */

import { incrementPiiCount } from './config.js';

/**
 * SSN pattern: XXX-XX-XXXX
 */
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/;

/**
 * Email pattern
 */
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;

/**
 * Phone pattern: various formats
 */
const PHONE_PATTERN = /\b(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/;

/**
 * Credit card pattern (basic Luhn check)
 */
const CC_PATTERN = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/;

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
 * Check if text contains potential PII
 */
export function detectPii(text: string): boolean {
  // Check SSN
  if (SSN_PATTERN.test(text)) {
    return true;
  }

  // Check email
  if (EMAIL_PATTERN.test(text)) {
    return true;
  }

  // Check phone
  if (PHONE_PATTERN.test(text)) {
    return true;
  }

  // Check credit card with Luhn validation
  const ccMatches = text.match(CC_PATTERN);
  if (ccMatches) {
    for (const match of ccMatches) {
      if (luhnCheck(match)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Scan messages for PII and increment counter if found
 */
export function scanAndCount(messages: Array<{ role: string; content: string }>): boolean {
  const fullText = messages.map(m => m.content).join('\n');
  const hasPii = detectPii(fullText);

  if (hasPii) {
    incrementPiiCount();
  }

  return hasPii;
}

/**
 * Get PII types detected (for debugging/logging)
 */
export function getPiiTypes(text: string): string[] {
  const types: string[] = [];

  if (SSN_PATTERN.test(text)) {
    types.push('SSN');
  }

  if (EMAIL_PATTERN.test(text)) {
    types.push('email');
  }

  if (PHONE_PATTERN.test(text)) {
    types.push('phone');
  }

  const ccMatches = text.match(CC_PATTERN);
  if (ccMatches) {
    for (const match of ccMatches) {
      if (luhnCheck(match)) {
        types.push('credit_card');
        break;
      }
    }
  }

  return types;
}
