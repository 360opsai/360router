/**
 * Response Cache
 * In-memory LRU response cache.
 * Hash key = SHA-256(JSON.stringify(messages) + model_preference)
 * TTL: configurable (default 5 minutes)
 * Max entries: configurable (default 500)
 */

import { createHash } from 'crypto';
import type { Message } from './router.js';

export interface CachedResponse {
  content: string;
  provider: string;
  model: string;
  tier: string;
  piiDetected: boolean;
  tool_calls?: any[];
  timestamp: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

interface CacheEntry {
  response: CachedResponse;
  timestamp: number;
}

export class ResponseCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private ttlMs: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize: number = 500, ttlMs: number = 300000) { // 5 minutes default
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * Generate cache key from messages and optional model hint
   */
  private generateKey(messages: Message[], modelHint?: string): string {
    const payload = JSON.stringify(messages) + (modelHint || '');
    return createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Get cached response if available and not expired
   */
  get(messages: Message[], modelHint?: string): CachedResponse | null {
    const key = this.generateKey(messages, modelHint);
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check TTL
    const age = Date.now() - entry.timestamp;
    if (age > this.ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.hits++;
    return entry.response;
  }

  /**
   * Store response in cache
   */
  set(messages: Message[], response: CachedResponse, modelHint?: string): void {
    const key = this.generateKey(messages, modelHint);

    // LRU eviction: if at capacity, remove oldest entry
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    const entry: CacheEntry = {
      response: {
        ...response,
        timestamp: Date.now()
      },
      timestamp: Date.now()
    };

    this.cache.set(key, entry);
  }

  /**
   * Clear all cached responses
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics
   */
  stats(): CacheStats {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? this.hits / total : 0;

    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      hitRate: Math.round(hitRate * 10000) / 100 // Percentage with 2 decimals
    };
  }

  /**
   * Evict expired entries (manual cleanup)
   */
  evictExpired(): number {
    let evicted = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
        evicted++;
      }
    }

    return evicted;
  }

  /**
   * Set TTL (time to live in milliseconds)
   */
  setTtl(ttlMs: number): void {
    this.ttlMs = ttlMs;
  }

  /**
   * Set maximum cache size
   */
  setMaxSize(maxSize: number): void {
    this.maxSize = maxSize;

    // Evict excess entries if new size is smaller
    while (this.cache.size > maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
  }

  /**
   * Get current cache size
   */
  size(): number {
    return this.cache.size;
  }
}

// Singleton instance for use across the router
let globalCache: ResponseCache | null = null;

/**
 * Get the global cache instance
 */
export function getGlobalCache(maxSize?: number, ttlMs?: number): ResponseCache {
  if (!globalCache) {
    globalCache = new ResponseCache(maxSize, ttlMs);
  }
  return globalCache;
}

/**
 * Reset the global cache instance
 */
export function resetGlobalCache(): void {
  if (globalCache) {
    globalCache.clear();
  }
  globalCache = null;
}
