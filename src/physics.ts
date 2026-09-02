import * as CANNON from "cannon-es";
import { DRIVE, derived, stairSteps, type RoverSpec, type StairSpec } from "./config";
import { modeFor, speedCap, type Mode } from "./firmware";

/**
 * Rigid-body model of the rover on the stair. SI units.
 *
 * The chassis is one body with its mass centre at the drawing's CG. Each track is a chain of driven
 * road wheels on hinge constraints; the flat bottom run plus the raised front idler reproduce the belt
 * outline. Friction, load distribution and tipping all come from the solver. Lug hooking on a nosing
 * edge is not modelled, so this is a conservative test of the geometry.
 */

const G_GROUND = 1;
const G_WHEEL = 2;
const G_CHASSIS = 4;

export interface Command {
  /** Forward demand, -1..1. */
  v: number;
  /** Turn demand, -1..1, positive to the left. */
  w: number;
  brake: boolean;
}

export interface Telemetry {
  pitchDeg: number;
  rollDeg: number;
  mode: Mode;
  beltL: number;
  beltR: number;
  /** 0..1, fraction of belt speed not converted to ground speed. */
  slip: number;
  contacts: number;
  tipped: boolean;
  x: number;
  y: number;
}

export class RoverPhysics {
  readonly world = new CANNON.World();
  readonly body: CANNON.Body;
  private readonly wheels: { body: CANNON.Body; local: CANNON.Vec3 }[] = [];
  private readonly hinges: { hinge: CANNON.HingeConstraint; r: number; side: 0 | 1 }[] = [];
  private readonly cg: CANNON.Vec3;
  private beltL = 0;
  private beltR = 0;
  private tipped = false;
  private accumulator = 0;
  private last: Telemetry | null = null;
  private prevPos = new CANNON.Vec3();
  private prevQuat = new CANNON.Quaternion();
  private currPos = new CANNON.Vec3();
  private currQuat = new CANNON.Quaternion();
  /** Simulated seconds since the last reset. */
  elapsed = 0;
  /** Metres of belt driven since the last reset, for the visual tracks. */
  beltDistance = 0;
  static readonly FIXED_DT = 1 / 240;

