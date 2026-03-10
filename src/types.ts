import { z } from "zod";

// ── Approach Angles ──────────────────────────────────────────────
export const ANGLES = [
  "analytical",
  "adversarial",
  "lateral",
  "first-principles",
  "pattern-matching",
  "steelmanning",
  "reductio",
  "historical-analogy",
  "constraint-relaxation",
] as const;

export type Angle = (typeof ANGLES)[number];

// ── Spore (Tier 1) ──────────────────────────────────────────────
export const SporeResponseSchema = z.object({
  lean: z.string().describe("1-3 sentence directional signal"),
  keywords: z.array(z.string()).describe("3-8 keywords capturing the direction"),
});

export type SporeResponse = z.infer<typeof SporeResponseSchema>;

export interface Spore {
  id: string;
  angle: Angle;
  generation: number;
  parentId: string | null;
  lean: string;
  keywords: string[];
  vector: number[]; // 32-dim keyword hash vector
  score: number;
  alive: boolean;
}

// ── Scoring ─────────────────────────────────────────────────────
export const ScoreSchema = z.object({
  specificity: z.number().min(0).max(1),
  consistency: z.number().min(0).max(1),
  novelty: z.number().min(0).max(1),
  hedgePenalty: z.number().min(0).max(1),
});

export type ScoreBreakdown = z.infer<typeof ScoreSchema>;

export const SCORE_WEIGHTS = {
  specificity: 0.35,
  consistency: 0.25,
  novelty: 0.25,
  hedgePenalty: -0.15,
} as const;

// ── Clustering ──────────────────────────────────────────────────
export interface Cluster {
  id: number;
  sporeIds: string[];
  centroid: number[];
  dominantAngle: Angle;
  avgScore: number;
}

// ── Mycelium (Tier 2) ──────────────────────────────────────────
export interface MyceliumResult {
  clusterId: number;
  reasoning: string;
  conclusion: string;
  confidence: number;
  angle: Angle;
}

// ── Collapse ────────────────────────────────────────────────────
export type TopologyShape = "convergent" | "bipolar" | "fragmented" | "monocultural";

export interface TopologyAnalysis {
  shape: TopologyShape;
  survivingAngles: Angle[];
  deadAngles: Angle[];
  dominantAngle: Angle | null;
  clusterCount: number;
  generationsSurvived: Record<string, number>; // angle → max gen survived
}

export type ContradictionType = "genuine" | "false-dichotomy" | "irreconcilable";

export interface Contradiction {
  between: [string, string]; // cluster/conclusion summaries
  type: ContradictionType;
  explanation: string;
}

export interface CollapseResult {
  answer: string;
  topology: TopologyAnalysis;
  contradictions: Contradiction[];
  approachBreakdown: Record<Angle, number>; // angle → weight in final answer
  confidence: number;
}

// ── Pheromone Trails ────────────────────────────────────────────
export interface PheromoneEntry {
  angle: Angle;
  direction: string; // short summary of productive direction
  weight: number;
  generation: number;
  timestamp: number; // epoch ms
}

export interface PheromoneTrail {
  promptHash: string;
  entries: PheromoneEntry[];
}

// ── Config ──────────────────────────────────────────────────────
export interface SporeConfig {
  /** Max concurrent API calls */
  concurrency: number;
  /** Number of generation loops */
  generations: number;
  /** Spores per angle per generation */
  sporesPerAngle: number;
  /** Min composite score to survive pruning */
  pruneThreshold: number;
  /** Min cluster density (spore count) to trigger mycelium */
  densityThreshold: number;
  /** Cosine similarity threshold for clustering */
  clusterSimilarity: number;
  /** Enable pheromone trail persistence */
  trails: boolean;
  /** Directory for trail storage */
  trailDir: string;
  /** Print verbose logs */
  verbose: boolean;
  /** Anthropic API key (defaults to env) */
  apiKey?: string;
}

export const DEFAULT_CONFIG: SporeConfig = {
  concurrency: 20,
  generations: 2,
  sporesPerAngle: 1,
  pruneThreshold: 0.3,
  densityThreshold: 2,
  clusterSimilarity: 0.55,
  trails: true,
  trailDir: "./trails",
  verbose: false,
};

// ── Public API ──────────────────────────────────────────────────
export interface ReasonResult {
  answer: string;
  topology: TopologyAnalysis;
  contradictions: Contradiction[];
  approachBreakdown: Record<Angle, number>;
  confidence: number;
  meta: {
    generations: number;
    totalSpores: number;
    survivingSpores: number;
    myceliumCalls: number;
    costEstimate: number;
    wallClockMs: number;
  };
}

export interface SporeEngine {
  reason: (prompt: string) => Promise<ReasonResult>;
}
