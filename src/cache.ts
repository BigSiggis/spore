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
  /** In-memory index for O(1) lookups — not serialized */
  _index: Map<string, CacheEntry>;
}

function cacheKey(promptHash: string, angle: string): string {
  return `${promptHash}:${angle}`;
}

function buildIndex(entries: CacheEntry[]): Map<string, CacheEntry> {
  const index = new Map<string, CacheEntry>();
  for (const e of entries) {
    index.set(cacheKey(e.promptHash, e.angle), e);
  }
  return index;
}

export function hashForCache(prompt: string): string {
  return createHash("sha256").update(prompt.trim().toLowerCase()).digest("hex").slice(0, 24);
}

export function loadCache(trailDir: string): AngleCache {
  const path = join(trailDir, CACHE_FILE);
  if (!existsSync(path)) return { version: 1, entries: [], _index: new Map() };

  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw) as { version: 1; entries: CacheEntry[] };
    // Prune expired entries on load
    const now = Date.now();
    const entries = data.entries.filter((e) => now - e.timestamp < DEFAULT_TTL_MS);
    return { version: 1, entries, _index: buildIndex(entries) };
  } catch {
    return { version: 1, entries: [], _index: new Map() };
  }
}

export function saveCache(trailDir: string, cache: AngleCache): void {
  mkdirSync(trailDir, { recursive: true });
  // Cap entries
  let entries = cache.entries;
  if (entries.length > MAX_ENTRIES) {
    entries = [...entries].sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_ENTRIES);
    cache.entries = entries;
    cache._index = buildIndex(entries);
  }
  const path = join(trailDir, CACHE_FILE);
  // Don't serialize _index
  writeFileSync(path, JSON.stringify({ version: cache.version, entries: cache.entries }, null, 2), "utf-8");
}

export function getCached(
  cache: AngleCache,
  promptHash: string,
  angle: string
): SporeResponse | null {
  const entry = cache._index.get(cacheKey(promptHash, angle));
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
  const key = cacheKey(promptHash, angle);
  // Remove existing entry if present
  const existing = cache._index.get(key);
  if (existing) {
    cache.entries = cache.entries.filter((e) => e !== existing);
  }
  const entry: CacheEntry = { promptHash, angle, response, timestamp: Date.now() };
  cache.entries.push(entry);
  cache._index.set(key, entry);
}
