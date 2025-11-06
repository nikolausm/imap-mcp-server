/**
 * Memory Management Utilities
 *
 * Provides LRU and TTL-based eviction policies to prevent unbounded memory growth.
 * Addresses Issue #22 - Unbounded Memory Growth.
 *
 * Author: Colin Bitterfield
 * Email: colin.bitterfield@templeofepiphany.com
 * Version: 2.5.1
 * Date: 2025-11-05
 */

export interface LRUCacheOptions {
  maxSize: number;
  onEvict?: (key: string, value: any) => void;
}

export interface TTLCacheOptions {
  ttl: number; // Time to live in milliseconds
  checkInterval?: number; // How often to check for expired entries (ms)
  onExpire?: (key: string, value: any) => void;
}

/**
 * LRU (Least Recently Used) Cache
 * Evicts the least recently used items when max size is reached
 */
export class LRUCache<K, V> {
  private cache: Map<K, V> = new Map();
  private accessOrder: K[] = [];
  private options: LRUCacheOptions;

  constructor(options: LRUCacheOptions) {
    this.options = options;
  }

  set(key: K, value: V): void {
    // Remove from access order if exists
    const existingIndex = this.accessOrder.indexOf(key);
    if (existingIndex >= 0) {
      this.accessOrder.splice(existingIndex, 1);
    }

    // Add to end (most recently used)
    this.cache.set(key, value);
    this.accessOrder.push(key);

    // Evict if over size
    if (this.cache.size > this.options.maxSize) {
      this.evictLRU();
    }
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      const index = this.accessOrder.indexOf(key);
      if (index >= 0) {
        this.accessOrder.splice(index, 1);
        this.accessOrder.push(key);
      }
    }
    return value;
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    const index = this.accessOrder.indexOf(key);
    if (index >= 0) {
      this.accessOrder.splice(index, 1);
    }
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  get size(): number {
    return this.cache.size;
  }

  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  values(): IterableIterator<V> {
    return this.cache.values();
  }

  entries(): IterableIterator<[K, V]> {
    return this.cache.entries();
  }

  private evictLRU(): void {
    // Remove least recently used (first in array)
    const lruKey = this.accessOrder.shift();
    if (lruKey !== undefined) {
      const evictedValue = this.cache.get(lruKey);
      this.cache.delete(lruKey);

      if (this.options.onEvict && evictedValue !== undefined) {
        this.options.onEvict(String(lruKey), evictedValue);
      }
    }
  }
}

/**
 * TTL (Time To Live) Cache
 * Automatically expires entries after a specified time
 */
export class TTLCache<K, V> {
  private cache: Map<K, { value: V; expireAt: number }> = new Map();
  private cleanupInterval?: NodeJS.Timeout;
  private options: TTLCacheOptions;

  constructor(options: TTLCacheOptions) {
    this.options = options;

    // Start periodic cleanup
    const interval = options.checkInterval || 60000; // Default 1 minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, interval);
  }

  set(key: K, value: V, customTTL?: number): void {
    const ttl = customTTL || this.options.ttl;
    const expireAt = Date.now() + ttl;

    this.cache.set(key, { value, expireAt });
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expireAt) {
      this.cache.delete(key);
      if (this.options.onExpire) {
        this.options.onExpire(String(key), entry.value);
      }
      return undefined;
    }

    return entry.value;
  }

  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    // Check if expired
    if (Date.now() > entry.expireAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  keys(): K[] {
    return Array.from(this.cache.keys());
  }

  values(): V[] {
    const values: V[] = [];
    for (const entry of this.cache.values()) {
      if (Date.now() <= entry.expireAt) {
        values.push(entry.value);
      }
    }
    return values;
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    const expiredKeys: K[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expireAt) {
        expiredKeys.push(key);
        if (this.options.onExpire) {
          this.options.onExpire(String(key), entry.value);
        }
      }
    }

    for (const key of expiredKeys) {
      this.cache.delete(key);
    }

    if (expiredKeys.length > 0) {
      console.error(`[TTLCache] Cleaned up ${expiredKeys.length} expired entries`);
    }
  }

  /**
   * Stop the cleanup interval (call when shutting down)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }
}

/**
 * Combined LRU + TTL Cache
 * Provides both size-based and time-based eviction
 */
export class HybridCache<K, V> {
  private cache: Map<K, { value: V; expireAt: number; lastAccessed: number }> = new Map();
  private accessOrder: K[] = [];
  private maxSize: number;
  private ttl: number;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(maxSize: number, ttl: number, checkInterval = 60000) {
    this.maxSize = maxSize;
    this.ttl = ttl;

    // Start periodic cleanup for TTL
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, checkInterval);
  }

  set(key: K, value: V): void {
    const expireAt = Date.now() + this.ttl;
    const lastAccessed = Date.now();

    // Remove from access order if exists
    const existingIndex = this.accessOrder.indexOf(key);
    if (existingIndex >= 0) {
      this.accessOrder.splice(existingIndex, 1);
    }

    // Add to cache and access order
    this.cache.set(key, { value, expireAt, lastAccessed });
    this.accessOrder.push(key);

    // Evict LRU if over size
    if (this.cache.size > this.maxSize) {
      this.evictLRU();
    }
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expireAt) {
      this.cache.delete(key);
      const index = this.accessOrder.indexOf(key);
      if (index >= 0) {
        this.accessOrder.splice(index, 1);
      }
      return undefined;
    }

    // Update last accessed and move to end
    entry.lastAccessed = Date.now();
    const index = this.accessOrder.indexOf(key);
    if (index >= 0) {
      this.accessOrder.splice(index, 1);
      this.accessOrder.push(key);
    }

    return entry.value;
  }

  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }
    return Date.now() <= entry.expireAt;
  }

  delete(key: K): boolean {
    const index = this.accessOrder.indexOf(key);
    if (index >= 0) {
      this.accessOrder.splice(index, 1);
    }
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  get size(): number {
    return this.cache.size;
  }

  private evictLRU(): void {
    const lruKey = this.accessOrder.shift();
    if (lruKey !== undefined) {
      this.cache.delete(lruKey);
      console.error(`[HybridCache] Evicted LRU entry: ${String(lruKey)}`);
    }
  }

  private cleanupExpired(): void {
    const now = Date.now();
    const expiredKeys: K[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expireAt) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      const index = this.accessOrder.indexOf(key);
      if (index >= 0) {
        this.accessOrder.splice(index, 1);
      }
      this.cache.delete(key);
    }

    if (expiredKeys.length > 0) {
      console.error(`[HybridCache] Cleaned up ${expiredKeys.length} expired entries`);
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }
}
