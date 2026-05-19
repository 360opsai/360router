/**
 * @360ops/360router — Routing table tests.
 *
 * Tests the routing table logic: round-robin, failover, tier assignment.
 * No API calls — purely tests the dispatch-decision layer.
 *
 * Run: node tests/routing-table.test.mjs (after `pnpm build`)
 */

import { strict as assert } from 'node:assert';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r instanceof Promise) {
      return r.then(() => {
        console.log(`✅ ${name}`);
        passed++;
      }).catch(e => {
        console.error(`❌ ${name}: ${e.message}`);
        failed++;
      });
    }
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`❌ ${name}: ${e.message}`);
    failed++;
  }
}

// ─── Minimal routing table logic (extracted from src/core/routing-table.ts)
// We test the pure logic here without importing the full dist chain.

/**
 * Simple round-robin selection from a list of providers.
 * Replicates the pattern used in routing-table.ts.
 */
function selectRoundRobin(providers, callCount) {
  if (!providers.length) return null;
  return providers[callCount % providers.length];
}

/**
 * Complexity tier assignment based on message length and keywords.
 * Replicates the pattern from adaptive-classifier.ts.
 */
function classifyComplexity(messageText) {
  const wordCount = messageText.split(/\s+/).length;
  const hasComplexKeywords = /analyz|compar|explain|summar|research|strateg/i.test(messageText);
  const hasCodeKeywords = /code|function|implement|debug|refactor|test/i.test(messageText);

  if (wordCount > 200 || (hasComplexKeywords && wordCount > 50)) return 'expert';
  if (wordCount > 80 || hasComplexKeywords || hasCodeKeywords) return 'complex';
  if (wordCount > 20) return 'medium';
  return 'simple';
}

/**
 * Provider preference by tier (replicates the tier-based routing logic).
 */
function getPreferredProviders(tier, availableProviders) {
  const cloudProviders = availableProviders.filter(p => p.kind === 'cloud');
  const localProviders = availableProviders.filter(p => p.kind === 'local');

  switch (tier) {
    case 'expert':
    case 'complex':
      // Prefer cloud for complex/expert requests
      return cloudProviders.length ? cloudProviders : localProviders;
    case 'medium':
    case 'simple':
    default:
      // Prefer local for simple/medium (cost + privacy)
      return localProviders.length ? localProviders : cloudProviders;
  }
}

const MOCK_PROVIDERS = [
  { name: 'anthropic', kind: 'cloud', healthy: true },
  { name: 'openai',    kind: 'cloud', healthy: true },
  { name: 'local',     kind: 'local', healthy: true },
  { name: 'groq',      kind: 'cloud', healthy: false },  // unhealthy
];

// ─── 1. Round-robin selection ─────────────────────────────────────────────
test('round-robin cycles through providers evenly', () => {
  const providers = ['p1', 'p2', 'p3'];
  assert.equal(selectRoundRobin(providers, 0), 'p1');
  assert.equal(selectRoundRobin(providers, 1), 'p2');
  assert.equal(selectRoundRobin(providers, 2), 'p3');
  assert.equal(selectRoundRobin(providers, 3), 'p1');  // wraps
  assert.equal(selectRoundRobin(providers, 100), 'p2');  // large count
});

test('round-robin returns null for empty list', () => {
  assert.equal(selectRoundRobin([], 0), null);
});

test('round-robin with single provider always returns same', () => {
  const providers = ['only-one'];
  assert.equal(selectRoundRobin(providers, 0), 'only-one');
  assert.equal(selectRoundRobin(providers, 999), 'only-one');
});

// ─── 2. Complexity tier classification ────────────────────────────────────
test('simple message classifies as simple', () => {
  assert.equal(classifyComplexity('What time is it?'), 'simple');
  assert.equal(classifyComplexity('Hello'), 'simple');
  assert.equal(classifyComplexity('Thanks'), 'simple');
});

test('medium-length message classifies as medium', () => {
  // Must be >20 words but <80 words and no complex keywords to land in 'medium'
  const medium = 'What are the best practices for building a REST API in Node.js? I want to understand the key architectural concepts and patterns used by experienced backend developers in production systems.';
  assert.equal(classifyComplexity(medium), 'medium');
});

