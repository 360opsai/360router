/**
 * Persistent routing table — the living registry of all known AI models
 * Section 8 of v2.0 spec
 *
 * Pro tier: persists to ~/.360router/routing_table.json
 * Free tier: in-memory only
 */

import { ModelRecord } from './config.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { filterModels } from './model-filter.js';

export class RoutingTable {
  private models: Map<string, ModelRecord> = new Map();
  private persistPath?: string;

  /**
   * Create routing table
   * @param persistPath - If undefined, in-memory only (free tier)
   */
  constructor(persistPath?: string) {
    this.persistPath = persistPath;
    if (persistPath) {
      this.load();
    }
  }

  /**
   * Insert or update a model in the routing table
   */
  upsert(model: ModelRecord): void {
    this.models.set(model.name, model);
    if (this.persistPath) {
      this.save();
    }
  }

  /**
   * Remove a model from the routing table
   */
  remove(name: string): void {
    this.models.delete(name);
    if (this.persistPath) {
      this.save();
    }
  }

  /**
   * Get models by tier score (O(1) lookup using tier_score_range)
   * Returns models whose tier_score_range includes the given score
   */
  getByTierScore(score: number): ModelRecord[] {
    const candidates: ModelRecord[] = [];
    for (const model of this.models.values()) {
      const [min, max] = model.tier_score_range;
      if (score >= min && score <= max) {
        candidates.push(model);
      }
    }
    // Apply user exclude/allow list
    return filterModels(candidates);
  }

  /**
   * Internal: unfiltered tier lookup (used for diagnostics only)
   */
  private _getByTierScoreUnfiltered(score: number): ModelRecord[] {
    const candidates: ModelRecord[] = [];
    for (const model of this.models.values()) {
      const [min, max] = model.tier_score_range;
      if (score >= min && score <= max) {
        candidates.push(model);
      }
    }
    return candidates;
  }

  /**
   * Get all models in the routing table
   */
  getAll(): ModelRecord[] {
    // Apply user exclude/allow list
    return filterModels(Array.from(this.models.values()));
  }

  /**
   * Get all models including excluded (for diagnostics/CLI display)
   */
  getAllUnfiltered(): ModelRecord[] {
    return Array.from(this.models.values());
  }

  /**
   * Get a specific model by name
   */
  get(name: string): ModelRecord | undefined {
    return this.models.get(name);
  }

  /**
   * Record latency for a model (updates rolling average)
   * Formula: new_avg = (old_avg * 0.8) + (new_ms * 0.2)
   */
  recordLatency(name: string, ms: number): void {
    const model = this.models.get(name);
    if (!model) return;

    model.latency_avg = (model.latency_avg * 0.8) + (ms * 0.2);
    model.last_seen = new Date().toISOString();
    this.upsert(model);
  }

  /**
   * Mark a model failure
   * Circuit breaker: 3 failures → cooldown_until = now + 60s, status = 'cooldown'
   */
  markFailure(name: string): void {
    const model = this.models.get(name);
    if (!model) return;

    model.failure_count += 1;

    // Circuit breaker fires at 3 failures
    if (model.failure_count >= 3) {
      model.status = 'cooldown';
      model.cooldown_until = Date.now() + 60000;  // 60s cooldown
    }

    this.upsert(model);
  }

  /**
   * Mark a model success (resets failure_count)
   */
  markSuccess(name: string): void {
    const model = this.models.get(name);
    if (!model) return;

    model.failure_count = 0;
    model.last_seen = new Date().toISOString();

    // Clear cooldown if it was set
    if (model.status === 'cooldown' && model.cooldown_until && Date.now() > model.cooldown_until) {
      model.status = 'alive';
      model.cooldown_until = null;
    }

    this.upsert(model);
  }

  /**
   * Check and update cooldown status for all models
   * Call this periodically to clear expired cooldowns
   */
  updateCooldowns(): void {
    const now = Date.now();
    for (const model of this.models.values()) {
      if (model.status === 'cooldown' && model.cooldown_until && now > model.cooldown_until) {
        model.status = 'alive';
        model.cooldown_until = null;
        model.failure_count = 0;
        this.upsert(model);
      }
    }
  }

  /**
   * Save routing table to disk (Pro only)
   */
  save(): void {
    if (!this.persistPath) return;

    try {
      const dir = join(homedir(), '.360router');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const data = Array.from(this.models.values());
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save routing table:', error);
    }
  }

  /**
   * Load routing table from disk (Pro only)
   */
  load(): void {
    if (!this.persistPath) return;

    try {
      if (!existsSync(this.persistPath)) {
        return;  // No saved table yet
      }

      const data = readFileSync(this.persistPath, 'utf-8');
      const models: ModelRecord[] = JSON.parse(data);

      this.models.clear();
      for (const model of models) {
        this.models.set(model.name, model);
      }
    } catch (error) {
      console.error('Failed to load routing table:', error);
    }
  }

  /**
   * Get count of models in the table
   */
  count(): number {
    return this.models.size;
  }

  /**
   * Clear all models (for testing)
   */
  clear(): void {
    this.models.clear();
    if (this.persistPath) {
      this.save();
    }
  }
}

/**
 * Get the default persist path for pro tier
 */
export function getDefaultPersistPath(): string {
  return join(homedir(), '.360router', 'routing_table.json');
}

/**
 * Create a routing table instance based on tier
 */
export function createRoutingTable(tier: 'free' | 'pro'): RoutingTable {
  if (tier === 'pro') {
    return new RoutingTable(getDefaultPersistPath());
  } else {
    return new RoutingTable();  // In-memory only
  }
}
