import type {
  Spore,
  Cluster,
  MyceliumResult,
  Angle,
  TopologyAnalysis,
  TopologyShape,
  Contradiction,
  CollapseResult,
  SelfReviewResult,
  SelfReviewIssue,
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

  const raw = await client.callSonnet(systemPrompt, userPrompt, 500, 0.3);

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
  onStream?: (chunk: string) => void,
  critique?: string
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
${contradictionSummary}${critique ? `

SELF-REVIEW CRITIQUE (fix these issues in your revised answer):
${critique}` : ""}`;

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

// ── Phase 4: Self-Review (1 Sonnet call, temp 0.2) ─────────────
async function selfReview(
  client: SporeClient,
  answer: string,
  prompt: string,
  isCodeContext: boolean,
  verbose?: boolean
): Promise<SelfReviewResult> {
  const codeSystemPrompt = `You are a ruthless code reviewer. Examine SPORE's synthesized answer for:
- Bugs in any suggested code (off-by-one, null refs, wrong types, missing await)
- Security issues (injection, hardcoded secrets, missing validation)
- Inconsistencies between the explanation and the code
- Wrong API usage or deprecated patterns
- Logic that doesn't match the stated intent

Respond with ONLY valid JSON:
{"issues":[{"type":"bug|security|logic-gap|inconsistency|overconfidence|wrong-api","severity":"critical|moderate|minor","description":"..."}]}

Return {"issues":[]} if the answer is clean.`;

  const generalSystemPrompt = `You are a critical reviewer. Examine SPORE's synthesized answer for:
- Logic gaps or unsupported claims
- Contradictions within the answer itself
- Overconfidence given the evidence
- Missing important caveats or edge cases
- Factual errors

Respond with ONLY valid JSON:
{"issues":[{"type":"bug|security|logic-gap|inconsistency|overconfidence|wrong-api","severity":"critical|moderate|minor","description":"..."}]}

Return {"issues":[]} if the answer is clean. Only flag real problems — no nitpicking.`;

  const systemPrompt = isCodeContext ? codeSystemPrompt : generalSystemPrompt;
  const userPrompt = `ORIGINAL QUESTION: ${prompt}

SPORE'S ANSWER TO REVIEW:
${answer}`;

  const raw = await client.callSonnet(systemPrompt, userPrompt, 500, 0.2);

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { issuesFound: false, issueCount: 0, revised: false, issues: [] };
    const parsed = JSON.parse(jsonMatch[0]);
    const issues: SelfReviewIssue[] = (parsed.issues ?? []).map((i: any) => ({
      type: ["bug", "security", "logic-gap", "inconsistency", "overconfidence", "wrong-api"].includes(i.type) ? i.type : "logic-gap",
      severity: ["critical", "moderate", "minor"].includes(i.severity) ? i.severity : "minor",
      description: String(i.description ?? ""),
    }));

    if (verbose && issues.length > 0) {
      console.log(`  [self-review] Found ${issues.length} issue(s): ${issues.map(i => `${i.severity}/${i.type}`).join(", ")}`);
    }

    return {
      issuesFound: issues.length > 0,
      issueCount: issues.length,
      revised: false,
      issues,
    };
  } catch {
    return { issuesFound: false, issueCount: 0, revised: false, issues: [] };
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
  onStream?: (chunk: string) => void,
  selfReviewEnabled = true,
  selfReviewRevise = true,
  isCodeContext = false,
  onReviewEvent?: (stage: "review-start" | "review-done" | "review-revise", review: SelfReviewResult) => void
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
  let synthesis = await synthesize(
    client,
    prompt,
    topology,
    myceliumResults,
    contradictions,
    allSpores,
    verbose,
    onStream
  );

  // Phase 4: Self-Review
  let review: SelfReviewResult | undefined;
  if (selfReviewEnabled) {
    if (verbose) console.log("[collapse] Phase 4: Self-review...");
    onReviewEvent?.("review-start", { issuesFound: false, issueCount: 0, revised: false, issues: [] });

    review = await selfReview(client, synthesis.answer, prompt, isCodeContext, verbose);
    onReviewEvent?.("review-done", review);

    if (review.issuesFound && selfReviewRevise) {
      if (verbose) console.log("[collapse] Phase 4b: Re-synthesizing with critique...");
      const critique = review.issues
        .map((i, idx) => `${idx + 1}. [${i.severity}/${i.type}] ${i.description}`)
        .join("\n");

      // Re-synthesize without streaming (original stream already went out)
      synthesis = await synthesize(
        client,
        prompt,
        topology,
        myceliumResults,
        contradictions,
        allSpores,
        verbose,
        undefined,
        critique
      );
      review = { ...review, revised: true };
      onReviewEvent?.("review-revise", review);
    }

    if (verbose && !review.issuesFound) {
      console.log("  [self-review] Clean — no issues found");
    }
  }

  return {
    answer: synthesis.answer,
    topology,
    contradictions,
    approachBreakdown: synthesis.approachBreakdown,
    confidence: synthesis.confidence,
    review,
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
