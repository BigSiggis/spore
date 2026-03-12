import { describe, it, expect } from "vitest";
import { hasConverged } from "../src/spore.js";
import { keywordsToVector } from "../src/density.js";
import type { Spore } from "../src/types.js";

function makeSpore(id: string, keywords: string[], alive = true): Spore {
  return {
    id,
    angle: "analytical",
    generation: 0,
    parentId: null,
    lean: "test",
    keywords,
    vector: keywordsToVector(keywords),
    score: 0.5,
    alive,
  };
}

describe("hasConverged", () => {
  it("returns true for 2 or fewer alive spores", () => {
    const spores = [makeSpore("a", ["test"]), makeSpore("b", ["other"])];
    expect(hasConverged(spores, 0.9)).toBe(true);
  });

  it("returns true for 1 alive spore", () => {
    const spores = [makeSpore("a", ["test"])];
    expect(hasConverged(spores, 0.9)).toBe(true);
  });

  it("returns true when all spores have identical vectors", () => {
    const kw = ["security", "audit", "review"];
    const spores = [makeSpore("a", kw), makeSpore("b", kw), makeSpore("c", kw)];
    expect(hasConverged(spores, 0.9)).toBe(true);
  });

  it("returns false when spores are dissimilar", () => {
    const spores = [
      makeSpore("a", ["alpha", "beta", "gamma"]),
      makeSpore("b", ["zebra", "quantum", "paradox"]),
      makeSpore("c", ["music", "rhythm", "melody"]),
    ];
    expect(hasConverged(spores, 0.9)).toBe(false);
  });

  it("ignores dead spores", () => {
    const kw = ["same", "keywords"];
    const spores = [
      makeSpore("a", kw, true),
      makeSpore("b", kw, true),
      makeSpore("c", kw, true),
      makeSpore("d", ["totally", "different", "words"], false), // dead
    ];
    expect(hasConverged(spores, 0.9)).toBe(true);
  });

  it("detects bipolar camps (the bug we fixed)", () => {
    // Two groups that are similar within but different between
    const groupA = ["security", "vulnerability", "exploit"];
    const groupB = ["performance", "optimization", "speed"];
    const spores = [
      makeSpore("a1", groupA),
      makeSpore("a2", groupA),
      makeSpore("a3", groupA),
      makeSpore("b1", groupB),
      makeSpore("b2", groupB),
      makeSpore("b3", groupB),
    ];

    // Should NOT converge — two distinct camps
    expect(hasConverged(spores, 0.9)).toBe(false);
  });
});
