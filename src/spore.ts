import { createHash } from "crypto";
import type { Spore, Angle, SporeResponse, PheromoneEntry, CustomAngle } from "./types.js";
import { ANGLES } from "./types.js";
import type { SporeClient } from "./client.js";
import { keywordsToVector } from "./density.js";
import type { AngleCache } from "./cache.js";
import { getCached, setCache } from "./cache.js";

function makeId(gen: number, angle: Angle, counter: { value: number }): string {
  return `spore-${gen}-${angle}-${counter.value++}`;
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
  "security-audit":
    "Analyze this for vulnerabilities: injection points, auth bypasses, data exposure, unsafe deserialization, missing input validation. What can an attacker exploit?",
  "bug-detection":
    "Hunt for bugs: edge cases, off-by-one errors, null/undefined access, race conditions, resource leaks, incorrect error handling. What breaks under stress?",
  "code-architecture":
    "Evaluate the architecture: separation of concerns, coupling between components, extensibility, maintenance burden, naming clarity. What's the structural debt?",
  performance:
    "Find performance issues: N+1 queries, unnecessary allocations, blocking operations, missing caching, unoptimized data structures. What's slow and why?",
};

function buildSporePrompt(
  angle: Angle,
  prompt: string,
  parentLean?: string,
  pheromoneBias?: string,
  groundingContext?: string,
  codeContext?: string,
  customDirective?: string
): string {
  const directive = customDirective ?? ANGLE_PROMPTS[angle as keyof typeof ANGLE_PROMPTS];
  let p = `QUESTION: ${prompt}\n\nAPPROACH (${angle}): ${directive ?? "Analyze this from your unique perspective."}`;

  if (codeContext) {
    p += `\n\nCODE CONTEXT (analyze this code — focus on your approach angle):\n${codeContext}`;
  }

  if (groundingContext) {
    p += `\n\nWEB EVIDENCE (factual grounding — cite where relevant):\n${groundingContext}`;
  }

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

// Spawn gen-0 spores: probes across selected angles
export async function spawnGeneration(
  client: SporeClient,
  prompt: string,
  generation: number,
  sporesPerAngle: number,
  parents?: Spore[],
  pheromones?: PheromoneEntry[],
  verbose?: boolean,
  onSpore?: (spore: Spore) => void,
  groundingContext?: string,
  codeContext?: string,
  angleWeights?: Record<string, number>,
  activeAngles?: Angle[],
  customAngles?: CustomAngle[],
  cache?: { data: AngleCache; promptHash: string } | null,
  idCounter?: { value: number }
): Promise<Spore[]> {
  const tasks: Promise<Spore>[] = [];
  const anglesToUse = activeAngles ?? ANGLES;
  const counter = idCounter ?? { value: 0 };

  if (generation === 0 || !parents) {
    // Gen-0: fresh probes across selected angles
    for (const angle of anglesToUse) {
      // Determine spore count from angle weights
      let count = sporesPerAngle;
      if (angleWeights) {
        const w = angleWeights[angle] ?? 1.0;
        if (w > 1.2) count = 2;
        else if (w < 0.5) count = 0; // skip this angle in gen-0
        else count = sporesPerAngle;
      }

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

      for (let i = 0; i < count; i++) {
        const id = makeId(generation, angle, counter);

        // Check cache for gen-0 probes (only first spore per angle, no pheromone bias)
        const cached = cache && i === 0 && !biasStr
          ? getCached(cache.data, cache.promptHash, angle)
          : null;

        if (cached) {
          if (verbose) console.log(`  [gen${generation}] ${angle}: CACHED "${cached.lean.slice(0, 60)}..."`);
          const spore: Spore = {
            id, angle, generation, parentId: null,
            lean: cached.lean, keywords: cached.keywords,
            vector: keywordsToVector(cached.keywords),
            score: 0, alive: true,
          };
          onSpore?.(spore);
          tasks.push(Promise.resolve(spore));
        } else {
          tasks.push(
            client
              .callHaiku(
                "You are a reasoning probe. Respond ONLY with the requested JSON format.",
                buildSporePrompt(angle, prompt, undefined, biasStr, groundingContext, codeContext)
              )
              .then((raw) => {
                const resp = parseSporeResponse(raw);
                if (verbose) {
                  console.log(
                    `  [gen${generation}] ${angle}: "${resp.lean.slice(0, 80)}..."`
                  );
                }
                // Store in cache
                if (cache && !biasStr) {
                  setCache(cache.data, cache.promptHash, angle, resp);
                }
                const spore: Spore = {
                  id, angle, generation, parentId: null,
                  lean: resp.lean, keywords: resp.keywords,
                  vector: keywordsToVector(resp.keywords),
                  score: 0, alive: true,
                };
                onSpore?.(spore);
                return spore;
              })
          );
        }
      }
    }
    // Spawn custom angle probes in gen-0
    if (customAngles && customAngles.length > 0) {
      for (const custom of customAngles) {
        const id = makeId(generation, custom.name as Angle, counter);
        tasks.push(
          client
            .callHaiku(
              "You are a reasoning probe. Respond ONLY with the requested JSON format.",
              buildSporePrompt(custom.name as Angle, prompt, undefined, undefined, groundingContext, codeContext, custom.prompt)
            )
            .then((raw) => {
              const resp = parseSporeResponse(raw);
              if (verbose) {
                console.log(
                  `  [gen${generation}] ${custom.name} (custom): "${resp.lean.slice(0, 80)}..."`
                );
              }
              const spore: Spore = {
                id,
                angle: custom.name as Angle,
                generation,
                parentId: null,
                lean: resp.lean,
                keywords: resp.keywords,
                vector: keywordsToVector(resp.keywords),
                score: 0,
                alive: true,
              };
              onSpore?.(spore);
              return spore;
            })
        );
      }
    }
  } else {
    // Subsequent gens: spawn children from surviving parents
    for (const parent of parents) {
      if (!parent.alive) continue;

      // High scorers spawn 2, medium spawn 1, low scorers get starved
      const childCount = parent.score >= 0.6 ? 2 : parent.score >= 0.4 ? 1 : 0;
      if (childCount === 0) continue;

      for (let i = 0; i < childCount; i++) {
        const id = makeId(generation, parent.angle, counter);
        tasks.push(
          client
            .callHaiku(
              "You are a reasoning probe. Respond ONLY with the requested JSON format.",
              buildSporePrompt(parent.angle, prompt, parent.lean, undefined, groundingContext, codeContext)
            )
            .then((raw) => {
              const resp = parseSporeResponse(raw);
              if (verbose) {
                console.log(
                  `  [gen${generation}] ${parent.angle} (child of ${parent.id}): "${resp.lean.slice(0, 60)}..."`
                );
              }
              const spore: Spore = {
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
              onSpore?.(spore);
              return spore;
            })
        );
      }
    }
  }

  // Use allSettled so one failed probe doesn't kill the whole generation
  const results = await Promise.allSettled(tasks);
  const spores: Spore[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      spores.push(result.value);
    }
    // Rejected probes are silently dropped — pipeline continues with survivors
  }
  return spores;
}

// Check early termination: if all alive spores cluster to 1 group
// Uses all-pairs comparison to catch bipolar camps that star-topology would miss
export function hasConverged(
  spores: Spore[],
  similarityThreshold: number
): boolean {
  const alive = spores.filter((s) => s.alive);
  if (alive.length <= 2) return true;

  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      let dot = 0;
      let magA = 0;
      let magB = 0;
      for (let d = 0; d < alive[i].vector.length; d++) {
        dot += alive[i].vector[d] * alive[j].vector[d];
        magA += alive[i].vector[d] * alive[i].vector[d];
        magB += alive[j].vector[d] * alive[j].vector[d];
      }
      const sim = dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
      if (sim < similarityThreshold) return false;
    }
  }

  return true;
}
