// Simple in-memory cache for AI responses
// Key: hash of (companyId + question/type)
// Value: { response, timestamp }

import { AI_CONFIG } from './ai.config';

interface CacheEntry {
  readonly response: string;
  readonly timestamp: number;
}

// Rate tracking per company per day
interface RateEntry {
  readonly count: number;
  readonly date: string; // YYYY-MM-DD
}

const responseCache = new Map<string, CacheEntry>();
const rateLimits = new Map<string, RateEntry>();

function hashKey(companyId: string, input: string): string {
  // Simple hash for cache key - deterministic, not cryptographic
  const str = `${companyId}:${input.toLowerCase().trim()}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `ai_cache_${Math.abs(hash).toString(36)}`;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getCachedResponse(companyId: string, input: string): string | null {
  const key = hashKey(companyId, input);
  const entry = responseCache.get(key);
  if (!entry) return null;

  const age = (Date.now() - entry.timestamp) / 1000;
  if (age > AI_CONFIG.cacheTtlSeconds) {
    responseCache.delete(key);
    return null;
  }

  return entry.response;
}

export function setCachedResponse(companyId: string, input: string, response: string): void {
  const key = hashKey(companyId, input);
  responseCache.set(key, { response, timestamp: Date.now() });

  // Evict old entries if cache gets too large (max 1000 entries)
  if (responseCache.size > 1000) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey) responseCache.delete(oldestKey);
  }
}

export function checkRateLimit(companyId: string): { allowed: boolean; remaining: number } {
  const today = todayKey();
  const entry = rateLimits.get(companyId);

  if (!entry || entry.date !== today) {
    return { allowed: true, remaining: AI_CONFIG.maxQueriesPerDay };
  }

  const remaining = AI_CONFIG.maxQueriesPerDay - entry.count;
  return { allowed: remaining > 0, remaining: Math.max(0, remaining) };
}

export function incrementRateLimit(companyId: string): void {
  const today = todayKey();
  const entry = rateLimits.get(companyId);

  if (!entry || entry.date !== today) {
    rateLimits.set(companyId, { count: 1, date: today });
  } else {
    rateLimits.set(companyId, { count: entry.count + 1, date: today });
  }
}

// Cleanup stale entries (call periodically)
export function cleanupCache(): void {
  const now = Date.now();
  const maxAge = AI_CONFIG.cacheTtlSeconds * 1000;

  for (const [key, entry] of responseCache.entries()) {
    if (now - entry.timestamp > maxAge) {
      responseCache.delete(key);
    }
  }

  // Clean old rate limit entries
  const today = todayKey();
  for (const [key, entry] of rateLimits.entries()) {
    if (entry.date !== today) {
      rateLimits.delete(key);
    }
  }
}
