/**
 * Circuit breaker for provider health management
 * Prevents repeated calls to failing providers
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitStatus {
  state: CircuitState;
  failures: number;
  lastFailureTime: number | null;
  nextRetryTime: number | null;
}

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 60000; // 60 seconds
const circuits = new Map<string, CircuitStatus>();

/**
 * Initialize circuit for a provider
 */
export function initCircuit(providerName: string): void {
  if (!circuits.has(providerName)) {
    circuits.set(providerName, {
      state: 'closed',
      failures: 0,
      lastFailureTime: null,
      nextRetryTime: null
    });
  }
}

/**
 * Get current circuit status
 */
export function getCircuitStatus(providerName: string): CircuitStatus {
  initCircuit(providerName);
  const circuit = circuits.get(providerName)!;

  // Check if we should transition from open to half-open
  if (circuit.state === 'open' && circuit.nextRetryTime) {
    if (Date.now() >= circuit.nextRetryTime) {
      circuit.state = 'half-open';
    }
  }

  return circuit;
}

/**
 * Check if a request should be allowed
 */
export function shouldAllowRequest(providerName: string): boolean {
  const status = getCircuitStatus(providerName);
  return status.state === 'closed' || status.state === 'half-open';
}

/**
 * Record a successful request
 */
export function recordSuccess(providerName: string): void {
  const circuit = circuits.get(providerName);
  if (!circuit) return;

  // Reset to closed state on success
  circuit.state = 'closed';
  circuit.failures = 0;
  circuit.lastFailureTime = null;
  circuit.nextRetryTime = null;
}

/**
 * Record a failed request
 */
export function recordFailure(providerName: string): void {
  const circuit = circuits.get(providerName);
  if (!circuit) return;

  const now = Date.now();
  circuit.failures += 1;
  circuit.lastFailureTime = now;

  // If in half-open state, immediately go back to open
  if (circuit.state === 'half-open') {
    circuit.state = 'open';
    circuit.nextRetryTime = now + COOLDOWN_MS;
    return;
  }

  // Check if we've hit the failure threshold
  if (circuit.failures >= FAILURE_THRESHOLD) {
    circuit.state = 'open';
    circuit.nextRetryTime = now + COOLDOWN_MS;
  }
}

/**
 * Reset circuit to closed state (manual override)
 */
export function resetCircuit(providerName: string): void {
  const circuit = circuits.get(providerName);
  if (!circuit) return;

  circuit.state = 'closed';
  circuit.failures = 0;
  circuit.lastFailureTime = null;
  circuit.nextRetryTime = null;
}

/**
 * Get all circuit statuses
 */
export function getAllCircuitStatuses(): Map<string, CircuitStatus> {
  return new Map(circuits);
}

/**
 * Clear all circuits (useful for testing)
 */
export function clearAllCircuits(): void {
  circuits.clear();
}
