import { createHash } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { PheromoneTrail, PheromoneEntry, Spore } from "./types.js";

const DECAY_RATE = 0.15; // weight * (1 - 0.15)^days

export function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt.trim().toLowerCase()).digest("hex").slice(0, 16);
}

export function loadTrail(trailDir: string, promptHash: string): PheromoneTrail | null {
  const path = join(trailDir, `${promptHash}.json`);
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, "utf-8");
    const trail = JSON.parse(raw) as PheromoneTrail;

    // Apply decay
    const now = Date.now();
    trail.entries = trail.entries
      .map((e) => {
        const daysSince = (now - e.timestamp) / (1000 * 60 * 60 * 24);
        return {
          ...e,
          weight: e.weight * Math.pow(1 - DECAY_RATE, daysSince),
        };
      })
      .filter((e) => e.weight > 0.01); // Dead after ~30 days

    return trail;
  } catch {
    return null;
  }
}

export function saveTrail(
  trailDir: string,
  promptHash: string,
  trail: PheromoneTrail
): void {
  mkdirSync(trailDir, { recursive: true });
  const path = join(trailDir, `${promptHash}.json`);
  writeFileSync(path, JSON.stringify(trail, null, 2), "utf-8");
}

// Build pheromone entries from surviving spores after a reasoning run
export function buildEntries(
  survivingSpores: Spore[],
  generation: number
): PheromoneEntry[] {
  const now = Date.now();
  const entries: PheromoneEntry[] = [];

  // Group by angle, take the highest-scoring spore per angle
  const byAngle = new Map<string, Spore>();
  for (const s of survivingSpores) {
    const existing = byAngle.get(s.angle);
    if (!existing || s.score > existing.score) {
      byAngle.set(s.angle, s);
    }
  }

  for (const [, spore] of byAngle) {
    entries.push({
      angle: spore.angle,
      direction: spore.lean.slice(0, 200),
      weight: spore.score,
      generation,
      timestamp: now,
    });
  }

  return entries;
}

export function mergeTrails(
  existing: PheromoneTrail | null,
  promptHash: string,
  newEntries: PheromoneEntry[]
): PheromoneTrail {
  const trail: PheromoneTrail = existing ?? {
    promptHash,
    entries: [],
  };

  trail.entries.push(...newEntries);

  // Cap total entries to prevent unbounded growth
  if (trail.entries.length > 100) {
    trail.entries.sort((a, b) => b.weight - a.weight);
    trail.entries = trail.entries.slice(0, 50);
  }

  return trail;
}
