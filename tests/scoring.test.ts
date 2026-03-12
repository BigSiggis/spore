import { describe, it, expect } from "vitest";
import { applyScores } from "../src/scoring.js";
import type { Spore, ScoreBreakdown } from "../src/types.js";

function makeSpore(id: string, angle = "analytical" as const): Spore {
  return {
    id,
    angle,
    generation: 0,
    parentId: null,
    lean: "test lean",
    keywords: ["test"],
    vector: new Array(32).fill(0),
    score: 0,
    alive: true,
  };
}

function makeScores(
  entries: Array<{ id: string; composite: number }>
): Map<string, { breakdown: ScoreBreakdown; composite: number }> {
  const map = new Map<string, { breakdown: ScoreBreakdown; composite: number }>();
  for (const e of entries) {
    map.set(e.id, {
      breakdown: { specificity: 0.5, consistency: 0.5, novelty: 0.5, hedgePenalty: 0.3 },
      composite: e.composite,
    });
  }
  return map;
}

describe("applyScores", () => {
  it("prunes spores below threshold", () => {
    // 5 spores: 3 above threshold, 2 below — minSurvivors=3 won't interfere
    const spores = [
      makeSpore("a"), makeSpore("b"), makeSpore("c"),
      makeSpore("d"), makeSpore("e"),
    ];
    const scores = makeScores([
      { id: "a", composite: 0.8 },
      { id: "b", composite: 0.1 },
      { id: "c", composite: 0.6 },
      { id: "d", composite: 0.2 },
      { id: "e", composite: 0.5 },
    ]);

    applyScores(spores, scores, 0.3);

    expect(spores.find((s) => s.id === "a")!.alive).toBe(true);
    expect(spores.find((s) => s.id === "b")!.alive).toBe(false);
    expect(spores.find((s) => s.id === "c")!.alive).toBe(true);
    expect(spores.find((s) => s.id === "d")!.alive).toBe(false);
    expect(spores.find((s) => s.id === "e")!.alive).toBe(true);
  });

  it("assigns composite scores to spores", () => {
    const spores = [makeSpore("a"), makeSpore("b")];
    const scores = makeScores([
      { id: "a", composite: 0.75 },
      { id: "b", composite: 0.25 },
    ]);

    applyScores(spores, scores, 0.3);

    expect(spores[0].score).toBe(0.75);
    expect(spores[1].score).toBe(0.25);
  });

  it("guarantees minimum survivors even if all below threshold", () => {
    const spores = [
      makeSpore("a"),
      makeSpore("b"),
      makeSpore("c"),
      makeSpore("d"),
      makeSpore("e"),
    ];
    const scores = makeScores([
      { id: "a", composite: 0.1 },
      { id: "b", composite: 0.15 },
      { id: "c", composite: 0.2 },
      { id: "d", composite: 0.05 },
      { id: "e", composite: 0.25 },
    ]);

    // All below 0.3 threshold, but minSurvivors=3 should keep top 3
    applyScores(spores, scores, 0.3, 3);

    const alive = spores.filter((s) => s.alive);
    expect(alive.length).toBe(3);

    // Top 3 by score: e(0.25), c(0.2), b(0.15)
    const aliveIds = alive.map((s) => s.id).sort();
    expect(aliveIds).toEqual(["b", "c", "e"]);
  });

  it("does not revive more than needed for minSurvivors", () => {
    const spores = [makeSpore("a"), makeSpore("b"), makeSpore("c"), makeSpore("d")];
    const scores = makeScores([
      { id: "a", composite: 0.8 },
      { id: "b", composite: 0.6 },
      { id: "c", composite: 0.5 },
      { id: "d", composite: 0.1 },
    ]);

    applyScores(spores, scores, 0.3, 3);

    // a, b, c are above threshold — already 3 alive, d stays dead
    const alive = spores.filter((s) => s.alive);
    expect(alive.length).toBe(3);
    expect(spores.find((s) => s.id === "d")!.alive).toBe(false);
  });

  it("handles spores with no matching score (unscored)", () => {
    const spores = [makeSpore("a"), makeSpore("b")];
    const scores = makeScores([{ id: "a", composite: 0.8 }]);
    // "b" has no score entry

    applyScores(spores, scores, 0.3);

    expect(spores.find((s) => s.id === "a")!.score).toBe(0.8);
    // b keeps default score of 0, stays alive (no score entry means no pruning applied)
    expect(spores.find((s) => s.id === "b")!.score).toBe(0);
    expect(spores.find((s) => s.id === "b")!.alive).toBe(true);
  });
});
