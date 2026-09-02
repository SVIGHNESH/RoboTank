/**
 * Headless climb test. Runs the rigid-body model for both track lengths and reports whether the
 * rover reaches the landing or tips over. `pnpm sim`.
 */
import { DEFAULT_STAIR, SPECS, landing, type RoverSpec } from "../src/config";
import { RoverPhysics } from "../src/physics";

function run(spec: RoverSpec, seconds = 30): void {
  const sim = new RoverPhysics(spec, DEFAULT_STAIR);
  const top = landing(DEFAULT_STAIR);
  sim.reset();
  const h = 1 / 240;
  let maxPitch = 0;
  let result = "did not reach the landing";
  const trace: string[] = [];
  for (let i = 0; i < seconds * 240; i++) {
    const t = sim.step(h, { v: 1, w: 0, brake: false });
    maxPitch = Math.max(maxPitch, t.pitchDeg);
    if (i % 720 === 0) trace.push(`${(i * h).toFixed(0)}s x=${t.x.toFixed(2)} y=${t.y.toFixed(2)} p=${t.pitchDeg.toFixed(0)}`);
    if (t.tipped) {
      result = `tipped over at t=${(i * h).toFixed(1)}s`;
      break;
    }
    if (t.x > top.x + 0.4 && t.mode === "LEVEL DRIVE" && t.y > top.y - 0.05) {
      result = `climbed the flight, on the landing at t=${(i * h).toFixed(1)}s`;
      break;
    }
  }
  console.log(`${spec.name}: ${result} (max pitch ${maxPitch.toFixed(0)}°)`);
  console.log("  " + trace.join(" | "));
}

for (const spec of Object.values(SPECS)) run(spec);
