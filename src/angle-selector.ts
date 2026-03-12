import type { Angle, CustomAngle } from "./types.js";
import { GENERAL_ANGLES, CODE_ANGLES } from "./types.js";

const TARGET_ANGLE_COUNT = 9;

export interface AngleSelection {
  angles: Angle[];
  customAngles: CustomAngle[];
  reason: string;
}

// Select angles to keep total spore count at ~9
export function selectAngles(
  hasCodeContext: boolean,
  approachWeights?: Record<string, number>,
  topicTag?: string,
  customAngles?: CustomAngle[]
): AngleSelection {
  const custom = customAngles ?? [];
  const customGeneral = custom.filter((c) => !c.isCodeAngle);
  const customCode = custom.filter((c) => c.isCodeAngle);

  if (!hasCodeContext) {
    // No code: all 9 general + any custom general angles
    const slots = Math.max(0, TARGET_ANGLE_COUNT - customGeneral.length);
    const rankedGeneral = [...GENERAL_ANGLES].sort((a, b) => {
      const wa = approachWeights?.[a] ?? 1.0;
      const wb = approachWeights?.[b] ?? 1.0;
      return wb - wa;
    });
    const selected = rankedGeneral.slice(0, slots);

    return {
      angles: selected,
      customAngles: customGeneral,
      reason: custom.length > 0
        ? `${selected.length} general + ${customGeneral.length} custom angles`
        : "No code context — using all 9 general angles",
    };
  }

  // Code context: 4 code angles + custom code angles + fill rest with general
  const codeAngles: Angle[] = [...CODE_ANGLES];
  const allCustom = [...customCode, ...customGeneral];
  const slotsForGeneral = Math.max(0, TARGET_ANGLE_COUNT - codeAngles.length - allCustom.length);

  const rankedGeneral = [...GENERAL_ANGLES].sort((a, b) => {
    const wa = approachWeights?.[a] ?? 1.0;
    const wb = approachWeights?.[b] ?? 1.0;
    return wb - wa;
  });

  const selectedGeneral = rankedGeneral.slice(0, slotsForGeneral);
  const droppedGeneral = rankedGeneral.slice(slotsForGeneral);

  return {
    angles: [...codeAngles, ...selectedGeneral],
    customAngles: allCustom,
    reason: `Code context — ${codeAngles.length} code + ${selectedGeneral.length} general${allCustom.length > 0 ? ` + ${allCustom.length} custom` : ""} (dropped: ${droppedGeneral.join(", ")})`,
  };
}
