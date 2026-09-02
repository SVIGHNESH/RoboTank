import "./style.css";
import * as THREE from "three";
import { DEFAULT_STAIR, SPECS, landing, stairPitchDeg, type RoverSpec, type StairSpec } from "./config";
import { Hud } from "./hud";
import { RoverPhysics, type Command, type Telemetry } from "./physics";
import { buildRover, type RoverModel } from "./rover";
import { RoverScene, type ViewName } from "./scene";

/**
 * One animation system: the rigid-body simulation drives the model, the HUD and the camera.
 * Play runs it, Auto holds the stick forward, keys take over when Auto is off.
 * Every dimension of the rover and the stair is editable; a change rebuilds model, stair and physics.
 */

type Phase = "Ready" | "Approach" | "Climbing" | "Landing" | "Climbed" | "Tipped" | "Paused";

const hud = new Hud();
const scene = new RoverScene(hud.canvas);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const keys = new Set<string>();
const FOLLOW_RATE = 6;
const CAMERA_LIFT = new THREE.Vector3(0, 55, 0);

let spec: RoverSpec = SPECS.rev21;
let stair: StairSpec = { ...DEFAULT_STAIR };
let rover: RoverModel = buildRover(spec);
let physics = new RoverPhysics(spec, stair);
scene.scene.add(rover.group);
scene.setStair(stair);
hud.setDims(spec);
hud.writeFields(spec, stair);

const state = {
  playing: false,
  auto: true,
  phase: "Ready" as Phase,
  lastFrame: performance.now(),
};

// ---------- placement ----------
function poseFromPhysics(): void {
  const p = physics.pose();
  rover.group.position.set(p.position.x * 1000, p.position.y * 1000, p.position.z * 1000);
  rover.group.quaternion.set(p.quaternion.x, p.quaternion.y, p.quaternion.z, p.quaternion.w);
  rover.advance(physics.beltDistance * 1000);
}

function placeLevel(): void {
  rover.group.position.set(0, 0, 0);
  rover.group.quaternion.identity();
  rover.advance(0);
  scene.follow(new THREE.Vector3(0, 55, 0));
}

function placeOnStair(): void {
  // Rear axle contact on the first nosing; the second nosing then lies on the same track line.
  const a = (stairPitchDeg(stair) * Math.PI) / 180;
  const hw = spec.wheelbase / 2;
  rover.group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
  rover.group.position.set(hw * Math.cos(a), stair.riser * 1000 + hw * Math.sin(a), 0);
  scene.follow(new THREE.Vector3(stair.tread * 500, stair.riser * 1000 + 120, 0));
}

// ---------- climb control ----------
function setPhase(phase: Phase): void {
  state.phase = phase;
}

function play(): void {
  scene.stair.visible = true;
  hud.stair.checked = true;
  if (state.phase === "Climbed" || state.phase === "Tipped") reset();
  poseFromPhysics();
  scene.follow(rover.group.position.clone().add(CAMERA_LIFT));
  state.playing = true;
  state.lastFrame = performance.now();
  setPhase("Approach");
  hud.setPressed(hud.playBtn, true, "Pause");
  hud.hideNote();
  hud.canvas.focus();
}

function pause(): void {
  state.playing = false;
  setPhase("Paused");
  hud.setPressed(hud.playBtn, false, "Play");
}

function reset(): void {
  state.playing = false;
  physics.reset();
  poseFromPhysics();
  setPhase("Ready");
  hud.setPressed(hud.playBtn, false, "Play");
  hud.hideNote();
  scene.follow(rover.group.position.clone().add(CAMERA_LIFT));
  hud.telemetry(physics.step(0, { v: 0, w: 0, brake: true }), state.phase, 0);
}

function finish(t: Telemetry): void {
  state.playing = false;
  hud.setPressed(hud.playBtn, false, "Replay");
  const riser = Math.round(stair.riser * 1000);
  const tread = Math.round(stair.tread * 1000);
  if (t.tipped) {
    setPhase("Tipped");
    hud.showNote(
      `<b>Tipped over.</b> On a ${riser} × ${tread} stair the rear stayed on the floor while the nosing slid along the belt, and the centre of gravity never passed over the step edge. A longer wheelbase, a lower or more forward centre of gravity, or a smaller riser changes that.`,
    );
  } else {
    setPhase("Climbed");
    hud.showNote(`<b>Flight climbed in ${physics.elapsed.toFixed(1)} s.</b> ${stair.steps} × ${riser} × ${tread} steps, rigid-body physics, friction 1.0, motor torque 1.0 N·m per side.`);
  }
}

function command(): Command {
  if (state.auto) return { v: 1, w: 0, brake: false };
  return {
    v: keys.has("w") || keys.has("arrowup") ? 1 : keys.has("s") || keys.has("arrowdown") ? -1 : 0,
    w: keys.has("a") || keys.has("arrowleft") ? 1 : keys.has("d") || keys.has("arrowright") ? -1 : 0,
    brake: keys.has(" "),
  };
}

