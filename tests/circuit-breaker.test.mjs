/**
 * @360ops/360router — Circuit breaker tests.
 *
 * Tests the circuit breaker state machine with zero API calls.
 * Run: node tests/circuit-breaker.test.mjs (after `pnpm build`)
 */

import { strict as assert } from 'node:assert';

// Import from dist (built by tsup)
const {
  initCircuit,
  getCircuitStatus,
  shouldAllowRequest,
  recordSuccess,
  recordFailure,
  resetCircuit,
  clearAllCircuits,
} = await import('../dist/index.js').catch(() => {
  // Fallback: import from src via dynamic import (requires tsx or Node --experimental-vm-modules)
  console.warn('⚠ dist not found — run pnpm build first');
  process.exit(1);
});

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`❌ ${name}: ${e.message}`);
    failed++;
  }
}

// Clean slate for each test suite
function setup() {
  clearAllCircuits();
}

// ─── 1. Initial state ─────────────────────────────────────────────────────
setup();
test('new circuit starts in closed state', () => {
  initCircuit('anthropic');
  const status = getCircuitStatus('anthropic');
  assert.equal(status.state, 'closed');
  assert.equal(status.failures, 0);
  assert.equal(status.lastFailureTime, null);
  assert.equal(status.nextRetryTime, null);
});

test('closed circuit allows requests', () => {
  initCircuit('openai');
  assert.equal(shouldAllowRequest('openai'), true);
});

// ─── 2. Failure accumulation ──────────────────────────────────────────────
setup();
test('first failure keeps circuit closed (below threshold)', () => {
  initCircuit('gemini');
  recordFailure('gemini');
  assert.equal(getCircuitStatus('gemini').state, 'closed');
  assert.equal(getCircuitStatus('gemini').failures, 1);
  assert.equal(shouldAllowRequest('gemini'), true);
});

test('second failure keeps circuit closed (below threshold)', () => {
  recordFailure('gemini');
  assert.equal(getCircuitStatus('gemini').state, 'closed');
  assert.equal(getCircuitStatus('gemini').failures, 2);
  assert.equal(shouldAllowRequest('gemini'), true);
});

test('third failure opens the circuit', () => {
  recordFailure('gemini');
  const status = getCircuitStatus('gemini');
  assert.equal(status.state, 'open');
  assert.equal(status.failures, 3);
  assert.ok(status.lastFailureTime !== null, 'lastFailureTime should be set');
  assert.ok(status.nextRetryTime !== null, 'nextRetryTime should be set');
});

test('open circuit blocks requests', () => {
  assert.equal(shouldAllowRequest('gemini'), false);
});

// ─── 3. Recovery path ─────────────────────────────────────────────────────
setup();
test('success after failures resets circuit to closed', () => {
  initCircuit('groq');
  recordFailure('groq');
  recordFailure('groq');
  recordSuccess('groq');
  const status = getCircuitStatus('groq');
  assert.equal(status.state, 'closed');
  assert.equal(status.failures, 0);
  assert.equal(status.lastFailureTime, null);
  assert.equal(status.nextRetryTime, null);
});

// ─── 4. Manual reset ──────────────────────────────────────────────────────
setup();
test('resetCircuit clears open state immediately', () => {
  initCircuit('grok');
  recordFailure('grok');
  recordFailure('grok');
  recordFailure('grok');  // Opens circuit
  assert.equal(getCircuitStatus('grok').state, 'open');

  resetCircuit('grok');
  assert.equal(getCircuitStatus('grok').state, 'closed');
  assert.equal(shouldAllowRequest('grok'), true);
});

// ─── 5. Half-open transition after cooldown ───────────────────────────────
setup();
test('circuit transitions to half-open after cooldown period', () => {
  initCircuit('local');
  recordFailure('local');
  recordFailure('local');
  recordFailure('local');  // Opens circuit

  const circuit = getCircuitStatus('local');
  assert.equal(circuit.state, 'open');

  // Simulate time passing by manually setting nextRetryTime to past
  circuit.nextRetryTime = Date.now() - 1;

  // Next getCircuitStatus call should transition to half-open
  const updatedStatus = getCircuitStatus('local');
  assert.equal(updatedStatus.state, 'half-open', 'should transition to half-open after cooldown');
  assert.equal(shouldAllowRequest('local'), true, 'half-open should allow one request');
});

test('failure in half-open re-opens circuit', () => {
  // Already half-open from previous test
  assert.equal(getCircuitStatus('local').state, 'half-open');
  recordFailure('local');
  assert.equal(getCircuitStatus('local').state, 'open');
});

test('success in half-open closes circuit', () => {
  initCircuit('local2');
  recordFailure('local2');
  recordFailure('local2');
  recordFailure('local2');
  getCircuitStatus('local2').nextRetryTime = Date.now() - 1;
  getCircuitStatus('local2');  // Trigger half-open

  recordSuccess('local2');
  assert.equal(getCircuitStatus('local2').state, 'closed');
});

// ─── 6. Multiple independent circuits ─────────────────────────────────────
setup();
test('circuits are independent — one opening does not affect others', () => {
  initCircuit('p1');
  initCircuit('p2');
  recordFailure('p1');
  recordFailure('p1');
  recordFailure('p1');  // p1 opens
  assert.equal(getCircuitStatus('p1').state, 'open');
  assert.equal(getCircuitStatus('p2').state, 'closed');
  assert.equal(shouldAllowRequest('p1'), false);
  assert.equal(shouldAllowRequest('p2'), true);
});

// ─── 7. Unknown provider auto-init ────────────────────────────────────────
test('shouldAllowRequest auto-inits circuit for unknown provider', () => {
  // Don't call initCircuit — shouldAllowRequest should handle it
  assert.equal(shouldAllowRequest('brand-new-provider'), true);
  assert.equal(getCircuitStatus('brand-new-provider').state, 'closed');
});

// ─── Results ──────────────────────────────────────────────────────────────
console.log('\n─────────────────────────────────');
console.log(`Circuit breaker tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
