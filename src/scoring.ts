import type { Spore, ScoreBreakdown } from "./types.js";
import type { SporeClient } from "./client.js";

const GENERAL_WEIGHTS = {
  specificity: 0.30,
  consistency: 0.30,
  novelty: 0.25,
  hedgePenalty: -0.10,
} as const;

// Code-aware weights: add actionability + severity accuracy, reduce general proportionally
const CODE_WEIGHTS = {
  specificity: 0.20,
  consistency: 0.15,
  novelty: 0.15,
  hedgePenalty: -0.10,
  actionability: 0.25,
  severityAccuracy: 0.15,
} as const;

export interface CodeScoreBreakdown extends ScoreBreakdown {
  actionability: number;
  severityAccuracy: number;
}

function computeComposite(breakdown: ScoreBreakdown, hasCodeContext?: boolean): number {
  if (hasCodeContext && "actionability" in breakdown) {
    const cb = breakdown as CodeScoreBreakdown;
    return (
      cb.specificity * CODE_WEIGHTS.specificity +
      cb.consistency * CODE_WEIGHTS.consistency +
      cb.novelty * CODE_WEIGHTS.novelty +
      cb.hedgePenalty * CODE_WEIGHTS.hedgePenalty +
      cb.actionability * CODE_WEIGHTS.actionability +
      cb.severityAccuracy * CODE_WEIGHTS.severityAccuracy
    );
  }
  return (
    breakdown.specificity * GENERAL_WEIGHTS.specificity +
    breakdown.consistency * GENERAL_WEIGHTS.consistency +
    breakdown.novelty * GENERAL_WEIGHTS.novelty +
    breakdown.hedgePenalty * GENERAL_WEIGHTS.hedgePenalty
  );
}

// Score a batch of spores using a single Haiku call for efficiency
export async function scoreSpores(
  client: SporeClient,
  spores: Spore[],
  prompt: string,
  hasCodeContext?: boolean
): Promise<Map<string, { breakdown: ScoreBreakdown; composite: number }>> {
  if (spores.length === 0) return new Map();

  const batchEntries = spores
    .map(
      (s, i) =>
        `[${i}] angle=${s.angle} | "${s.lean}" | keywords: ${s.keywords.join(", ")}`
    )
    .join("\n");

  const codeDimensions = hasCodeContext
    ? `\n- actionability: Does it identify a concrete, fixable issue? Vague observations score low, specific fix recommendations score high.
- severityAccuracy: Is the severity assessment calibrated? Inflating minor issues or downplaying critical ones scores low.`
    : "";

  const codeFields = hasCodeContext
    ? `,"actionability":N,"severityAccuracy":N`
    : "";

  const systemPrompt = `You are a scoring judge. Score each entry on ${hasCodeContext ? "6" : "4"} dimensions (0.0-1.0).
Return ONLY a JSON array of objects in order, one per entry:
[{"specificity":N,"consistency":N,"novelty":N,"hedgePenalty":N${codeFields}}, ...]

Rubric:
- specificity: Concrete, falsifiable claims score high. Vague "it depends" scores near 0.
- consistency: Internal logical coherence of the reasoning.
- novelty: How different from siblings in the batch. Repetitive ideas score low.
- hedgePenalty: Weasel words ("arguably", "it could be said", "perhaps") increase this score toward 1.0.${codeDimensions}`;

  const userPrompt = `Original question: "${prompt}"

Score these ${spores.length} reasoning probes:
${batchEntries}`;

  const raw = await client.callHaiku(systemPrompt, userPrompt, 1200, 0.3);

  const results = new Map<
    string,
    { breakdown: ScoreBreakdown; composite: number }
  >();

  try {
    // Extract JSON array from response
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array found");

    const parsed = JSON.parse(jsonMatch[0]) as any[];

    for (let i = 0; i < spores.length; i++) {
      const scores = parsed[i];
      if (!scores) continue;

      const breakdown: any = {
        specificity: clamp(scores.specificity ?? 0.5),
        consistency: clamp(scores.consistency ?? 0.5),
        novelty: clamp(scores.novelty ?? 0.5),
        hedgePenalty: clamp(scores.hedgePenalty ?? 0.3),
      };

      if (hasCodeContext) {
        breakdown.actionability = clamp(scores.actionability ?? 0.5);
        breakdown.severityAccuracy = clamp(scores.severityAccuracy ?? 0.5);
      }

      results.set(spores[i].id, {
        breakdown,
        composite: computeComposite(breakdown, hasCodeContext),
      });
    }
  } catch {
    // Fallback: give everyone a mid-range score
    for (const s of spores) {
      const breakdown: any = {
        specificity: 0.5,
        consistency: 0.5,
        novelty: 0.5,
        hedgePenalty: 0.3,
      };
      if (hasCodeContext) {
        breakdown.actionability = 0.5;
        breakdown.severityAccuracy = 0.5;
      }
      results.set(s.id, {
        breakdown,
        composite: computeComposite(breakdown, hasCodeContext),
      });
    }
  }

  return results;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function applyScores(
  spores: Spore[],
  scores: Map<string, { breakdown: ScoreBreakdown; composite: number }>,
  pruneThreshold: number,
  minSurvivors = 3
): void {
  // Apply scores and initial pruning
  for (const spore of spores) {
    const result = scores.get(spore.id);
    if (result) {
      spore.score = result.composite;
      if (result.composite < pruneThreshold) {
        spore.alive = false;
      }
    }
  }

  // Guarantee minimum survivors — keep the top N by score even if below threshold
  const alive = spores.filter((s) => s.alive);
  if (alive.length < minSurvivors) {
    const dead = spores
      .filter((s) => !s.alive)
      .sort((a, b) => b.score - a.score);

    const needed = minSurvivors - alive.length;
    for (let i = 0; i < Math.min(needed, dead.length); i++) {
      dead[i].alive = true;
    }
  }
}
