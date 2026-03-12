import { describe, it, expect } from "vitest";
import { clusterSpores } from "../src/density.js";
import { keywordsToVector } from "../src/density.js";
import type { Spore } from "../src/types.js";

function makeSpore(
  id: string,
  keywords: string[],
  angle = "analytical" as const,
  alive = true
): Spore {
  return {
    id,
    angle,
    generation: 0,
    parentId: null,
    lean: "test",
    keywords,
    vector: keywordsToVector(keywords),
    score: 0.5,
    alive,
  };
}

describe("keywordsToVector", () => {
  it("returns a 32-dim normalized vector", () => {
    const vec = keywordsToVector(["test", "keyword"]);
    expect(vec.length).toBe(32);

    // Should be normalized (magnitude ≈ 1)
    const mag = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    expect(mag).toBeCloseTo(1.0, 4);
  });

  it("returns zero vector for empty keywords", () => {
    const vec = keywordsToVector([]);
    expect(vec.every((v) => v === 0)).toBe(true);
  });

  it("produces identical vectors for identical keywords", () => {
    const a = keywordsToVector(["security", "audit", "vulnerability"]);
    const b = keywordsToVector(["security", "audit", "vulnerability"]);
    expect(a).toEqual(b);
  });

  it("produces different vectors for different keywords", () => {
    const a = keywordsToVector(["security", "audit"]);
    const b = keywordsToVector(["performance", "optimization"]);
    expect(a).not.toEqual(b);
  });

  it("is case-insensitive", () => {
    const a = keywordsToVector(["Security", "AUDIT"]);
    const b = keywordsToVector(["security", "audit"]);
    expect(a).toEqual(b);
  });
});

describe("clusterSpores", () => {
  it("returns empty array for no spores", () => {
    expect(clusterSpores([], 0.5)).toEqual([]);
  });

  it("puts identical spores into one cluster", () => {
    const kw = ["security", "vulnerability", "injection"];
    const spores = [
      makeSpore("a", kw),
      makeSpore("b", kw),
      makeSpore("c", kw),
    ];

    const clusters = clusterSpores(spores, 0.5);
    expect(clusters.length).toBe(1);
    expect(clusters[0].sporeIds.length).toBe(3);
  });

  it("separates very different spores into distinct clusters", () => {
    // Use keywords that hash to very different vectors
    const spores = [
      makeSpore("a", ["alpha", "beta", "gamma"], "analytical"),
      makeSpore("b", ["alpha", "beta", "gamma"], "analytical"),
      makeSpore("c", ["zebra", "quantum", "paradox"], "lateral"),
      makeSpore("d", ["zebra", "quantum", "paradox"], "lateral"),
    ];

    // High threshold = harder to merge = more clusters
    const clusters = clusterSpores(spores, 0.99);
    expect(clusters.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores dead spores", () => {
    const kw = ["test", "keyword"];
    const spores = [
      makeSpore("a", kw, "analytical", true),
      makeSpore("b", kw, "analytical", false),
    ];

    const clusters = clusterSpores(spores, 0.5);
    const allIds = clusters.flatMap((c) => c.sporeIds);
    expect(allIds).toContain("a");
    expect(allIds).not.toContain("b");
  });

  it("assigns dominant angle correctly", () => {
    const kw = ["shared", "keywords", "here"];
    const spores = [
      makeSpore("a", kw, "adversarial"),
      makeSpore("b", kw, "adversarial"),
      makeSpore("c", kw, "analytical"),
    ];

    const clusters = clusterSpores(spores, 0.5);
    // All same keywords = one cluster, adversarial is most frequent
    expect(clusters.length).toBe(1);
    expect(clusters[0].dominantAngle).toBe("adversarial");
  });

  it("computes avgScore correctly", () => {
    const kw = ["test"];
    const spores = [
      { ...makeSpore("a", kw), score: 0.8 },
      { ...makeSpore("b", kw), score: 0.4 },
    ];

    const clusters = clusterSpores(spores, 0.5);
    expect(clusters[0].avgScore).toBeCloseTo(0.6, 4);
  });
});
