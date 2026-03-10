import { createHash } from "crypto";
import type { Spore, Angle, SporeResponse, PheromoneEntry } from "./types.js";
import { ANGLES } from "./types.js";
import type { SporeClient } from "./client.js";
import { keywordsToVector } from "./density.js";

let sporeCounter = 0;

function makeId(gen: number, angle: Angle): string {
  return `spore-${gen}-${angle}-${sporeCounter++}`;
}

const ANGLE_PROMPTS: Record<Angle, string> = {
  analytical:
    "Break this down systematically. What are the key variables and how do they interact?",
  adversarial:
    "What's wrong with the obvious answer? Find the weaknesses, blind spots, and failure modes.",
  lateral:
    "Come at this from a completely unexpected direction. What analogies or connections does everyone miss?",
  "first-principles":
    "Strip away assumptions. What are the fundamental truths here, and what can we build up from them?",
  "pattern-matching":
    "What does this remind you of? What historical or domain patterns apply here?",
  steelmanning:
    "What's the strongest possible case for the least popular position on this?",
  reductio:
    "Take the obvious answer to its logical extreme. Where does it break down?",
  "historical-analogy":
    "What historical precedents illuminate this? What happened in similar situations?",
  "constraint-relaxation":
    "What if we removed the biggest constraint? What becomes possible, and does that reveal the real problem?",
};

function buildSporePrompt(
  angle: Angle,
  prompt: string,
  parentLean?: string,
  pheromoneBias?: string
): string {
  let p = `QUESTION: ${prompt}\n\nAPPROACH (${angle}): ${ANGLE_PROMPTS[angle]}`;

  if (parentLean) {
    p += `\n\nBuild on this prior insight: "${parentLean}"`;
  }

  if (pheromoneBias) {
    p += `\n\nHistorical signal (soft hint, not binding): ${pheromoneBias}`;
  }

  p += `\n\nRespond with ONLY valid JSON: {"lean":"1-3 sentence directional signal","keywords":["3-8 keywords"]}`;
  return p;
}

function parseSporeResponse(raw: string): SporeResponse {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      lean: String(parsed.lean ?? "").slice(0, 500),
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.map(String).slice(0, 8)
        : [],
    };
  } catch {
    // Best-effort: use the raw text as lean, extract words as keywords
    const words = raw
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5);
    return {
      lean: raw.slice(0, 300),
      keywords: words,
    };
  }
}

// Spawn gen-0 spores: 2 probes per angle x 9 angles = 18 parallel calls
export async function spawnGeneration(
  client: SporeClient,
  prompt: string,
  generation: number,
  sporesPerAngle: number,
  parents?: Spore[],
  pheromones?: PheromoneEntry[],
  verbose?: boolean
): Promise<Spore[]> {
  const tasks: Promise<Spore>[] = [];

  if (generation === 0 || !parents) {
    // Gen-0: fresh probes across all angles
    for (const angle of ANGLES) {
      // Build pheromone bias for this angle
      const anglePheromones = pheromones?.filter((p) => p.angle === angle);
      const biasStr =
        anglePheromones && anglePheromones.length > 0
          ? anglePheromones
              .sort((a, b) => b.weight - a.weight)
              .slice(0, 3)
              .map((p) => p.direction)
              .join("; ")
          : undefined;

      for (let i = 0; i < sporesPerAngle; i++) {
        const id = makeId(generation, angle);
        tasks.push(
          client
            .callHaiku(
              "You are a reasoning probe. Respond ONLY with the requested JSON format.",
              buildSporePrompt(angle, prompt, undefined, biasStr)
            )
            .then((raw) => {
              const resp = parseSporeResponse(raw);
              if (verbose) {
                console.log(
                  `  [gen${generation}] ${angle}: "${resp.lean.slice(0, 80)}..."`
                );
              }
              return {
                id,
                angle,
                generation,
                parentId: null,
                lean: resp.lean,
                keywords: resp.keywords,
                vector: keywordsToVector(resp.keywords),
                score: 0,
                alive: true,
              };
            })
        );
      }
    }
  } else {
    // Subsequent gens: spawn children from surviving parents
    for (const parent of parents) {
      if (!parent.alive) continue;

      // High scorers spawn 2, medium spawn 1
      const childCount = parent.score >= 0.6 ? 2 : 1;

      for (let i = 0; i < childCount; i++) {
        const id = makeId(generation, parent.angle);
        tasks.push(
          client
            .callHaiku(
              "You are a reasoning probe. Respond ONLY with the requested JSON format.",
              buildSporePrompt(parent.angle, prompt, parent.lean)
            )
            .then((raw) => {
              const resp = parseSporeResponse(raw);
              if (verbose) {
                console.log(
                  `  [gen${generation}] ${parent.angle} (child of ${parent.id}): "${resp.lean.slice(0, 60)}..."`
                );
              }
              return {
                id,
                angle: parent.angle,
                generation,
                parentId: parent.id,
                lean: resp.lean,
                keywords: resp.keywords,
                vector: keywordsToVector(resp.keywords),
                score: 0,
                alive: true,
              };
            })
        );
      }
    }
  }

  return Promise.all(tasks);
}

// Check early termination: if all alive spores cluster to 1 group
export function hasConverged(
  spores: Spore[],
  similarityThreshold: number
): boolean {
  const alive = spores.filter((s) => s.alive);
  if (alive.length <= 2) return true;

  // Quick check: are all spore vectors very similar?
  for (let i = 1; i < alive.length; i++) {
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let d = 0; d < alive[0].vector.length; d++) {
      dot += alive[0].vector[d] * alive[i].vector[d];
      magA += alive[0].vector[d] * alive[0].vector[d];
      magB += alive[i].vector[d] * alive[i].vector[d];
    }
    const sim = dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
    if (sim < similarityThreshold) return false;
  }

  return true;
}
