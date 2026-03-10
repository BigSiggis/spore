import type { Cluster, Spore, MyceliumResult } from "./types.js";
import type { SporeClient } from "./client.js";

// Tier 2: Fire Sonnet on clusters that meet density threshold
export async function fireMycelium(
  client: SporeClient,
  clusters: Cluster[],
  allSpores: Spore[],
  prompt: string,
  densityThreshold: number,
  verbose?: boolean
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

    const systemPrompt = `You are a deep reasoning engine. Multiple lightweight probes have converged on a cluster of related ideas. Your job is to synthesize these signals into rigorous reasoning.

Respond with valid JSON ONLY:
{"reasoning":"detailed multi-paragraph reasoning","conclusion":"1-2 sentence conclusion","confidence":0.0-1.0}`;

    const userPrompt = `ORIGINAL QUESTION: ${prompt}

DOMINANT APPROACH: ${cluster.dominantAngle}
CLUSTER AVG SCORE: ${cluster.avgScore.toFixed(2)}
CONVERGED SIGNALS (${clusterSpores.length} probes):
${sporeSignals}

Synthesize these signals into a rigorous, well-reasoned analysis.`;

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

      return {
        clusterId: cluster.id,
        reasoning: String(parsed.reasoning ?? raw),
        conclusion: String(parsed.conclusion ?? ""),
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5))),
        angle: cluster.dominantAngle,
      };
    } catch {
      return {
        clusterId: cluster.id,
        reasoning: raw,
        conclusion: raw.slice(0, 200),
        confidence: 0.5,
        angle: cluster.dominantAngle,
      };
    }
  });

  return Promise.all(tasks);
}
