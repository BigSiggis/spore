import type {
  SporeConfig,
  SporeEngine,
  ReasonResult,
  Spore,
  Cluster,
  MyceliumResult,
} from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import { SporeClient } from "./client.js";
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

export type { ReasonResult, SporeConfig, SporeEngine } from "./types.js";

export function createSpore(userConfig?: Partial<SporeConfig>): SporeEngine {
  const config: SporeConfig = { ...DEFAULT_CONFIG, ...userConfig };

  const client = new SporeClient({
    apiKey: config.apiKey,
    concurrency: config.concurrency,
  });

  return {
    reason: async (prompt: string): Promise<ReasonResult> => {
      const startTime = Date.now();
      const v = config.verbose;

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

      let allSpores: Spore[] = [];
      let clusters: Cluster[] = [];
      let myceliumResults: MyceliumResult[] = [];
      let generation = 0;

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

        const newSpores = await spawnGeneration(
          client,
          prompt,
          generation,
          config.sporesPerAngle,
          parents,
          existingTrail?.entries,
          v
        );

        allSpores.push(...newSpores);

        // Score (batch Haiku call)
        if (v) console.log(`  [scoring] Scoring ${newSpores.length} spores...`);
        const scores = await scoreSpores(client, newSpores, prompt);
        applyScores(newSpores, scores, config.pruneThreshold);

        const alive = newSpores.filter((s) => s.alive);
        const dead = newSpores.filter((s) => !s.alive);
        if (v) {
          console.log(
            `  [pruning] ${alive.length} alive, ${dead.length} pruned`
          );
        }

        // Edge case: all spores die
        if (alive.length === 0) {
          if (v) console.log("  ⚠️ All spores died!");

          // Lower threshold once and retry scoring
          if (generation === 0) {
            if (v) console.log("  Lowering threshold and retrying...");
            const lowerThreshold = config.pruneThreshold * 0.5;
            applyScores(newSpores, scores, lowerThreshold);
            // Revive everything with the lower threshold
            for (const s of newSpores) {
              const result = scores.get(s.id);
              if (result && result.composite >= lowerThreshold) {
                s.alive = true;
              }
            }

            const revivedAlive = newSpores.filter((s) => s.alive);
            if (revivedAlive.length === 0) {
              // Total failure — fallback to single Sonnet
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
          }
        }

        // Cluster
        clusters = clusterSpores(
          allSpores.filter((s) => s.alive),
          config.clusterSimilarity
        );
        if (v) console.log(`  [clustering] ${clusters.length} cluster(s)`);

        // Fire mycelium on dense clusters
        const genMycelium = await fireMycelium(
          client,
          clusters,
          allSpores,
          prompt,
          config.densityThreshold,
          v
        );
        myceliumResults.push(...genMycelium);

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

      const collapseResult = await collapse(
        client,
        prompt,
        allSpores,
        clusters,
        myceliumResults,
        v
      );

      // ── Pheromone persistence ────────────────────────────
      if (config.trails) {
        const survivors = allSpores.filter((s) => s.alive);
        const entries = buildEntries(survivors, generation);
        const merged = mergeTrails(existingTrail, promptHash, entries);
        saveTrail(config.trailDir, promptHash, merged);
        if (v) console.log(`\n[pheromone] Saved ${entries.length} trail entries`);
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
    },
  };
}
