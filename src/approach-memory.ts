import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { Angle } from "./types.js";
import { ANGLES } from "./types.js";
import type { SporeClient } from "./client.js";

// ── Data Model ──────────────────────────────────────────────────

export interface AngleStats {
  angle: Angle;
  totalRuns: number;
  survivalCount: number;
  avgScore: number;
  topicAffinity: Record<string, number>; // topic → affinity score
  confidenceCorrelation: number; // how well high scores correlate with high confidence
  contradictionValue: number; // genuine contradictions = valuable, false-dichotomy = noisy
  lastUpdated: number; // epoch ms
}

export interface ApproachMemory {
  version: 1;
  angles: Record<string, AngleStats>;
  totalRuns: number;
}

export interface RunData {
  survivingAngles: Angle[];
  angleScores: Record<string, number>; // angle → best score
  topicTag?: string;
  confidence?: number;
  contradictions?: Array<{ type: string }>;
}

const MEMORY_FILE = "approach-memory.json";
const WEEKLY_DECAY = 0.05; // 5% weekly decay (slower than pheromone's 15% daily)

// ── Load / Save ─────────────────────────────────────────────────

function createDefaults(): ApproachMemory {
  const angles: Record<string, AngleStats> = {};
  for (const angle of ANGLES) {
    angles[angle] = {
      angle,
      totalRuns: 0,
      survivalCount: 0,
      avgScore: 0.5,
      topicAffinity: {},
      confidenceCorrelation: 0,
      contradictionValue: 0,
      lastUpdated: Date.now(),
    };
  }
  return { version: 1, angles, totalRuns: 0 };
}

export function loadApproachMemory(trailDir: string): ApproachMemory {
  const path = join(trailDir, MEMORY_FILE);
  if (!existsSync(path)) return createDefaults();

  try {
    const raw = readFileSync(path, "utf-8");
    const memory = JSON.parse(raw) as ApproachMemory;

    // Apply weekly decay to all angle stats
    const now = Date.now();
    for (const key of Object.keys(memory.angles)) {
      const stats = memory.angles[key];
      const weeksSince = (now - stats.lastUpdated) / (1000 * 60 * 60 * 24 * 7);
      if (weeksSince > 0) {
        const decay = Math.pow(1 - WEEKLY_DECAY, weeksSince);
        // Decay avgScore toward 0.5 (neutral)
        stats.avgScore = 0.5 + (stats.avgScore - 0.5) * decay;
        // Decay topic affinities
        for (const topic of Object.keys(stats.topicAffinity)) {
          stats.topicAffinity[topic] *= decay;
          if (stats.topicAffinity[topic] < 0.05) {
            delete stats.topicAffinity[topic];
          }
        }
      }
    }

    // Ensure any new angles get defaults
    for (const angle of ANGLES) {
      if (!memory.angles[angle]) {
        memory.angles[angle] = {
          angle,
          totalRuns: 0,
          survivalCount: 0,
          avgScore: 0.5,
          topicAffinity: {},
          confidenceCorrelation: 0,
          contradictionValue: 0,
          lastUpdated: Date.now(),
        };
      }
    }

    return memory;
  } catch {
    return createDefaults();
  }
}

export function saveApproachMemory(trailDir: string, memory: ApproachMemory): void {
  mkdirSync(trailDir, { recursive: true });
  const path = join(trailDir, MEMORY_FILE);
  writeFileSync(path, JSON.stringify(memory, null, 2), "utf-8");
}

// ── Update after a reasoning run ────────────────────────────────

