import type {
  SporeConfig,
  SporeEngine,
  ReasonResult,
  Spore,
  Cluster,
  MyceliumResult,
  PipelineEvent,
} from "./types.js";
import { DEFAULT_CONFIG, CustomAngleSchema } from "./types.js";
import { SporeClient, estimateCost } from "./client.js";
import { spawnGeneration, hasConverged } from "./spore.js";
import { scoreSpores, applyScores } from "./scoring.js";
import { clusterSpores } from "./density.js";
import { fireMycelium } from "./mycelium.js";
import { collapse, fallbackReason } from "./collapse.js";
import {
  hashPrompt,
  loadTrail,
  saveTrail,
  buildEntries,
  mergeTrails,
} from "./pheromone.js";
import { tavilySearch } from "./web.js";
import {
  loadApproachMemory,
  saveApproachMemory,
  updateApproachMemory,
  getAngleWeights,
  classifyTopic,
} from "./approach-memory.js";
import type { CodeContext, Angle } from "./types.js";
import { selectAngles } from "./angle-selector.js";
import {
  loadSessionMemory,
  saveSession,
  summarizeHistory,
  generateSessionId,
} from "./session-memory.js";
import { loadCache, saveCache, hashForCache } from "./cache.js";
import { loadRunHistory, saveRunHistory, recordRun } from "./run-history.js";

export type {
  ReasonResult,
  SporeConfig,
  SporeEngine,
  SporeEngineV2,
  PipelineStage,
  PipelineEvent,
  PipelineCallback,
  CodeContext,
  CustomAngle,
  CostEstimate,
} from "./types.js";
export { formatCodeContext } from "./code-context.js";

