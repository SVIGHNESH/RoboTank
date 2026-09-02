import * as THREE from "three";
import { derived, type RoverSpec } from "./config";

type Pt = [number, number];

/** Convex hull (monotone chain) of two circles sampled in the x-y plane, counter-clockwise. */
function hullOfCircles(c1: Pt, r1: number, c2: Pt, r2: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    pts.push([c1[0] + r1 * Math.cos(a), c1[1] + r1 * Math.sin(a)]);
    pts.push([c2[0] + r2 * Math.cos(a), c2[1] + r2 * Math.sin(a)]);
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let k = pts.length - 1; k >= 0; k--) {
    const p = pts[k]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

interface Segment {
  a: Pt;
  b: Pt;
  len: number;
  start: number;
}

/**
 * One track: the belt loop, its lugs, the drive sprocket and the idler.
 * `advance(mm)` moves the lugs around the loop and spins the wheels by the same distance.
 */
export class TrackBelt {
  readonly group = new THREE.Group();
  private readonly lugs: THREE.Mesh[] = [];
  private readonly lugBase: number[] = [];
  private readonly spinners: { mesh: THREE.Object3D; r: number }[] = [];
  private readonly segments: Segment[] = [];
  private readonly perimeter: number;
  private readonly lugH: number;
  private readonly z: number;

  constructor(spec: RoverSpec, z: number, materials: { rubber: THREE.Material; steel: THREE.Material; axle: THREE.Material }) {
    const d = derived(spec);
    this.z = z;
    this.lugH = spec.lug;
    const outer = hullOfCircles([d.xS, d.yS], d.rearOuterR, [d.xI, d.yI], d.frontOuterR);
    const inner = hullOfCircles([d.xS, d.yS], spec.sprocketR, [d.xI, d.yI], spec.idlerR);

    const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p[0], p[1])));
    shape.holes.push(new THREE.Path(inner.map((p) => new THREE.Vector2(p[0], p[1]))));
    const beltGeo = new THREE.ExtrudeGeometry(shape, { depth: spec.trackW, bevelEnabled: false });
    beltGeo.translate(0, 0, -spec.trackW / 2);
    const belt = new THREE.Mesh(beltGeo, materials.rubber);
    belt.position.z = z;
    belt.castShadow = belt.receiveShadow = true;
    this.group.add(belt);

    let per = 0;
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i]!;
      const b = outer[(i + 1) % outer.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      this.segments.push({ a, b, len, start: per });
      per += len;
    }
    this.perimeter = per;

    const n = Math.round(per / spec.lugPitch);
    const step = per / n;
    const lugGeo = new THREE.BoxGeometry(10, spec.lug, spec.trackW - 6);
    for (let k = 0; k < n; k++) {
      const lug = new THREE.Mesh(lugGeo, materials.rubber);
      lug.castShadow = true;
      this.group.add(lug);
      this.lugs.push(lug);
      this.lugBase.push(k * step);
      this.placeLug(lug, k * step);
    }

    const sprocket = this.cylinder(spec.sprocketR - 4, spec.trackW - 4, materials.steel, d.xS, d.yS, 12);
    const toothGeo = new THREE.BoxGeometry(8, 10, spec.trackW - 10);
    for (let q = 0; q < 12; q++) {
      const tooth = new THREE.Mesh(toothGeo, materials.steel);
      const ta = (q / 12) * Math.PI * 2;
      tooth.position.set(Math.cos(ta) * (spec.sprocketR - 2), Math.sin(ta) * (spec.sprocketR - 2), 0);
      tooth.rotation.z = ta;
      sprocket.add(tooth);
    }
    this.spinners.push({ mesh: sprocket, r: spec.sprocketR });
    const idler = this.cylinder(spec.idlerR - 4, spec.trackW - 4, materials.steel, d.xI, d.yI, 32);
    this.spinners.push({ mesh: idler, r: spec.idlerR });
    this.cylinder(4, spec.trackW + 30, materials.axle, d.xS, d.yS, 16);
    this.cylinder(4, spec.trackW + 30, materials.axle, d.xI, d.yI, 16);

    // support rollers ride on the inside of the bottom run, lower than the sprocket and idler axles
    const runEnd = d.xI - spec.idlerR - 12;
    const rollerY = spec.beltT + spec.lug + spec.rollerR;
    for (let k = 1; k <= spec.rollers; k++) {
      const x = d.xS + ((runEnd - d.xS) * k) / (spec.rollers + 1);
      const roller = this.cylinder(spec.rollerR, spec.trackW - 8, materials.steel, x, rollerY, 28);
      this.spinners.push({ mesh: roller, r: spec.rollerR });
      this.cylinder(4, spec.trackW + 14, materials.axle, x, rollerY, 12);
    }
  }

  private cylinder(r: number, len: number, mat: THREE.Material, x: number, y: number, seg: number): THREE.Mesh {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    g.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, this.z);
    m.castShadow = m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  private placeLug(lug: THREE.Mesh, dist: number): void {
    const per = this.perimeter;
    const d = ((dist % per) + per) % per;
    let seg = this.segments[this.segments.length - 1]!;
    for (const s of this.segments) {
      if (d >= s.start && d < s.start + s.len) {
        seg = s;
        break;
      }
    }
    const t = (d - seg.start) / seg.len;
    const px = seg.a[0] + (seg.b[0] - seg.a[0]) * t;
    const py = seg.a[1] + (seg.b[1] - seg.a[1]) * t;
    const ang = Math.atan2(seg.b[1] - seg.a[1], seg.b[0] - seg.a[0]);
    // The hull is counter-clockwise, so the outward normal is the tangent rotated clockwise.
    const nx = Math.sin(ang);
    const ny = -Math.cos(ang);
    lug.position.set(px + (nx * this.lugH) / 2, py + (ny * this.lugH) / 2, this.z);
    lug.rotation.z = ang;
  }

  /** Belt runs clockwise in the x-y plane: the bottom run moves backward as the rover drives forward. */
  advance(distMm: number): void {
    for (const s of this.spinners) s.mesh.rotation.z = -distMm / s.r;
    this.lugs.forEach((lug, i) => this.placeLug(lug, this.lugBase[i]! - distMm));
  }
}
