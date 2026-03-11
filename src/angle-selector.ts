import type { Angle } from "./types.js";
import { GENERAL_ANGLES, CODE_ANGLES } from "./types.js";

const TARGET_ANGLE_COUNT = 9;

export interface AngleSelection {
  angles: Angle[];
  reason: string;
}

// Select angles to keep total spore count at 9
export function selectAngles(
  hasCodeContext: boolean,
  approachWeights?: Record<string, number>,
  topicTag?: string
): AngleSelection {
  if (!hasCodeContext) {
    return {
      angles: [...GENERAL_ANGLES],
      reason: "No code context — using all 9 general angles",
    };
  }

  // Code context present: 4 code angles + top 5 general angles
  const codeAngles: Angle[] = [...CODE_ANGLES];

  // Rank general angles by approach memory weight
  const generalRanked = [...GENERAL_ANGLES].sort((a, b) => {
    const wa = approachWeights?.[a] ?? 1.0;
    const wb = approachWeights?.[b] ?? 1.0;
    return wb - wa;
  });

  const slotsForGeneral = TARGET_ANGLE_COUNT - codeAngles.length; // 5
  const selectedGeneral = generalRanked.slice(0, slotsForGeneral);
  const droppedGeneral = generalRanked.slice(slotsForGeneral);

  return {
    angles: [...codeAngles, ...selectedGeneral],
    reason: `Code context detected — using 4 code angles + top ${slotsForGeneral} general (dropped: ${droppedGeneral.join(", ")})`,
  };
}
