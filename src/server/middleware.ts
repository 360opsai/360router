/**
 * Express middleware for auth and rate limiting
 */

import type { Request, Response, NextFunction } from 'express';
import { loadConfig } from '../core/config.js';
import { getCurrentTier, getTierLimits } from '../core/tier-gate.js';

/**
 * Authentication middleware
 * Requires Bearer token on /v1/* routes if proxyApiKey is configured
 */
export function authMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip auth for health and admin endpoints
    if (req.path === '/health' || req.path.startsWith('/admin/')) {
      return next();
    }

    // Only enforce on /v1/* routes
    if (!req.path.startsWith('/v1/')) {
      return next();
    }

    const config = loadConfig();
    const proxyApiKey = config.proxyApiKey;

    // If no proxy key configured, allow all requests
    if (!proxyApiKey) {
      return next();
    }

    // Extract Bearer token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: {
          message: 'Invalid API key',
          type: 'auth_error'
        }
      });
    }

    const token = authHeader.slice(7); // Remove 'Bearer '
    if (token !== proxyApiKey) {
      return res.status(401).json({
        error: {
          message: 'Invalid API key',
          type: 'auth_error'
        }
      });
    }

    next();
  };
}

// Token bucket state for rate limiting
interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, TokenBucket>();

/**
 * Rate limiting middleware
 * In-memory token bucket, keyed by Bearer token or IP
 */
export function rateLimitMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const config = loadConfig();
    const tier = getCurrentTier();
    const limits = getTierLimits(tier);

    // Free tier: hard cap at 60 rpm regardless of config
    // Pro tier: respect config.rateLimitPerMinute or default to Infinity
    let limit = config.rateLimitPerMinute || 60;
    if (tier === 'free' && limit > limits.rateLimitMax) {
      limit = limits.rateLimitMax;
    } else if (tier === 'pro' && !config.rateLimitPerMinute) {
      limit = limits.rateLimitMax;
    }

    // Determine client key: Bearer token or IP
    let clientKey = req.ip || 'unknown';
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      clientKey = authHeader.slice(7);
    }

    const now = Date.now();
    let bucket = buckets.get(clientKey);

    if (!bucket) {
      bucket = {
        tokens: limit,
        lastRefill: now
      };
      buckets.set(clientKey, bucket);
    }

    // Refill tokens based on time elapsed
    const elapsedMs = now - bucket.lastRefill;
    const elapsedMinutes = elapsedMs / 60000;
    const tokensToAdd = Math.floor(elapsedMinutes * limit);

    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(limit, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }

    // Check if tokens available
    if (bucket.tokens < 1) {
      const retryAfterSeconds = Math.ceil((1 - bucket.tokens) / (limit / 60));
      res.setHeader('Retry-After', retryAfterSeconds.toString());
      return res.status(429).json({
        error: {
          message: 'Rate limit exceeded',
          type: 'rate_limit_error'
        }
      });
    }

    // Consume one token
    bucket.tokens -= 1;
    next();
  };
}