export function createSpore(userConfig?: Partial<SporeConfig>): SporeEngine {
  const config: SporeConfig = { ...DEFAULT_CONFIG, ...userConfig };

  // Validate custom angles early
  if (config.customAngles) {
    for (const angle of config.customAngles) {
      const result = CustomAngleSchema.safeParse(angle);
      if (!result.success) {
        const issues = result.error.issues.map((i) => i.message).join(", ");
        throw new Error(`Invalid custom angle "${angle.name ?? "(unnamed)"}": ${issues}`);
      }
    }
  }

  const client = new SporeClient({
    apiKey: config.apiKey,
    concurrency: config.concurrency,
    timeoutMs: config.timeoutMs,
  });

  const reasonFn = async (prompt: string, codeContext?: CodeContext): Promise<ReasonResult> => {
      const startTime = Date.now();
      const v = config.verbose;
      const emit = (event: PipelineEvent) => config.onEvent?.(event);

      if (v) console.log(`\n🍄 SPORE — reasoning on: "${prompt.slice(0, 80)}..."\n`);

      // Load pheromone trails
      const promptHash = hashPrompt(prompt);
      const existingTrail = config.trails
        ? loadTrail(config.trailDir, promptHash)
        : null;

      if (v && existingTrail) {
        console.log(
          `[pheromone] Loaded ${existingTrail.entries.length} trail entries`
        );
      }

      // Load angle result cache
      const cachePromptHash = hashForCache(prompt);
      const angleCache = config.trails ? loadCache(config.trailDir) : null;
      const cacheCtx = angleCache ? { data: angleCache, promptHash: cachePromptHash } : null;

      // Load approach memory and classify topic
      const useApproachMemory = config.approachMemory !== false;
      const approachMemory = useApproachMemory
        ? loadApproachMemory(config.trailDir)
        : null;
      let topicTag: string | undefined;
      let angleWeights: Record<string, number> | undefined;

      if (approachMemory) {
        topicTag = await classifyTopic(client, prompt);
        angleWeights = getAngleWeights(approachMemory, topicTag);
        if (v) {
          console.log(`[approach-memory] Topic: ${topicTag}`);
          const topAngles = Object.entries(angleWeights)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([a, w]) => `${a}=${w.toFixed(2)}`);
          console.log(`[approach-memory] Top weights: ${topAngles.join(", ")}`);
        }
      }

      const codeContextStr = codeContext?.formatted;

      // Select angles based on code context
      const hasCode = !!codeContextStr;
      const angleSelection = selectAngles(hasCode, angleWeights, topicTag, config.customAngles);
      const activeAngles = angleSelection.angles;
      const customAngles = angleSelection.customAngles;
      if (v) console.log(`[angles] ${angleSelection.reason}`);

      // ── Web Search Grounding ────────────────────────────
      const tavilyKey = config.tavilyApiKey;
      const useWeb = tavilyKey && config.webGrounding !== false;
      let groundingContext: string | null = null;

      if (useWeb) {
        emit({ stage: "web-search", generation: 0 });
        if (v) console.log(`[web] Searching for grounding...`);
        groundingContext = await tavilySearch(prompt, tavilyKey);
        if (v) {
          if (groundingContext) {
            const count = groundingContext.split("\n").length;
            console.log(`[web] Found ${count} results`);
          } else {
            console.log(`[web] No results (continuing ungrounded)`);
          }
        }
      }

      let allSpores: Spore[] = [];
      let clusters: Cluster[] = [];
      let myceliumResults: MyceliumResult[] = [];
      let generation = 0;
      const sporeIdCounter = { value: 0 };

      // ── Generation Loop ──────────────────────────────────
      for (generation = 0; generation < config.generations; generation++) {
        if (v) console.log(`\n── Generation ${generation} ──`);

        // Spawn spores
        const parents =
          generation === 0
            ? undefined
            : allSpores.filter(
                (s) => s.alive && s.generation === generation - 1
              );

        emit({ stage: "spawn-start", generation, data: { totalSpores: generation === 0 ? 9 * config.sporesPerAngle : parents?.filter(s => s.alive).length ?? 0 } });

        const newSpores = await spawnGeneration(
          client,
          prompt,
          generation,
          config.sporesPerAngle,
          parents,
          existingTrail?.entries,
          v,
          (spore) => emit({ stage: "spawn-spore", generation, data: { spore } }),
          groundingContext ?? undefined,
          codeContextStr,
          angleWeights,
          activeAngles,
          generation === 0 ? customAngles : undefined,
          generation === 0 ? cacheCtx : null,
          sporeIdCounter
        );

        allSpores.push(...newSpores);
        emit({ stage: "spawn-done", generation, data: { spores: newSpores } });

        // Score (batch Haiku call)
        if (v) console.log(`  [scoring] Scoring ${newSpores.length} spores...`);
        const scores = await scoreSpores(client, newSpores, prompt, hasCode);
        applyScores(newSpores, scores, config.pruneThreshold);
        emit({ stage: "score-done", generation, data: { spores: newSpores } });

        const alive = newSpores.filter((s) => s.alive);
        const dead = newSpores.filter((s) => !s.alive);
        if (v) {
          console.log(
            `  [pruning] ${alive.length} alive, ${dead.length} pruned`
          );
        }
        emit({ stage: "prune-done", generation, data: { spores: newSpores, aliveCount: alive.length, deadCount: dead.length } });

        // Edge case: all spores die despite minSurvivors guarantee
        // (only possible if scoring returned no results at all)
        if (alive.length === 0) {
          if (v) console.log("  ⚠️ All spores died — fallback");
          const result = await fallbackReason(client, prompt, v);
          return {
            ...result,
            meta: {
              generations: generation + 1,
              totalSpores: allSpores.length,
              survivingSpores: 0,
              myceliumCalls: 0,
              costEstimate: client.costTracker.estimate(),
              wallClockMs: Date.now() - startTime,
            },
          };
        }

        // Cluster
        clusters = clusterSpores(
          allSpores.filter((s) => s.alive),
          config.clusterSimilarity
        );
        if (v) console.log(`  [clustering] ${clusters.length} cluster(s)`);
        emit({ stage: "cluster-done", generation, data: { clusters, spores: allSpores.filter(s => s.alive) } });

        // Fire mycelium on dense clusters
        emit({ stage: "mycelium-start", generation, data: { clusters } });
        const genMycelium = await fireMycelium(
          client,
          clusters,
          allSpores,
          prompt,
          config.densityThreshold,
          v,
          (cluster, result) => emit({ stage: "mycelium-fire", generation, data: { cluster, myceliumResult: result } }),
          useWeb ? tavilyKey : undefined,
          hasCode
        );
        myceliumResults.push(...genMycelium);
        emit({ stage: "mycelium-done", generation, data: { myceliumResults: genMycelium } });

        // Early termination check
        if (
          hasConverged(
            allSpores.filter((s) => s.alive),
            config.clusterSimilarity + 0.1
          )
        ) {
          if (v)
            console.log(
              `  [convergence] Early termination at generation ${generation}`
            );
          break;
        }
      }

      // ── Collapse ─────────────────────────────────────────
      if (v) console.log("\n── Collapse ──");
      emit({ stage: "collapse-start", generation });

      const collapseResult = await collapse(
        client,
        prompt,
        allSpores,
        clusters,
        myceliumResults,
        v,
        activeAngles,
        config.onStream
      );

      emit({ stage: "collapse-topology", generation, data: { topology: collapseResult.topology, collapseResult } });
      emit({ stage: "collapse-done", generation, data: { collapseResult } });

      // ── Pheromone persistence ────────────────────────────
      if (config.trails) {
        const survivors = allSpores.filter((s) => s.alive);
        const entries = buildEntries(survivors, generation);
        const merged = mergeTrails(existingTrail, promptHash, entries);
        saveTrail(config.trailDir, promptHash, merged);
        if (v) console.log(`\n[pheromone] Saved ${entries.length} trail entries`);

        // Save angle cache
        if (angleCache) {
          saveCache(config.trailDir, angleCache);
          if (v) console.log(`[cache] Saved ${angleCache.entries.length} cached angle results`);
        }
      }

      // ── Approach memory persistence ────────────────────
      if (approachMemory) {
        const survivors = allSpores.filter((s) => s.alive);
        const angleScores: Record<string, number> = {};
        for (const s of allSpores) {
          if (!angleScores[s.angle] || s.score > angleScores[s.angle]) {
            angleScores[s.angle] = s.score;
          }
        }
        updateApproachMemory(approachMemory, {
          survivingAngles: [...new Set(survivors.map((s) => s.angle))],
          angleScores,
          topicTag,
          confidence: collapseResult.confidence,
          contradictions: collapseResult.contradictions,
        });
        saveApproachMemory(config.trailDir, approachMemory);
        if (v) console.log(`[approach-memory] Updated and saved`);
      }

      // ── Session memory persistence ─────────────────────
      if (config.trails) {
        try {
          const sessionMemory = loadSessionMemory(config.trailDir);
          const summary = await summarizeHistory(client, [
            { role: "user" as const, content: prompt },
            { role: "assistant" as const, content: collapseResult.answer },
          ]);
          saveSession(config.trailDir, sessionMemory, {
            sessionId: generateSessionId(),
            topic: summary.topic,
            summary: summary.summary,
            conclusion: summary.conclusion,
            messages: [
              { role: "user", content: prompt },
              { role: "assistant", content: collapseResult.answer },
            ],
            timestamp: Date.now(),
            decayWeight: 1.0,
          });
          if (v) console.log(`[session-memory] Saved: ${summary.topic}`);
        } catch {
          // Silent fail — session memory is best-effort
        }
      }

      // ── Run history persistence ──────────────────────────
      if (config.trails) {
        try {
          const runHistory = loadRunHistory(config.trailDir);
          const preflightEstimate = estimateCostFn(!!codeContext);
          recordRun(runHistory, {
            timestamp: Date.now(),
            promptHash,
            promptPreview: prompt.slice(0, 120),
            estimatedCost: (preflightEstimate.low + preflightEstimate.high) / 2,
            actualCost: client.costTracker.estimate(),
            generations: generation + 1,
            totalSpores: allSpores.length,
            survivingSpores: allSpores.filter((s) => s.alive).length,
            myceliumCalls: myceliumResults.length,
            wallClockMs: Date.now() - startTime,
            confidence: collapseResult.confidence,
            topologyShape: collapseResult.topology.shape,
            anglesUsed: [...new Set(allSpores.map((s) => s.angle))],
            dominantAngle: collapseResult.topology.dominantAngle,
            hadCodeContext: !!codeContext,
          });
          saveRunHistory(config.trailDir, runHistory);
          if (v) console.log(`[run-history] Recorded run (${runHistory.runs.length} total)`);
        } catch {
          // Silent fail — run history is best-effort
        }
      }

      const survivingSpores = allSpores.filter((s) => s.alive);

      if (v) {
        console.log(`\n── Done ──`);
        console.log(`  Total spores: ${allSpores.length}`);
        console.log(`  Surviving: ${survivingSpores.length}`);
        console.log(`  Mycelium calls: ${myceliumResults.length}`);
        console.log(`  API calls: ${client.costTracker.totalCalls}`);
        console.log(
          `  Est. cost: $${client.costTracker.estimate().toFixed(4)}`
        );
        console.log(`  Wall clock: ${Date.now() - startTime}ms`);
      }

      return {
        ...collapseResult,
        meta: {
          generations: generation + 1,
          totalSpores: allSpores.length,
          survivingSpores: survivingSpores.length,
          myceliumCalls: myceliumResults.length,
          costEstimate: client.costTracker.estimate(),
          wallClockMs: Date.now() - startTime,
        },
      };
  };

  const estimateCostFn = (hasCodeContext = false) => {
    const selection = selectAngles(hasCodeContext, undefined, undefined, config.customAngles);
    const anglesPerGeneration = selection.angles.length + selection.customAngles.length;
    return estimateCost({
      generations: config.generations,
      anglesPerGeneration,
      sporesPerAngle: config.sporesPerAngle,
      densityThreshold: config.densityThreshold,
    });
  };

  return {
    reason: reasonFn,
    estimateCost: estimateCostFn,
  };
}