function simulate(dt: number): void {
  const t = physics.step(reduceMotion ? 0 : dt, command());
  poseFromPhysics();
  scene.follow(rover.group.position.clone().add(CAMERA_LIFT), dt, FOLLOW_RATE);
  const top = landing(stair);

  if (t.tipped) {
    finish(t);
  } else if (state.auto && t.x > top.x + 0.4 && t.y > top.y - 0.05 && t.mode === "LEVEL DRIVE") {
    finish(t);
  } else if (t.mode === "CLIMB" || t.mode === "TRANSITION") {
    setPhase("Climbing");
  } else if (t.y > top.y - 0.05) {
    setPhase("Landing");
  } else if (state.phase !== "Approach") {
    setPhase("Approach");
  }
  hud.telemetry(t, state.phase, physics.elapsed);
}

// ---------- rebuild for new dimensions ----------
function rebuild(nextSpec: RoverSpec, nextStair: StairSpec): void {
  const wasPlaying = state.playing;
  scene.scene.remove(rover.group);
  spec = nextSpec;
  stair = nextStair;
  rover = buildRover(spec);
  rover.lid.visible = rover.estop.visible = hud.lid.checked;
  rover.deck.visible = hud.deck.checked;
  rover.tracks.visible = hud.tracks.checked;
  rover.payload.visible = hud.payload.checked;
  scene.scene.add(rover.group);
  scene.setStair(stair);
  physics = new RoverPhysics(spec, stair);
  hud.setDims(spec);
  reset();
  if (wasPlaying) play();
  else if (hud.stair.checked) placeOnStair();
  else placeLevel();
}

function selectPreset(id: string): void {
  if (id === "custom") {
    applyFields();
    return;
  }
  const preset = { ...SPECS[id as "rev21" | "delta10"], payload: spec.payload };
  hud.writeFields(preset, stair);
  rebuild(preset, stair);
}

let fieldTimer = 0;
function applyFields(): void {
  const next = hud.readFields(spec, stair);
  const customRadio = hud.trackRadios.find((r) => r.value === "custom");
  if (customRadio) customRadio.checked = true;
  rebuild(next.spec, next.stair);
}

// ---------- wiring ----------
for (const b of hud.viewButtons) {
  b.addEventListener("click", () => {
    const name = (b.dataset.view ?? "iso") as ViewName;
    hud.selectView(name);
    scene.setView(name);
  });
}
hud.lid.addEventListener("change", () => {
  rover.lid.visible = rover.estop.visible = hud.lid.checked;
});
hud.deck.addEventListener("change", () => {
  rover.deck.visible = hud.deck.checked;
});
hud.tracks.addEventListener("change", () => {
  rover.tracks.visible = hud.tracks.checked;
});
hud.payload.addEventListener("change", () => {
  rover.payload.visible = hud.payload.checked;
});
hud.stair.addEventListener("change", () => {
  scene.stair.visible = hud.stair.checked;
  if (hud.stair.checked) {
    if (!state.playing && state.phase === "Ready") placeOnStair();
  } else {
    reset();
    placeLevel();
  }
});
hud.spin.addEventListener("change", () => {
  scene.controls.autoRotate = hud.spin.checked && !reduceMotion;
});
hud.playBtn.addEventListener("click", () => (state.playing ? pause() : play()));
hud.resetBtn.addEventListener("click", () => {
  reset();
  if (!hud.stair.checked) placeLevel();
});
hud.autoBtn.addEventListener("click", () => {
  state.auto = !state.auto;
  hud.setPressed(hud.autoBtn, state.auto);
  if (!state.auto) hud.canvas.focus();
});
for (const r of hud.trackRadios) {
  r.addEventListener("change", () => selectPreset(r.value));
}
for (const input of [...hud.roverInputs, ...hud.stairInputs]) {
  input.addEventListener("input", () => {
    window.clearTimeout(fieldTimer);
    fieldTimer = window.setTimeout(applyFields, 250);
  });
  input.addEventListener("change", () => {
    window.clearTimeout(fieldTimer);
    applyFields();
  });
}
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  if (["w", "a", "s", "d", " ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
    if (!state.playing) return;
    keys.add(k);
    e.preventDefault();
  } else if (k === "r") {
    reset();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

// ---------- start ----------
if (location.hash.includes("long")) {
  const radio = hud.trackRadios.find((r) => r.value === "delta10");
  if (radio) radio.checked = true;
  hud.writeFields(SPECS.delta10, stair);
  rebuild(SPECS.delta10, stair);
}
if (location.hash.startsWith("#physics") || location.hash.startsWith("#climb")) {
  play();
} else if (location.hash.startsWith("#stair")) {
  scene.stair.visible = true;
  hud.stair.checked = true;
  placeOnStair();
} else {
  reset();
  placeLevel();
}

function frame(now: number): void {
  const dt = Math.min(0.05, (now - state.lastFrame) / 1000) || 0.016;
  state.lastFrame = now;
  if (state.playing) simulate(dt);
  scene.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
