import "dotenv/config";
import { createSpore } from "../src/index.js";

async function main() {
  const spore = createSpore({ verbose: true });

  const prompt =
    process.argv[2] ?? "Should a startup build their own auth system or use a third-party provider?";

  console.log(`\nPrompt: "${prompt}"\n`);

  const result = await spore.reason(prompt);

  console.log("\n════════════════════════════════════════");
  console.log("ANSWER:");
  console.log("════════════════════════════════════════");
  console.log(result.answer);

  console.log("\n── Topology ──");
  console.log(`  Shape: ${result.topology.shape}`);
  console.log(`  Surviving angles: ${result.topology.survivingAngles.join(", ")}`);
  console.log(`  Dead angles: ${result.topology.deadAngles.join(", ") || "none"}`);
  console.log(`  Dominant: ${result.topology.dominantAngle ?? "none"}`);

  if (result.contradictions.length > 0) {
    console.log("\n── Contradictions ──");
    for (const c of result.contradictions) {
      console.log(`  [${c.type}] ${c.between[0]} vs ${c.between[1]}`);
      console.log(`    ${c.explanation}`);
    }
  }

  console.log("\n── Approach Breakdown ──");
  const sorted = Object.entries(result.approachBreakdown)
    .sort(([, a], [, b]) => b - a)
    .filter(([, v]) => v > 0);
  for (const [angle, weight] of sorted) {
    const bar = "█".repeat(Math.round(weight * 30));
    console.log(`  ${angle.padEnd(22)} ${bar} ${(weight * 100).toFixed(1)}%`);
  }

  console.log("\n── Meta ──");
  console.log(`  Confidence: ${(result.confidence * 100).toFixed(1)}%`);
  console.log(`  Generations: ${result.meta.generations}`);
  console.log(`  Total spores: ${result.meta.totalSpores}`);
  console.log(`  Surviving: ${result.meta.survivingSpores}`);
  console.log(`  Mycelium calls: ${result.meta.myceliumCalls}`);
  console.log(`  Est. cost: $${result.meta.costEstimate.toFixed(4)}`);
  console.log(`  Wall clock: ${(result.meta.wallClockMs / 1000).toFixed(1)}s`);
}

main().catch(console.error);