  constructor(readonly spec: RoverSpec, readonly stairSpec: StairSpec) {
    const d = derived(spec);
    this.cg = new CANNON.Vec3(d.cgAll.x / 1000, d.cgAll.y / 1000, 0);
    const w = this.world;
    w.gravity.set(0, -9.81, 0);
    w.allowSleep = false;
    w.broadphase = new CANNON.NaiveBroadphase();
    (w.solver as CANNON.GSSolver).iterations = 30;
    (w.solver as CANNON.GSSolver).tolerance = 1e-4;

    const matWheel = new CANNON.Material("wheel");
    const matGround = new CANNON.Material("ground");
    w.addContactMaterial(
      new CANNON.ContactMaterial(matWheel, matGround, {
        friction: DRIVE.mu,
        restitution: 0,
        contactEquationStiffness: 1e7,
        contactEquationRelaxation: 3,
        frictionEquationStiffness: 1e7,
        frictionEquationRelaxation: 3,
      }),
    );

    const ground = new CANNON.Body({ mass: 0, material: matGround, collisionFilterGroup: G_GROUND, collisionFilterMask: G_WHEEL | G_CHASSIS });
    ground.addShape(new CANNON.Plane());
    ground.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    w.addBody(ground);

    const stair = new CANNON.Body({ mass: 0, material: matGround, collisionFilterGroup: G_GROUND, collisionFilterMask: G_WHEEL | G_CHASSIS });
    for (const [x0, h, len] of stairSteps(stairSpec)) {
      stair.addShape(new CANNON.Box(new CANNON.Vec3(len / 2, h / 2, stairSpec.depth / 2)), new CANNON.Vec3(x0 + len / 2, h / 2, 0));
    }
    w.addBody(stair);

    const nW = DRIVE.wheelsPerSide;
    const chassisMass = d.totalMass - 2 * nW * DRIVE.wheelMassKg;
    this.body = new CANNON.Body({
      mass: chassisMass,
      material: matGround,
      linearDamping: 0.01,
      angularDamping: 0.02,
      collisionFilterGroup: G_CHASSIS,
      collisionFilterMask: G_GROUND,
    });
    const midY = (spec.floorY + spec.topY) / 2000;
    this.body.addShape(
      new CANNON.Box(new CANNON.Vec3(d.bodyLen / 2000, (spec.topY - spec.floorY) / 2000, (spec.bayHalf + spec.plate) / 1000)),
      new CANNON.Vec3(-0.002 - this.cg.x, midY - this.cg.y, 0),
    );
    const pl = spec.payload;
    if (pl.size > 0) {
      const half = pl.size / 2000;
      this.body.addShape(new CANNON.Box(new CANNON.Vec3(half, half, half)), new CANNON.Vec3(pl.x / 1000 - this.cg.x, d.payloadY / 1000 - this.cg.y, 0));
    }
    this.body.updateMassProperties();
    w.addBody(this.body);

    const rearR = (spec.sprocketR + spec.beltT + spec.lug) / 1000;
    const runR = 0.05;
    const idlerR = (spec.idlerR + spec.beltT + spec.lug) / 1000;
    const wheelSpec: { x: number; y: number; r: number }[] = [];
    const xr = d.xS / 1000;
    const xf = d.xI / 1000 - 0.042;
    for (let k = 0; k < nW - 1; k++) {
      const t = k / (nW - 2);
      const r = rearR + (runR - rearR) * t;
      wheelSpec.push({ x: xr + (xf - xr) * t, y: r, r });
    }
    wheelSpec.push({ x: d.xI / 1000, y: d.yI / 1000, r: idlerR });

    ([d.trackZ / 1000, -d.trackZ / 1000] as const).forEach((z, side) => {
      for (const ws of wheelSpec) {
        const wheel = new CANNON.Body({ mass: DRIVE.wheelMassKg, material: matWheel, collisionFilterGroup: G_WHEEL, collisionFilterMask: G_GROUND });
        wheel.addShape(new CANNON.Sphere(ws.r));
        wheel.updateMassProperties();
        w.addBody(wheel);
        const hinge = new CANNON.HingeConstraint(this.body, wheel, {
          pivotA: new CANNON.Vec3(ws.x - this.cg.x, ws.y - this.cg.y, z),
          axisA: new CANNON.Vec3(0, 0, 1),
          pivotB: new CANNON.Vec3(0, 0, 0),
          axisB: new CANNON.Vec3(0, 0, 1),
          maxForce: 1e3,
        });
        hinge.enableMotor();
        hinge.setMotorMaxForce(DRIVE.torqueNm);
        w.addConstraint(hinge);
        this.wheels.push({ body: wheel, local: new CANNON.Vec3(ws.x, ws.y, z) });
        this.hinges.push({ hinge, r: ws.r, side: side as 0 | 1 });
      }
    });
    this.reset();
  }