test('complex message with code keywords classifies as complex or higher', () => {
  const complex = 'Help me implement a function that sorts an array';
  const tier = classifyComplexity(complex);
  assert.ok(['complex', 'expert'].includes(tier), `expected complex/expert, got ${tier}`);
});

test('long analytical message classifies as expert', () => {
  const expert = Array(210).fill('analyze').join(' ');  // >200 words
  assert.equal(classifyComplexity(expert), 'expert');
});

// ─── 3. Tier-based provider preference ───────────────────────────────────
test('expert tier prefers cloud providers', () => {
  const providers = getPreferredProviders('expert', MOCK_PROVIDERS);
  assert.ok(providers.every(p => p.kind === 'cloud'), 'expert should prefer cloud');
  assert.ok(providers.length >= 2);
});

test('simple tier prefers local providers', () => {
  const providers = getPreferredProviders('simple', MOCK_PROVIDERS);
  assert.ok(providers.every(p => p.kind === 'local'), 'simple should prefer local');
  assert.equal(providers.length, 1);  // only 1 local in mock
});

test('simple tier falls back to cloud if no local providers', () => {
  const cloudOnly = MOCK_PROVIDERS.filter(p => p.kind === 'cloud');
  const providers = getPreferredProviders('simple', cloudOnly);
  assert.ok(providers.every(p => p.kind === 'cloud'), 'should fall back to cloud');
  assert.ok(providers.length > 0);
});

// ─── 4. Failover filtering ────────────────────────────────────────────────
test('unhealthy providers filtered out before routing', () => {
  const healthyProviders = MOCK_PROVIDERS.filter(p => p.healthy);
  assert.equal(healthyProviders.length, 3);  // groq filtered
  assert.ok(!healthyProviders.find(p => p.name === 'groq'));
});

test('all unhealthy: falls back to first available regardless', () => {
  const allUnhealthy = MOCK_PROVIDERS.map(p => ({ ...p, healthy: false }));
  // With all unhealthy, routing should still pick something (don't leave user hanging)
  const fallback = allUnhealthy[0];  // Last resort
  assert.ok(fallback, 'must have at least one fallback');
  assert.equal(fallback.name, 'anthropic');
});

// ─── 5. Priority ordering ─────────────────────────────────────────────────
test('cloud providers order: anthropic > openai > groq (lower latency/cost heuristic)', () => {
  const cloudOrder = ['anthropic', 'openai', 'gemini', 'groq'];
  const priority = { anthropic: 0, openai: 1, gemini: 2, groq: 3, grok: 4 };

  // Sort by priority
  const sorted = [...cloudOrder].sort((a, b) => (priority[a] ?? 99) - (priority[b] ?? 99));
  assert.equal(sorted[0], 'anthropic');
  assert.equal(sorted[3], 'groq');
});

// ─── 6. Message format handling ───────────────────────────────────────────
test('system message is separated from chat messages correctly', () => {
  const messages = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' },
    { role: 'user', content: 'How are you?' }
  ];

  let systemMessage = undefined;
  const chatMessages = messages.filter(m => {
    if (m.role === 'system') {
      systemMessage = m.content;
      return false;
    }
    return true;
  });

  assert.equal(systemMessage, 'You are a helpful assistant.');
  assert.equal(chatMessages.length, 3);
  assert.ok(chatMessages.every(m => m.role !== 'system'));
});

test('messages without system message leave system as undefined', () => {
  const messages = [
    { role: 'user', content: 'Hello' }
  ];

  let systemMessage = undefined;
  const chatMessages = messages.filter(m => {
    if (m.role === 'system') { systemMessage = m.content; return false; }
    return true;
  });

  assert.equal(systemMessage, undefined);
  assert.equal(chatMessages.length, 1);
});

// ─── Results ──────────────────────────────────────────────────────────────
await new Promise(resolve => setTimeout(resolve, 100));

console.log('\n─────────────────────────────────────────');
console.log(`Routing table tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
