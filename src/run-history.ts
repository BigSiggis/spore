import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { TopologyShape, Angle } from "./types.js";

const HISTORY_FILE = "run-history.json";
const MAX_RUNS = 200;

export interface RunRecord {
  timestamp: number;
  promptHash: string;
  promptPreview: string;
  estimatedCost: number;
  actualCost: number;
  generations: number;
  totalSpores: number;
  survivingSpores: number;
  myceliumCalls: number;
  wallClockMs: number;
  confidence: number;
  topologyShape: TopologyShape;
  anglesUsed: string[];
  dominantAngle: string | null;
  hadCodeContext: boolean;
}

export interface RunHistory {
  version: 1;
  runs: RunRecord[];
}

export interface RunStats {
  totalRuns: number;
  totalCost: number;
  avgCost: number;
  avgConfidence: number;
  avgWallClockMs: number;
  estimateAccuracy: number; // ratio of actual/estimated (1.0 = perfect)
  topologyDistribution: Record<TopologyShape, number>;
  costLast7d: number;
  costLast30d: number;
}

export function loadRunHistory(trailDir: string): RunHistory {
  const path = join(trailDir, HISTORY_FILE);
  if (!existsSync(path)) return { version: 1, runs: [] };

  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as RunHistory;
  } catch {
    return { version: 1, runs: [] };
  }
}

export function saveRunHistory(trailDir: string, history: RunHistory): void {
  mkdirSync(trailDir, { recursive: true });
  // Cap runs
  if (history.runs.length > MAX_RUNS) {
    history.runs = history.runs.slice(-MAX_RUNS);
  }
  const path = join(trailDir, HISTORY_FILE);
  writeFileSync(path, JSON.stringify(history, null, 2), "utf-8");
}

export function recordRun(history: RunHistory, record: RunRecord): void {
  history.runs.push(record);
}

export function getRunStats(history: RunHistory): RunStats {
  const runs = history.runs;
  if (runs.length === 0) {
    return {
      totalRuns: 0,
      totalCost: 0,
      avgCost: 0,
      avgConfidence: 0,
      avgWallClockMs: 0,
      estimateAccuracy: 1.0,
      topologyDistribution: { convergent: 0, bipolar: 0, fragmented: 0, monocultural: 0 },
      costLast7d: 0,
      costLast30d: 0,
    };
  }

  const totalCost = runs.reduce((s, r) => s + r.actualCost, 0);
  const avgCost = totalCost / runs.length;
  const avgConfidence = runs.reduce((s, r) => s + r.confidence, 0) / runs.length;
  const avgWallClockMs = runs.reduce((s, r) => s + r.wallClockMs, 0) / runs.length;

  // Estimate accuracy: how close were pre-flight estimates to actuals?
  const runsWithEstimates = runs.filter((r) => r.estimatedCost > 0);
  const estimateAccuracy = runsWithEstimates.length > 0
    ? runsWithEstimates.reduce((s, r) => s + r.actualCost / r.estimatedCost, 0) / runsWithEstimates.length
    : 1.0;

  const topologyDistribution: Record<TopologyShape, number> = {
    convergent: 0, bipolar: 0, fragmented: 0, monocultural: 0,
  };
  for (const r of runs) {
    topologyDistribution[r.topologyShape] = (topologyDistribution[r.topologyShape] ?? 0) + 1;
  }

  const now = Date.now();
  const costLast7d = runs
    .filter((r) => now - r.timestamp < 7 * 24 * 60 * 60 * 1000)
    .reduce((s, r) => s + r.actualCost, 0);
  const costLast30d = runs
    .filter((r) => now - r.timestamp < 30 * 24 * 60 * 60 * 1000)
    .reduce((s, r) => s + r.actualCost, 0);

  return {
    totalRuns: runs.length,
    totalCost,
    avgCost,
    avgConfidence,
    avgWallClockMs,
    estimateAccuracy,
    topologyDistribution,
    costLast7d,
    costLast30d,
  };
}