  /** Place the rover level on the floor with its origin at x metres. */
  reset(x = -(derived(this.spec).overallLen / 1000) - 0.25): void {
    this.beltL = this.beltR = 0;
    this.tipped = false;
    this.accumulator = 0;
    this.elapsed = 0;
    this.beltDistance = 0;
    this.last = null;
    this.body.position.set(x + this.cg.x, this.cg.y + 0.002, 0);
    this.body.quaternion.set(0, 0, 0, 1);
    this.body.velocity.setZero();
    this.body.angularVelocity.setZero();
    for (const wh of this.wheels) {
      wh.body.position.set(x + wh.local.x, wh.local.y + 0.002, wh.local.z);
      wh.body.quaternion.set(0, 0, 0, 1);
      wh.body.velocity.setZero();
      wh.body.angularVelocity.setZero();
    }
    this.snapshot();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  private snapshot(): void {
    const off = this.axis(this.cg);
    this.body.position.vsub(off, this.currPos);
    this.currQuat.copy(this.body.quaternion);
  }

  private axis(v: CANNON.Vec3): CANNON.Vec3 {
    return this.body.quaternion.vmult(v);
  }

  get pitchDeg(): number {
    return (Math.asin(Math.max(-1, Math.min(1, this.axis(new CANNON.Vec3(1, 0, 0)).y))) * 180) / Math.PI;
  }

  get rollDeg(): number {
    return (Math.asin(Math.max(-1, Math.min(1, this.axis(new CANNON.Vec3(0, 0, 1)).y))) * 180) / Math.PI;
  }

  /** Apply the firmware limits to the command and drive the wheel motors for one sub-step. */
  private control(dt: number, cmd: Command): Mode {
    const mode = modeFor(this.pitchDeg);
    const vT = DRIVE.vMax * speedCap(mode) * cmd.v;
    const wT = cmd.w * DRIVE.turnRate;
    let tL = vT - wT * DRIVE.halfTrackM;
    let tR = vT + wT * DRIVE.halfTrackM;
    if (cmd.brake || this.tipped) tL = tR = 0;
    const step = DRIVE.accel * dt;
    this.beltL += Math.max(-step, Math.min(step, tL - this.beltL));
    this.beltR += Math.max(-step, Math.min(step, tR - this.beltR));
    for (const h of this.hinges) h.hinge.setMotorSpeed((h.side === 0 ? this.beltL : this.beltR) / h.r);
    if (!this.tipped && this.axis(new CANNON.Vec3(0, 1, 0)).y < 0.1) this.tipped = true;
    return mode;
  }

  /**
   * Advance the simulation by dt seconds of wall time using fixed 240 Hz steps.
   * Keeps the previous and current pose so the renderer can interpolate between them.
   */
  step(dt: number, cmd: Command): Telemetry {
    const h = RoverPhysics.FIXED_DT;
    this.accumulator = Math.min(this.accumulator + dt, 0.1);
    let mode: Mode = this.last?.mode ?? "LEVEL DRIVE";
    while (this.accumulator >= h) {
      this.prevPos.copy(this.currPos);
      this.prevQuat.copy(this.currQuat);
      mode = this.control(h, cmd);
      this.world.step(h);
      this.elapsed += h;
      this.beltDistance += ((this.beltL + this.beltR) / 2) * h;
      this.accumulator -= h;
      this.snapshot();
    }
    let contacts = 0;
    for (const c of this.world.contacts) {
      if (c.bi.collisionFilterGroup === G_WHEEL || c.bj.collisionFilterGroup === G_WHEEL) contacts++;
    }
    const vGround = Math.hypot(this.body.velocity.x, this.body.velocity.y);
    const vBelt = Math.abs((this.beltL + this.beltR) / 2);
    this.last = {
      pitchDeg: this.pitchDeg,
      rollDeg: this.rollDeg,
      mode,
      beltL: this.beltL,
      beltR: this.beltR,
      slip: vBelt > 0.02 ? Math.max(0, 1 - vGround / vBelt) : 0,
      contacts,
      tipped: this.tipped,
      x: this.body.position.x,
      y: this.body.position.y,
    };
    return this.last;
  }

  /** Fraction of the next fixed step already elapsed, for render interpolation. */
  get alpha(): number {
    return this.accumulator / RoverPhysics.FIXED_DT;
  }

  /** Pose of the rover origin (ground point under the chassis centre), interpolated between the last two fixed steps. */
  pose(): { position: CANNON.Vec3; quaternion: CANNON.Quaternion } {
    const a = Math.min(1, this.alpha);
    const position = new CANNON.Vec3();
    this.prevPos.lerp(this.currPos, a, position);
    const quaternion = new CANNON.Quaternion();
    this.prevQuat.slerp(this.currQuat, a, quaternion);
    return { position, quaternion };
  }
}
