#!/usr/bin/env node
import "dotenv/config";
import { createSpore } from "./index.js";
import type { Angle } from "./types.js";

const args = process.argv.slice(2);

// Parse flags
const flags: Record<string, string> = {};
const positional: string[] = [];

for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    const key = args[i].slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = "true";
    }
  } else {
    positional.push(args[i]);
  }
}

const prompt = positional.join(" ");

if (!prompt || flags["help"]) {
  console.log(`
  🍄 SPORE — Simultaneous Parallel Organic Reasoning Engine

  Usage:
    spore "Your question here"
    spore --verbose "Your question here"
    spore --generations 3 --spores 2 "Your question here"
    spore --quiet "Your question here"

  Options:
    --verbose       Show full reasoning trace
    --quiet         Just print the answer, nothing else
    --generations N Number of evolution generations (default: 2)
    --spores N      Spores per angle per generation (default: 1)
    --no-trails     Disable pheromone trail persistence
    --help          Show this help
`);
  process.exit(0);
}

const verbose = flags["verbose"] === "true";
const quiet = flags["quiet"] === "true";

const spore = createSpore({
  verbose: verbose && !quiet,
  generations: flags["generations"] ? parseInt(flags["generations"]) : undefined,
  sporesPerAngle: flags["spores"] ? parseInt(flags["spores"]) : undefined,
  trails: flags["no-trails"] !== "true",
});

async function run() {
  if (!quiet) {
    console.log(`\n🍄 Reasoning on: "${prompt}"\n`);
  }

  const result = await spore.reason(prompt);

  if (quiet) {
    console.log(result.answer);
    process.exit(0);
  }

  console.log("\n════════════════════════════════════════");
  console.log("ANSWER:");
  console.log("════════════════════════════════════════");
  console.log(result.answer);

  console.log(`\n── Confidence: ${(result.confidence * 100).toFixed(0)}% ──`);

  console.log(`\n── Topology: ${result.topology.shape} ──`);
  if (result.topology.deadAngles.length > 0) {
    console.log(`  Killed: ${result.topology.deadAngles.join(", ")}`);
  }

  if (result.contradictions.length > 0) {
    console.log(`\n── ${result.contradictions.length} Tension(s) ──`);
    for (const c of result.contradictions) {
      console.log(`  [${c.type}] ${c.explanation.slice(0, 120)}`);
    }
  }

  // Compact approach breakdown
  const sorted = Object.entries(result.approachBreakdown)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .filter(([, v]) => (v as number) > 0)
    .slice(0, 5);

  console.log("\n── Top Angles ──");
  for (const [angle, weight] of sorted) {
    const bar = "█".repeat(Math.round((weight as number) * 20));
    console.log(`  ${angle.padEnd(22)} ${bar} ${((weight as number) * 100).toFixed(0)}%`);
  }

  console.log(
    `\n  ${result.meta.totalSpores} spores | ${result.meta.myceliumCalls} deep calls | $${result.meta.costEstimate.toFixed(3)} | ${(result.meta.wallClockMs / 1000).toFixed(1)}s`
  );
}

run().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