export function updateApproachMemory(
  memory: ApproachMemory,
  runData: RunData
): void {
  memory.totalRuns++;
  const now = Date.now();

  // Only track angles that were actually used in this run
  const anglesUsed = new Set(Object.keys(runData.angleScores));

  for (const angle of ANGLES) {
    const stats = memory.angles[angle];

    // Skip angles that weren't part of this run
    if (!anglesUsed.has(angle)) continue;

    stats.totalRuns++;

    const survived = runData.survivingAngles.includes(angle);
    if (survived) stats.survivalCount++;

    const score = runData.angleScores[angle];
    if (score !== undefined) {
      // Running average
      stats.avgScore =
        stats.avgScore * ((stats.totalRuns - 1) / stats.totalRuns) +
        score * (1 / stats.totalRuns);
    }

    // Update topic affinity
    if (runData.topicTag && survived) {
      const prev = stats.topicAffinity[runData.topicTag] ?? 0;
      stats.topicAffinity[runData.topicTag] = prev + (score ?? 0.5);
    }

    // Confidence correlation: did high-scoring angles correlate with high final confidence?
    if (survived && score !== undefined && runData.confidence !== undefined) {
      const correlation = score * runData.confidence; // high when both are high
      stats.confidenceCorrelation =
        stats.confidenceCorrelation * 0.9 + correlation * 0.1; // EMA
    }

    // Contradiction value: genuine contradictions from this angle are valuable
    if (survived && runData.contradictions) {
      const genuine = runData.contradictions.filter(
        (c) => c.type === "genuine"
      ).length;
      const falseDichotomy = runData.contradictions.filter(
        (c) => c.type === "false-dichotomy"
      ).length;
      // Genuine contradictions increase value, false dichotomies decrease it
      const delta = genuine * 0.1 - falseDichotomy * 0.05;
      stats.contradictionValue = Math.max(
        -1,
        Math.min(1, stats.contradictionValue + delta)
      );
    }

    stats.lastUpdated = now;
  }
}

// ── Compute per-angle weights ───────────────────────────────────

export function getAngleWeights(
  memory: ApproachMemory,
  topicTag?: string
): Record<string, number> {
  const weights: Record<string, number> = {};

  for (const angle of ANGLES) {
    const stats = memory.angles[angle];

    if (stats.totalRuns === 0) {
      weights[angle] = 1.0; // no data = neutral
      continue;
    }

    const survivalRate = stats.survivalCount / stats.totalRuns;
    let weight = 0.5 + survivalRate * 0.5; // base: 0.5-1.0

    // Boost by avg score
    weight *= 0.7 + stats.avgScore * 0.6; // 0.7-1.3 multiplier

    // Topic affinity boost
    if (topicTag && stats.topicAffinity[topicTag]) {
      const affinity = Math.min(stats.topicAffinity[topicTag], 5) / 5;
      weight *= 1 + affinity * 0.3; // up to 30% boost
    }

    // Floor: never fully suppress an angle
    weights[angle] = Math.max(0.3, weight);
  }

  return weights;
}

// ── User Feedback ───────────────────────────────────────────────

export type FeedbackType = "good" | "bad" | "partial";

export function applyFeedback(
  memory: ApproachMemory,
  feedback: FeedbackType,
  anglesUsed: string[]
): void {
  const multiplier = feedback === "good" ? 1.15 : feedback === "bad" ? 0.85 : 1.0;

  for (const angle of anglesUsed) {
    const stats = memory.angles[angle];
    if (!stats) continue;

    stats.avgScore *= multiplier;
    // Clamp to reasonable range
    stats.avgScore = Math.max(0.1, Math.min(0.95, stats.avgScore));
    stats.lastUpdated = Date.now();
  }
}

// ── Topic Classification ────────────────────────────────────────

const TOPIC_BUCKETS = [
  "architecture",
  "security",
  "performance",
  "comparison",
  "debugging",
  "design",
  "strategy",
  "implementation",
  "general",
] as const;

export async function classifyTopic(
  client: SporeClient,
  prompt: string
): Promise<string> {
  const systemPrompt = `Classify this prompt into exactly one topic bucket. Respond with ONLY the topic name, nothing else.
Topics: ${TOPIC_BUCKETS.join(", ")}`;

  try {
    const raw = await client.callHaiku(systemPrompt, prompt, 20, 0.1);
    const topic = raw.trim().toLowerCase();
    if (TOPIC_BUCKETS.includes(topic as any)) return topic;
    return "general";
  } catch {
    return "general";
  }
}
