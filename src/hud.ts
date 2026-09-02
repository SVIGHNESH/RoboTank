import type { Telemetry } from "./physics";
import { derived, stairPitchDeg, type RoverSpec, type StairSpec } from "./config";

/** Editable rover fields, in the units shown on the panel. */
export interface RoverFields {
  wheelbase: number;
  sprocketD: number;
  idlerD: number;
  idlerRaise: number;
  trackW: number;
  bayW: number;
  topY: number;
  massKg: number;
  cgX: number;
  cgY: number;
  payloadSize: number;
  payloadMass: number;
  payloadX: number;
  rollers: number;
  rollerD: number;
}

export function fieldsFromSpec(spec: RoverSpec): RoverFields {
  return {
    wheelbase: spec.wheelbase,
    sprocketD: spec.sprocketR * 2,
    idlerD: spec.idlerR * 2,
    idlerRaise: spec.idlerRaise,
    trackW: spec.trackW,
    bayW: spec.bayHalf * 2,
    topY: spec.topY,
    massKg: spec.massKg,
    cgX: spec.cg.x,
    cgY: spec.cg.y,
    payloadSize: spec.payload.size,
    payloadMass: spec.payload.massKg,
    payloadX: spec.payload.x,
    rollers: spec.rollers,
    rollerD: spec.rollerR * 2,
  };
}

export function specFromFields(base: RoverSpec, f: RoverFields): RoverSpec {
  const topY = Math.max(f.topY, base.floorY + 40);
  return {
    ...base,
    id: "custom",
    name: "Custom",
    wheelbase: f.wheelbase,
    sprocketR: f.sprocketD / 2,
    idlerR: f.idlerD / 2,
    idlerRaise: f.idlerRaise,
    trackW: f.trackW,
    bayHalf: f.bayW / 2,
    topY,
    deckY: Math.min(base.deckY, topY - 30),
    massKg: f.massKg,
    cg: { x: f.cgX, y: Math.min(f.cgY, topY) },
    payload: { size: f.payloadSize, massKg: f.payloadMass, x: f.payloadX },
    rollers: Math.round(f.rollers),
    rollerR: f.rollerD / 2,
  };
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e as T;
}

