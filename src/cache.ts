import { createHash } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { Angle, SporeResponse } from "./types.js";

const CACHE_FILE = "angle-cache.json";
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 4; // 4 hours
const MAX_ENTRIES = 500;

export interface CacheEntry {
  promptHash: string;
  angle: string;
  response: SporeResponse;
  timestamp: number;
}

export interface AngleCache {
  version: 1;
  entries: CacheEntry[];
}

function cacheKey(promptHash: string, angle: string): string {
  return `${promptHash}:${angle}`;
}

export function hashForCache(prompt: string): string {
  return createHash("sha256").update(prompt.trim().toLowerCase()).digest("hex").slice(0, 24);
}

export function loadCache(trailDir: string): AngleCache {
  const path = join(trailDir, CACHE_FILE);
  if (!existsSync(path)) return { version: 1, entries: [] };

  try {
    const raw = readFileSync(path, "utf-8");
    const cache = JSON.parse(raw) as AngleCache;
    // Prune expired entries on load
    const now = Date.now();
    cache.entries = cache.entries.filter((e) => now - e.timestamp < DEFAULT_TTL_MS);
    return cache;
  } catch {
    return { version: 1, entries: [] };
  }
}

export function saveCache(trailDir: string, cache: AngleCache): void {
  mkdirSync(trailDir, { recursive: true });
  // Cap entries
  if (cache.entries.length > MAX_ENTRIES) {
    cache.entries.sort((a, b) => b.timestamp - a.timestamp);
    cache.entries = cache.entries.slice(0, MAX_ENTRIES);
  }
  const path = join(trailDir, CACHE_FILE);
  writeFileSync(path, JSON.stringify(cache, null, 2), "utf-8");
}

export function getCached(
  cache: AngleCache,
  promptHash: string,
  angle: string
): SporeResponse | null {
  const key = cacheKey(promptHash, angle);
  const entry = cache.entries.find(
    (e) => cacheKey(e.promptHash, e.angle) === key
  );
  if (!entry) return null;
  // Check TTL
  if (Date.now() - entry.timestamp > DEFAULT_TTL_MS) return null;
  return entry.response;
}

export function setCache(
  cache: AngleCache,
  promptHash: string,
  angle: string,
  response: SporeResponse
): void {
  // Remove existing entry for this key if present
  const key = cacheKey(promptHash, angle);
  cache.entries = cache.entries.filter(
    (e) => cacheKey(e.promptHash, e.angle) !== key
  );
  cache.entries.push({
    promptHash,
    angle,
    response,
    timestamp: Date.now(),
  });
}
