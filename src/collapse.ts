import type {
  Spore,
  Cluster,
  MyceliumResult,
  Angle,
  TopologyAnalysis,
  TopologyShape,
  Contradiction,
  CollapseResult,
} from "./types.js";
import { ANGLES } from "./types.js";
import type { SporeClient } from "./client.js";

// ── Phase 1: Topology Analysis (pure computation) ──────────────
function analyzeTopology(
  allSpores: Spore[],
  clusters: Cluster[],
  activeAngles?: readonly Angle[]
): TopologyAnalysis {
  const anglesInPlay = activeAngles ?? ANGLES;

  // Which angles survived vs died
  const survivingAngles = new Set<Angle>();
  const generationsSurvived: Record<string, number> = {};

  for (const s of allSpores) {
    if (s.alive) {
      survivingAngles.add(s.angle);
      const prev = generationsSurvived[s.angle] ?? 0;
      generationsSurvived[s.angle] = Math.max(prev, s.generation);
    }
  }

  const deadAngles = anglesInPlay.filter((a) => !survivingAngles.has(a));

  // Determine shape
  let shape: TopologyShape;
  if (clusters.length === 1) {
    // Check if one angle dominates
    const angleSet = new Set(
      allSpores.filter((s) => s.alive).map((s) => s.angle)
    );
    shape = angleSet.size <= 2 ? "monocultural" : "convergent";
  } else if (clusters.length === 2) {
    shape = "bipolar";
  } else {
    shape = "fragmented";
  }

  // Dominant angle = highest total score among survivors
  const angleScores = new Map<Angle, number>();
  for (const s of allSpores) {
    if (s.alive) {
      angleScores.set(s.angle, (angleScores.get(s.angle) ?? 0) + s.score);
    }
  }
  let dominantAngle: Angle | null = null;
  let maxScore = 0;
  for (const [angle, score] of angleScores) {
    if (score > maxScore) {
      maxScore = score;
      dominantAngle = angle;
    }
  }

  return {
    shape,
    survivingAngles: [...survivingAngles],
    deadAngles: deadAngles as Angle[],
    dominantAngle,
    clusterCount: clusters.length,
    generationsSurvived,
  };
}

// ── Phase 2: Contradiction Mapping (1 Sonnet call) ─────────────
async function mapContradictions(
  client: SporeClient,
  myceliumResults: MyceliumResult[],
  topology: TopologyAnalysis,
  verbose?: boolean
): Promise<Contradiction[]> {
  if (myceliumResults.length < 2) return [];

  const conclusions = myceliumResults
    .map(
      (r, i) =>
        `[Cluster ${r.clusterId}, ${r.angle}]: "${r.conclusion}" (confidence: ${r.confidence.toFixed(2)})`
    )
    .join("\n");

  const systemPrompt = `You identify contradictions between reasoning conclusions.
Respond with ONLY a JSON array:
[{"between":["summary1","summary2"],"type":"genuine|false-dichotomy|irreconcilable","explanation":"..."}]

Types:
- genuine: Real tension that must be navigated
- false-dichotomy: Apparent conflict that dissolves on closer inspection
- irreconcilable: Fundamentally incompatible positions

Return [] if no contradictions.`;

  const userPrompt = `Topology: ${topology.shape} (${topology.clusterCount} clusters)
Surviving angles: ${topology.survivingAngles.join(", ")}
Dead angles: ${topology.deadAngles.join(", ")}

Conclusions to compare:
${conclusions}`;

  const raw = await client.callHaiku(systemPrompt, userPrompt, 500, 0.3);

  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]) as Contradiction[];

    if (verbose && parsed.length > 0) {
      console.log(`  [collapse] Found ${parsed.length} contradiction(s)`);
    }

    return parsed.map((c) => ({
      between: [String(c.between?.[0] ?? ""), String(c.between?.[1] ?? "")],
      type: (["genuine", "false-dichotomy", "irreconcilable"].includes(c.type)
        ? c.type
        : "genuine") as Contradiction["type"],
      explanation: String(c.explanation ?? ""),
    }));
  } catch {
    return [];
  }
}

