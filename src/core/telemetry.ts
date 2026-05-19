/**
 * Telemetry collection and reporting
 * Opt-in only — sends aggregated performance metrics to 360ops
 */

import { isTelemetryEnabled } from './config.js';
import os from 'os';

export interface TelemetryEvent {
  event: 'route_completed' | 'route_failed' | 'fallback_triggered' | 'health_check';
  provider?: string;
  latency_ms?: number;
  success: boolean;
  error_code?: string;
  os: string;
  version: string;
  ts: string;
}

const TELEMETRY_ENDPOINT = 'https://llyftztfkadrnbtisagn.supabase.co/functions/v1/router-events';
const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 60000; // 60 seconds

let eventQueue: TelemetryEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;

/**
 * Get version from package.json
 */
function getVersion(): string {
  return '0.1.0'; // TODO: read from package.json in built version
}

/**
 * Record a telemetry event
 */
export function recordEvent(event: Omit<TelemetryEvent, 'os' | 'version' | 'ts'>): void {
  if (!isTelemetryEnabled()) {
    return;
  }

  const fullEvent: TelemetryEvent = {
    ...event,
    os: `${os.platform()}-${os.arch()}`,
    version: getVersion(),
    ts: new Date().toISOString()
  };

  eventQueue.push(fullEvent);

  // Auto-flush if batch size reached
  if (eventQueue.length >= BATCH_SIZE) {
    void flushEvents();
  }

  // Start flush timer if not already running
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      void flushEvents();
    }, FLUSH_INTERVAL_MS);
  }
}

/**
 * Flush events to telemetry endpoint
 */
export async function flushEvents(): Promise<void> {
  if (eventQueue.length === 0) {
    return;
  }

  const eventsToSend = [...eventQueue];
  eventQueue = [];

  // Clear timer
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  try {
    await fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ type: 'telemetry', events: eventsToSend }),
      signal: AbortSignal.timeout(5000)
    });
  } catch (error) {
    // Silent failure — never affect routing
    // Could re-queue events here, but keeping it simple
  }
}

/**
 * Record a successful route
 */
export function recordRouteSuccess(provider: string, latencyMs: number): void {
  recordEvent({
    event: 'route_completed',
    provider,
    latency_ms: latencyMs,
    success: true
  });
}

/**
 * Record a failed route
 */
export function recordRouteFailure(provider: string, errorCode: string): void {
  recordEvent({
    event: 'route_failed',
    provider,
    success: false,
    error_code: errorCode
  });
}

/**
 * Record a fallback trigger
 */
export function recordFallback(fromProvider: string, toProvider: string): void {
  recordEvent({
    event: 'fallback_triggered',
    provider: `${fromProvider}->${toProvider}`,
    success: true
  });
}

/**
 * Record a health check
 */
export function recordHealthCheck(provider: string, success: boolean, latencyMs?: number): void {
  recordEvent({
    event: 'health_check',
    provider,
    success,
    latency_ms: latencyMs
  });
}

/**
 * Force flush on shutdown
 */
export async function shutdown(): Promise<void> {
  await flushEvents();
}

/**
 * Get current queue size (for testing)
 */
export function getQueueSize(): number {
  return eventQueue.length;
}
