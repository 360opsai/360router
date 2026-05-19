/**
 * Model filter — apply user allow/exclude lists to auto-discovered models
 *
 * Use case: 360Router auto-scans and discovers all models on Ollama,
 * vLLM, DGX, and cloud providers. Users can exclude specific models
 * (e.g. "I don't want phi4-mini to ever be picked") or restrict to
 * an allow-list.
 *
 * Pattern support:
 *   - Exact match: "phi4-mini"
 *   - Glob wildcard: "qwen*", "*3b*", "claude-opus-*"
 *   - Case-insensitive
 *   - Matches against model name AND "provider/model" composite key
 */

import { loadConfig, saveConfig } from './config.js';
import type { ModelRecord } from './config.js';

/**
 * Compile a pattern string into a regex
 *   "phi4-mini" → /^phi4-mini$/i
 *   "qwen*"     → /^qwen.*$/i
 *   "*3b*"      → /^.*3b.*$/i
 */
export function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex metacharacters
    .replace(/\*/g, '.*');                  // * → .*
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Check if a model matches ANY pattern in a list
 */
export function matchesAnyPattern(modelName: string, providerName: string, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) return false;
  const compositeName = `${providerName}/${modelName}`;

  for (const pattern of patterns) {
    const re = patternToRegex(pattern);
    if (re.test(modelName) || re.test(compositeName)) {
      return true;
    }
  }
  return false;
}

/**
 * Filter a model list through the user's allow/exclude config
 *
 * Rules:
 *   1. If allowedModels is set and non-empty → only models matching it are kept
 *   2. Otherwise, models matching excludedModels are removed
 *   3. Both empty/unset → return all models
 */
export function filterModels<T extends { name: string; provider: string }>(
  models: T[],
  config?: { allowedModels?: string[]; excludedModels?: string[] }
): T[] {
  const cfg = config ?? loadConfig();
  const allowed = cfg.allowedModels ?? [];
  const excluded = cfg.excludedModels ?? [];

  if (allowed.length > 0) {
    // Allow-list mode: only keep matching models
    return models.filter(m => matchesAnyPattern(m.name, m.provider, allowed));
  }

  if (excluded.length > 0) {
    // Exclude mode: remove matching models
    return models.filter(m => !matchesAnyPattern(m.name, m.provider, excluded));
  }

  return models;
}

/**
 * Check if a specific model is allowed for routing
 */
export function isModelAllowed(modelName: string, providerName: string = ''): boolean {
  const cfg = loadConfig();
  const allowed = cfg.allowedModels ?? [];
  const excluded = cfg.excludedModels ?? [];

  if (allowed.length > 0) {
    return matchesAnyPattern(modelName, providerName, allowed);
  }

  return !matchesAnyPattern(modelName, providerName, excluded);
}

/**
 * Add a pattern to the exclude list
 */
export function excludeModel(pattern: string): void {
  const cfg = loadConfig();
  const excluded = new Set(cfg.excludedModels ?? []);
  excluded.add(pattern.trim());
  saveConfig({ ...cfg, excludedModels: Array.from(excluded) });
}

/**
 * Remove a pattern from the exclude list
 */
export function unexcludeModel(pattern: string): void {
  const cfg = loadConfig();
  const excluded = (cfg.excludedModels ?? []).filter(p => p !== pattern.trim());
  saveConfig({ ...cfg, excludedModels: excluded });
}

/**
 * Clear all exclusions
 */
export function clearExclusions(): void {
  const cfg = loadConfig();
  saveConfig({ ...cfg, excludedModels: [] });
}

/**
 * Get current exclude list
 */
export function getExcludedModels(): string[] {
  return loadConfig().excludedModels ?? [];
}

/**
 * Get current allow list
 */
export function getAllowedModels(): string[] {
  return loadConfig().allowedModels ?? [];
}
