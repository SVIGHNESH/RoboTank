/**
 * The stair state machine from sheet RT-100-04 and the operating description.
 * Pitch from the IMU, not the operator, decides the mode; the mode sets the speed cap.
 */

export type Mode = "LEVEL DRIVE" | "TRANSITION" | "CLIMB" | "DESCEND";

export function modeFor(pitchDeg: number): Mode {
  if (pitchDeg > 15) return "CLIMB";
  if (pitchDeg < -15) return "DESCEND";
  if (Math.abs(pitchDeg) >= 10) return "TRANSITION";
  return "LEVEL DRIVE";
}

export function speedCap(mode: Mode): number {
  switch (mode) {
    case "LEVEL DRIVE":
      return 1;
    case "CLIMB":
      return 0.7;
    default:
      return 0.4;
  }
}
