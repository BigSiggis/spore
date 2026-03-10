import type { Cluster, Spore, Angle } from "./types.js";

const VECTOR_DIM = 32;

// djb2 hash → map to 32-dim vector
function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

export function keywordsToVector(keywords: string[]): number[] {
  const vec = new Float64Array(VECTOR_DIM);
  for (const kw of keywords) {
    const h = djb2(kw.toLowerCase().trim());
    // Spread each keyword across a few dimensions
    for (let i = 0; i < 3; i++) {
      const idx = (h + i * 7) % VECTOR_DIM;
      const sign = (h >> (i + 3)) & 1 ? 1 : -1;
      vec[idx] += sign * (1.0 / (i + 1));
    }
  }

  // Normalize
  let mag = 0;
  for (let i = 0; i < VECTOR_DIM; i++) mag += vec[i] * vec[i];
  mag = Math.sqrt(mag);
  if (mag > 0) {
    for (let i = 0; i < VECTOR_DIM; i++) vec[i] /= mag;
  }

  return Array.from(vec);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom > 0 ? dot / denom : 0;
}

// Agglomerative clustering: merge pairs above similarity threshold
export function clusterSpores(
  spores: Spore[],
  similarityThreshold: number
): Cluster[] {
  const alive = spores.filter((s) => s.alive);
  if (alive.length === 0) return [];

  // Start: each spore is its own cluster
  let clusters: {
    id: number;
    members: Spore[];
    centroid: number[];
  }[] = alive.map((s, i) => ({
    id: i,
    members: [s],
    centroid: [...s.vector],
  }));

  // Iteratively merge closest pair above threshold
  let merged = true;
  while (merged && clusters.length > 1) {
    merged = false;
    let bestSim = -1;
    let bestI = -1;
    let bestJ = -1;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const sim = cosineSimilarity(clusters[i].centroid, clusters[j].centroid);
        if (sim > bestSim) {
          bestSim = sim;
          bestI = i;
          bestJ = j;
        }
      }
    }

    if (bestSim >= similarityThreshold && bestI >= 0 && bestJ >= 0) {
      // Merge j into i
      const ci = clusters[bestI];
      const cj = clusters[bestJ];
      const allMembers = [...ci.members, ...cj.members];

      // Recompute centroid as average
      const newCentroid = new Float64Array(VECTOR_DIM);
      for (const m of allMembers) {
        for (let d = 0; d < VECTOR_DIM; d++) newCentroid[d] += m.vector[d];
      }
      for (let d = 0; d < VECTOR_DIM; d++) newCentroid[d] /= allMembers.length;

      ci.members = allMembers;
      ci.centroid = Array.from(newCentroid);
      clusters.splice(bestJ, 1);
      merged = true;
    }
  }

  // Convert to Cluster type
  return clusters.map((c, i) => {
    // Dominant angle = most frequent angle in cluster
    const angleCounts = new Map<Angle, number>();
    let totalScore = 0;
    for (const m of c.members) {
      angleCounts.set(m.angle, (angleCounts.get(m.angle) ?? 0) + 1);
      totalScore += m.score;
    }
    let dominantAngle = c.members[0].angle;
    let maxCount = 0;
    for (const [angle, count] of angleCounts) {
      if (count > maxCount) {
        maxCount = count;
        dominantAngle = angle;
      }
    }

    return {
      id: i,
      sporeIds: c.members.map((m) => m.id),
      centroid: c.centroid,
      dominantAngle,
      avgScore: totalScore / c.members.length,
    };
  });
}
