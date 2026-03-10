import type { Spore, ScoreBreakdown, SCORE_WEIGHTS } from "./types.js";
import type { SporeClient } from "./client.js";

const WEIGHTS = {
  specificity: 0.35,
  consistency: 0.25,
  novelty: 0.25,
  hedgePenalty: -0.15,
} as const;

function computeComposite(breakdown: ScoreBreakdown): number {
  return (
    breakdown.specificity * WEIGHTS.specificity +
    breakdown.consistency * WEIGHTS.consistency +
    breakdown.novelty * WEIGHTS.novelty +
    breakdown.hedgePenalty * WEIGHTS.hedgePenalty
  );
}

// Score a batch of spores using a single Haiku call for efficiency
export async function scoreSpores(
  client: SporeClient,
  spores: Spore[],
  prompt: string
): Promise<Map<string, { breakdown: ScoreBreakdown; composite: number }>> {
  if (spores.length === 0) return new Map();

  const batchEntries = spores
    .map(
      (s, i) =>
        `[${i}] angle=${s.angle} | "${s.lean}" | keywords: ${s.keywords.join(", ")}`
    )
    .join("\n");

  const systemPrompt = `You are a scoring judge. Score each entry on 4 dimensions (0.0-1.0).
Return ONLY a JSON array of objects in order, one per entry:
[{"specificity":N,"consistency":N,"novelty":N,"hedgePenalty":N}, ...]

Rubric:
- specificity: Concrete, falsifiable claims score high. Vague "it depends" scores near 0.
- consistency: Internal logical coherence of the reasoning.
- novelty: How different from siblings in the batch. Repetitive ideas score low.
- hedgePenalty: Weasel words ("arguably", "it could be said", "perhaps") increase this score toward 1.0.`;

  const userPrompt = `Original question: "${prompt}"

Score these ${spores.length} reasoning probes:
${batchEntries}`;

  const raw = await client.callHaiku(systemPrompt, userPrompt, 800, 0.3);

  const results = new Map<
    string,
    { breakdown: ScoreBreakdown; composite: number }
  >();

  try {
    // Extract JSON array from response
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array found");

    const parsed = JSON.parse(jsonMatch[0]) as ScoreBreakdown[];

    for (let i = 0; i < spores.length; i++) {
      const scores = parsed[i];
      if (!scores) continue;

      const breakdown: ScoreBreakdown = {
        specificity: clamp(scores.specificity ?? 0.5),
        consistency: clamp(scores.consistency ?? 0.5),
        novelty: clamp(scores.novelty ?? 0.5),
        hedgePenalty: clamp(scores.hedgePenalty ?? 0.3),
      };

      results.set(spores[i].id, {
        breakdown,
        composite: computeComposite(breakdown),
      });
    }
  } catch {
    // Fallback: give everyone a mid-range score
    for (const s of spores) {
      const breakdown: ScoreBreakdown = {
        specificity: 0.5,
        consistency: 0.5,
        novelty: 0.5,
        hedgePenalty: 0.3,
      };
      results.set(s.id, {
        breakdown,
        composite: computeComposite(breakdown),
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
  pruneThreshold: number
): void {
  for (const spore of spores) {
    const result = scores.get(spore.id);
    if (result) {
      spore.score = result.composite;
      if (result.composite < pruneThreshold) {
        spore.alive = false;
      }
    }
  }
}
