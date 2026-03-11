import type { Cluster, Spore, MyceliumResult, CodeReference } from "./types.js";
import type { SporeClient } from "./client.js";
import { tavilySearch, formatForCluster } from "./web.js";

// Tier 2: Fire Sonnet on clusters that meet density threshold
export async function fireMycelium(
  client: SporeClient,
  clusters: Cluster[],
  allSpores: Spore[],
  prompt: string,
  densityThreshold: number,
  verbose?: boolean,
  onFire?: (cluster: Cluster, result: MyceliumResult) => void,
  tavilyApiKey?: string,
  hasCodeContext?: boolean
): Promise<MyceliumResult[]> {
  const denseClusters = clusters.filter(
    (c) => c.sporeIds.length >= densityThreshold
  );

  if (denseClusters.length === 0) {
    if (verbose) console.log("  [mycelium] No clusters meet density threshold — skipping");
    return [];
  }

  if (verbose) {
    console.log(
      `  [mycelium] Firing on ${denseClusters.length} dense cluster(s)`
    );
  }

  const tasks = denseClusters.map(async (cluster) => {
    // Gather spore leans for this cluster
    const clusterSpores = cluster.sporeIds
      .map((id) => allSpores.find((s) => s.id === id))
      .filter((s): s is Spore => s !== undefined);

    const sporeSignals = clusterSpores
      .map(
        (s, i) =>
          `${i + 1}. [${s.angle}] ${s.lean} (score: ${s.score.toFixed(2)})`
      )
      .join("\n");

    const codeRefField = hasCodeContext
      ? `,"codeReferences":[{"file":"path","line":N,"issue":"description"}]`
      : "";
    const codeRefNote = hasCodeContext
      ? `\nIf analyzing code, include codeReferences array with specific file/line/issue entries for any issues found.`
      : "";

    const systemPrompt = `You are a deep reasoning engine. Multiple lightweight probes have converged on a cluster of related ideas. Your job is to synthesize these signals into rigorous reasoning.

Respond with valid JSON ONLY:
{"reasoning":"detailed multi-paragraph reasoning","conclusion":"1-2 sentence conclusion","confidence":0.0-1.0${codeRefField}}${codeRefNote}`;

    // Per-cluster web verification
    let webVerification = "";
    if (tavilyApiKey) {
      const query = formatForCluster(
        clusterSpores.map((s) => s.lean).join(" "),
        prompt
      );
      const results = await tavilySearch(query, tavilyApiKey, 3);
      if (results) {
        webVerification = `\n\nWEB VERIFICATION:\n${results}`;
        if (verbose) console.log(`  [mycelium] Cluster ${cluster.id}: web verification attached`);
      }
    }

    const userPrompt = `ORIGINAL QUESTION: ${prompt}

DOMINANT APPROACH: ${cluster.dominantAngle}
CLUSTER AVG SCORE: ${cluster.avgScore.toFixed(2)}
CONVERGED SIGNALS (${clusterSpores.length} probes):
${sporeSignals}

Synthesize these signals into a rigorous, well-reasoned analysis.${webVerification}`;

    const raw = await client.callSonnet(systemPrompt, userPrompt);

    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");
      const parsed = JSON.parse(jsonMatch[0]);

      if (verbose) {
        console.log(
          `  [mycelium] Cluster ${cluster.id} (${cluster.dominantAngle}): confidence=${(parsed.confidence ?? 0).toFixed(2)}`
        );
      }

      // Extract code references if present
      let codeRefs: CodeReference[] | undefined;
      if (hasCodeContext && Array.isArray(parsed.codeReferences)) {
        codeRefs = parsed.codeReferences
          .filter((r: any) => r && r.file && r.issue)
          .map((r: any) => ({
            file: String(r.file),
            line: r.line != null ? Number(r.line) : undefined,
            issue: String(r.issue),
          }));
      }

      const result: MyceliumResult = {
        clusterId: cluster.id,
        reasoning: String(parsed.reasoning ?? raw),
        conclusion: String(parsed.conclusion ?? ""),
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5))),
        angle: cluster.dominantAngle,
        codeReferences: codeRefs,
      };
      onFire?.(cluster, result);
      return result;
    } catch {
      const result: MyceliumResult = {
        clusterId: cluster.id,
        reasoning: raw,
        conclusion: raw.slice(0, 200),
        confidence: 0.5,
        angle: cluster.dominantAngle,
      };
      onFire?.(cluster, result);
      return result;
    }
  });

  return Promise.all(tasks);
}