/** All DOM reads and writes live here so the rest of the app stays free of element ids. */
export class Hud {
  readonly canvas = el<HTMLCanvasElement>("c");
  readonly lid = el<HTMLInputElement>("lid");
  readonly deck = el<HTMLInputElement>("deck");
  readonly tracks = el<HTMLInputElement>("tracks");
  readonly payload = el<HTMLInputElement>("payload");
  readonly stair = el<HTMLInputElement>("stair");
  readonly spin = el<HTMLInputElement>("spin");
  readonly playBtn = el<HTMLButtonElement>("play");
  readonly resetBtn = el<HTMLButtonElement>("reset");
  readonly autoBtn = el<HTMLButtonElement>("auto");
  readonly viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-view]"));
  readonly trackRadios = Array.from(document.querySelectorAll<HTMLInputElement>("input[name=trk]"));
  readonly roverInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-rover]"));
  readonly stairInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-stair]"));
  private readonly stairInfo = el("stairinfo");
  private readonly note = el<HTMLDivElement>("note");
  private readonly dims = el<HTMLDivElement>("dims");
  private readonly phase = el("phase");
  private readonly pitch = el("pitch");
  private readonly mode = el("mode");
  private readonly belt = el("belt");
  private readonly slip = el("slip");
  private readonly time = el("time");

  setDims(spec: RoverSpec): void {
    const d = derived(spec);
    const pl = spec.payload;
    this.dims.innerHTML = `${Math.round(d.overallLen)} × ${Math.round(d.overallWidth)} × ${spec.topY + pl.size} mm<br>wheelbase ${spec.wheelbase} · track ${spec.trackW} · Ø${spec.sprocketR * 2} / Ø${spec.idlerR * 2}<br>${spec.massKg.toFixed(2)} kg + ${pl.massKg.toFixed(2)} kg payload = ${d.totalMass.toFixed(2)} kg<br>CG ${Math.round(d.xI - d.cgAll.x)} aft of front axle, ${Math.round(d.cgAll.y)} high`;
  }

  /** Fill the dimension fields from a spec and stair. */
  writeFields(spec: RoverSpec, stair: StairSpec): void {
    const f = fieldsFromSpec(spec) as unknown as Record<string, number>;
    for (const input of this.roverInputs) input.value = String(f[input.dataset.rover ?? ""] ?? "");
    const st: Record<string, number> = { riser: stair.riser * 1000, tread: stair.tread * 1000, steps: stair.steps, depth: stair.depth * 1000 };
    for (const input of this.stairInputs) input.value = String(st[input.dataset.stair ?? ""] ?? "");
    this.describeStair(stair, spec);
  }

  /** Read the dimension fields. Values outside the input limits are clamped. */
  readFields(base: RoverSpec, baseStair: StairSpec): { spec: RoverSpec; stair: StairSpec } {
    const num = (input: HTMLInputElement, fallback: number) => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return fallback;
      return Math.min(Number(input.max), Math.max(Number(input.min), v));
    };
    const f = fieldsFromSpec(base) as unknown as Record<string, number>;
    for (const input of this.roverInputs) {
      const key = input.dataset.rover ?? "";
      f[key] = num(input, f[key] ?? 0);
    }
    const st = { ...baseStair };
    for (const input of this.stairInputs) {
      const key = input.dataset.stair;
      if (key === "riser") st.riser = num(input, st.riser * 1000) / 1000;
      else if (key === "tread") st.tread = num(input, st.tread * 1000) / 1000;
      else if (key === "steps") st.steps = Math.round(num(input, st.steps));
      else if (key === "depth") st.depth = num(input, st.depth * 1000) / 1000;
    }
    const spec = specFromFields(base, f as unknown as RoverFields);
    this.describeStair(st, spec);
    return { spec, stair: st };
  }

  private describeStair(st: StairSpec, spec?: RoverSpec): void {
    const pitch = Math.hypot(st.riser, st.tread) * 1000;
    const floorToSecond = st.riser / Math.sin((stairPitchDeg(st) * Math.PI) / 180) + pitch;
    let text = `Stair ${stairPitchDeg(st).toFixed(1)}° · nosing pitch ${pitch.toFixed(0)} mm · floor to 2nd nosing ${floorToSecond.toFixed(0)} mm · width ${Math.round(st.depth * 1000)} mm`;
    if (spec) {
      const w = derived(spec).overallWidth;
      if (st.depth * 1000 < w) text += ` · narrower than the ${Math.round(w)} mm rover`;
    }
    this.stairInfo.textContent = text;
  }

  showNote(html: string): void {
    this.note.innerHTML = html;
    this.note.hidden = false;
  }

  hideNote(): void {
    this.note.hidden = true;
  }

  setPressed(button: HTMLButtonElement, pressed: boolean, label?: string): void {
    button.setAttribute("aria-pressed", pressed ? "true" : "false");
    if (label !== undefined) button.textContent = label;
  }

  selectView(name: string): void {
    for (const b of this.viewButtons) this.setPressed(b, b.dataset.view === name);
  }

  telemetry(t: Telemetry, phase: string, seconds: number): void {
    this.phase.textContent = phase;
    this.pitch.textContent = `${t.pitchDeg > 0 ? "+" : ""}${t.pitchDeg.toFixed(0)}°`;
    this.mode.textContent = t.tipped ? "TIPPED" : t.mode;
    this.belt.textContent = `${t.beltL.toFixed(2)} / ${t.beltR.toFixed(2)} m/s`;
    this.slip.textContent = `${Math.round(t.slip * 100)}%`;
    this.time.textContent = `${seconds.toFixed(1)} s`;
  }
}