// ── Phase 3: Weighted Synthesis (1 Sonnet call, temp 0.3) ──────
async function synthesize(
  client: SporeClient,
  prompt: string,
  topology: TopologyAnalysis,
  myceliumResults: MyceliumResult[],
  contradictions: Contradiction[],
  rawSpores: Spore[],
  verbose?: boolean,
  onStream?: (chunk: string) => void
): Promise<{ answer: string; approachBreakdown: Record<Angle, number>; confidence: number }> {
  // Build scored conclusions
  const scoredConclusions =
    myceliumResults.length > 0
      ? myceliumResults
          .map(
            (r) =>
              `[${r.angle}, confidence=${r.confidence.toFixed(2)}]: ${r.conclusion}\nReasoning: ${r.reasoning.slice(0, 500)}`
          )
          .join("\n\n")
      : rawSpores
          .filter((s) => s.alive)
          .sort((a, b) => b.score - a.score)
          .slice(0, 10)
          .map((s) => `[${s.angle}, score=${s.score.toFixed(2)}]: ${s.lean}`)
          .join("\n");

  const contradictionSummary =
    contradictions.length > 0
      ? contradictions
          .map(
            (c) =>
              `${c.type}: ${c.between[0]} vs ${c.between[1]} — ${c.explanation}`
          )
          .join("\n")
      : "None identified.";

  const systemPrompt = `You are SPORE, synthesizing parallel reasoning into a clear answer.

RULES:
- Lead with a direct answer in the FIRST SENTENCE.
- For analytical/decision questions: Be decisive. If evidence leans 60%+ one way, commit. No wishy-washy "both have merits."
- For personal/conversational input (user sharing goals, context, or chatting): Engage naturally. Acknowledge what they said, add value, don't lecture or give unsolicited pushback.
- Keep the total answer under 200 words. Dense and useful.
- Match tone to context: casual input → casual response, technical → technical depth.

The topology tells you what survived evolutionary pressure. Dead angles = that perspective couldn't hold up. Use this as signal for analytical questions.

Respond with valid JSON:
{"answer":"answer under 200 words","approachBreakdown":{"angle_name":0.0,...},"confidence":0.0-1.0}

approachBreakdown: weight each active angle (sum to ~1.0). Active angles for this run: ${topology.survivingAngles.concat(topology.deadAngles).join(", ")}
confidence: how confident you are (0.0-1.0).`;

  const userPrompt = `QUESTION: ${prompt}

TOPOLOGY:
- Shape: ${topology.shape}
- Clusters: ${topology.clusterCount}
- Surviving angles: ${topology.survivingAngles.join(", ")}
- Dead angles: ${topology.deadAngles.join(", ")}
- Dominant: ${topology.dominantAngle ?? "none"}
${topology.shape === "monocultural" ? "⚠️ MONOCULTURAL WARNING: Only one perspective dominated. Note this in confidence." : ""}

SCORED CONCLUSIONS:
${scoredConclusions}

CONTRADICTIONS:
${contradictionSummary}`;

  let raw: string;

  if (onStream) {
    // Stream mode: pipe chunks to callback, collect full text
    let accumulated = "";
    for await (const chunk of client.streamSonnet(systemPrompt, userPrompt, 800, 0.3)) {
      onStream(chunk);
      accumulated += chunk;
    }
    raw = accumulated;
  } else {
    raw = await client.callSonnet(systemPrompt, userPrompt, 800, 0.3);
  }

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON");
    const parsed = JSON.parse(jsonMatch[0]);

    // Build approach breakdown with defaults
    const breakdown: Record<Angle, number> = {} as Record<Angle, number>;
    for (const angle of ANGLES) {
      breakdown[angle] = Number(parsed.approachBreakdown?.[angle] ?? 0);
    }

    return {
      answer: String(parsed.answer ?? raw),
      approachBreakdown: breakdown,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5))),
    };
  } catch {
    // Fallback
    const breakdown: Record<Angle, number> = {} as Record<Angle, number>;
    for (const angle of ANGLES) {
      breakdown[angle] = topology.survivingAngles.includes(angle)
        ? 1 / topology.survivingAngles.length
        : 0;
    }
    return { answer: raw, approachBreakdown: breakdown, confidence: 0.3 };
  }
}

// ── Full Collapse Pipeline ─────────────────────────────────────
export async function collapse(
  client: SporeClient,
  prompt: string,
  allSpores: Spore[],
  clusters: Cluster[],
  myceliumResults: MyceliumResult[],
  verbose?: boolean,
  activeAngles?: Angle[],
  onStream?: (chunk: string) => void
): Promise<CollapseResult> {
  if (verbose) console.log("\n[collapse] Phase 1: Topology analysis...");
  const topology = analyzeTopology(allSpores, clusters, activeAngles);

  if (verbose) {
    console.log(`  Shape: ${topology.shape}`);
    console.log(`  Surviving: ${topology.survivingAngles.join(", ")}`);
    console.log(`  Dead: ${topology.deadAngles.join(", ") || "none"}`);
  }

  if (verbose) console.log("[collapse] Phase 2: Contradiction mapping...");
  const contradictions = await mapContradictions(
    client,
    myceliumResults,
    topology,
    verbose
  );

  if (verbose) console.log("[collapse] Phase 3: Weighted synthesis...");
  const synthesis = await synthesize(
    client,
    prompt,
    topology,
    myceliumResults,
    contradictions,
    allSpores,
    verbose,
    onStream
  );

  return {
    answer: synthesis.answer,
    topology,
    contradictions,
    approachBreakdown: synthesis.approachBreakdown,
    confidence: synthesis.confidence,
  };
}

// Graceful fallback: single Sonnet call when everything dies
export async function fallbackReason(
  client: SporeClient,
  prompt: string,
  verbose?: boolean
): Promise<CollapseResult> {
  if (verbose) console.log("[fallback] All spores died — single Sonnet call");

  const raw = await client.callSonnet(
    `You are SPORE (Simultaneous Parallel Organic Reasoning Engine), a slime mold-inspired parallel reasoning assistant.
Be direct and helpful. If the user is sharing context, goals, or personal info, engage with it — don't lecture or give unsolicited strategic pushback.
Match your tone to the input: casual questions get casual answers, technical questions get technical depth.
Give a comprehensive, well-reasoned answer.`,
    prompt,
    2000,
    0.5
  );

  const breakdown: Record<Angle, number> = {} as Record<Angle, number>;
  for (const angle of ANGLES) {
    breakdown[angle] = angle === "analytical" ? 1.0 : 0;
  }

  return {
    answer: raw,
    topology: {
      shape: "fragmented",
      survivingAngles: [],
      deadAngles: [...ANGLES],
      dominantAngle: null,
      clusterCount: 0,
      generationsSurvived: {},
    },
    contradictions: [],
    approachBreakdown: breakdown,
    confidence: 0.3,
  };
}
