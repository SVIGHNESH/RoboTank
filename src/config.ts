/**
 * Geometry and drive constants for the rover, taken from drawing set RT-100 Rev 2.1.
 * Lengths are millimetres unless a name says otherwise. Physics converts to metres.
 * Rover frame: x forward, y up, z to the left track. Origin is the ground point under the chassis centre.
 */

export interface RoverSpec {
  id: "rev21" | "delta10" | "custom";
  name: string;
  /** Distance between rear sprocket and front idler axles. */
  wheelbase: number;
  sprocketR: number;
  idlerR: number;
  /** Front idler axle raised above the sprocket axle line for the approach angle. */
  idlerRaise: number;
  trackW: number;
  beltT: number;
  lug: number;
  lugPitch: number;
  /** Half width of the chassis bay between the side plates. */
  bayHalf: number;
  plate: number;
  floorY: number;
  deckY: number;
  topY: number;
  massKg: number;
  /** Centre of gravity of the bare rover relative to the rover origin, mm. */
  cg: { x: number; y: number };
  /** Cubic payload box carried on the lid. */
  payload: PayloadSpec;
}

export interface PayloadSpec {
  /** Edge length of the cube, mm. */
  size: number;
  massKg: number;
  /** Centre of the box forward of the chassis centre, mm. */
  x: number;
}

export const DEFAULT_PAYLOAD: PayloadSpec = { size: 100, massKg: 0.5, x: 0 };

export const REV21: RoverSpec = {
  id: "rev21",
  name: "Rev 2.1 track, 450 mm",
  wheelbase: 384,
  sprocketR: 40,
  idlerR: 30,
  idlerRaise: 15,
  trackW: 50,
  beltT: 8,
  lug: 6,
  lugPitch: 30,
  bayHalf: 80,
  plate: 4,
  floorY: 35,
  deckY: 75,
  topY: 110,
  massKg: 3.07,
  cg: { x: 42, y: 88 },
  payload: DEFAULT_PAYLOAD,
};

/** Δ10, adopted in Rev 2.2: the only track length the physics model climbs the first riser with. */
export const DELTA10: RoverSpec = {
  ...REV21,
  id: "delta10",
  name: "Rev 2.2 Δ10 track, 700 mm",
  wheelbase: 620,
  /** Longer plates, 49-link tracks and four support rollers, per RT-100 sheet 4 Rev 2.2. */
  massKg: 4.0,
};

export const SPECS: Record<"rev21" | "delta10", RoverSpec> = { rev21: REV21, delta10: DELTA10 };

/** Derived values used by every module. */
export function derived(spec: RoverSpec) {
  const rearY = spec.sprocketR + spec.beltT + spec.lug;
  const frontY = spec.idlerR + spec.beltT + spec.lug + spec.idlerRaise;
  const trackZ = spec.bayHalf + spec.plate + spec.trackW / 2 - 4;
  const pl = spec.payload;
  const totalMass = spec.massKg + pl.massKg;
  const plY = spec.topY + pl.size / 2;
  const cgAll = {
    x: (spec.cg.x * spec.massKg + pl.x * pl.massKg) / totalMass,
    y: (spec.cg.y * spec.massKg + plY * pl.massKg) / totalMass,
  };
  return {
    /** Rover plus payload mass, kg. */
    totalMass,
    /** Combined centre of gravity, mm from the rover origin. */
    cgAll,
    /** Payload box centre height, mm. */
    payloadY: plY,
    /** Track centreline offset from the rover centreline. */
    trackZ,
    overallWidth: 2 * (trackZ + spec.trackW / 2),
    xS: -spec.wheelbase / 2,
    xI: spec.wheelbase / 2,
    yS: rearY,
    yI: frontY,
    rearOuterR: spec.sprocketR + spec.beltT,
    frontOuterR: spec.idlerR + spec.beltT,
    bodyLen: spec.wheelbase + 20,
    overallLen: spec.wheelbase + spec.sprocketR + spec.idlerR + 2 * spec.beltT,
  };
}

/** Stair geometry, metres. The last step is a long landing. */
export interface StairSpec {
  riser: number;
  tread: number;
  /** Number of risers before the landing. */
  steps: number;
  landing: number;
  depth: number;
}

export const DEFAULT_STAIR: StairSpec = { riser: 0.18, tread: 0.28, steps: 3, landing: 2.0, depth: 0.34 };

/** Boxes [x0, height, length] that make up the stair, floor level at y = 0. */
export function stairSteps(st: StairSpec): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < st.steps; i++) {
    const last = i === st.steps - 1;
    out.push([i * st.tread, (i + 1) * st.riser, last ? st.landing : st.tread]);
  }
  return out;
}

export function stairPitchDeg(st: StairSpec): number {
  return (Math.atan2(st.riser, st.tread) * 180) / Math.PI;
}

/** Landing edge x and top y, metres. */
export function landing(st: StairSpec): { x: number; y: number } {
  return { x: (st.steps - 1) * st.tread, y: st.steps * st.riser };
}

/** Drivetrain and simulation parameters, SI. */
export const DRIVE = {
  /** Track speed at 100 % on level ground. */
  vMax: 0.42,
  accel: 0.8,
  /** Motor torque per side, 37 mm 1:70 gearmotor. */
  torqueNm: 1.0,
  /** Effective friction of TPU lugs on a hard stair. */
  mu: 1.0,
  /** Road-wheel proxies per side in the physics model. More wheels give a flatter bottom run. */
  wheelsPerSide: 11,
  wheelMassKg: 0.08,
  /** Half the track centre spacing, for differential steering. */
  halfTrackM: 0.105,
  turnRate: 1.2,
};
