import * as THREE from "three";
import { derived, type RoverSpec } from "./config";
import { TrackBelt } from "./track";

export interface RoverModel {
  spec: RoverSpec;
  group: THREE.Group;
  tracks: THREE.Group;
  belts: TrackBelt[];
  lid: THREE.Object3D;
  estop: THREE.Object3D;
  deck: THREE.Group;
  payload: THREE.Object3D;
  /** Advance both belts by a driven distance in millimetres. */
  advance(distMm: number): void;
}

const M = {
  al: new THREE.MeshStandardMaterial({ color: 0xb4b8be, metalness: 0.3, roughness: 0.65 }),
  alDark: new THREE.MeshStandardMaterial({ color: 0xa9adb3, metalness: 0.4, roughness: 0.55 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0, roughness: 0.95 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x6e7a8a, metalness: 0.7, roughness: 0.35 }),
  batt: new THREE.MeshStandardMaterial({ color: 0x2f6f4f, metalness: 0.1, roughness: 0.6 }),
  pcb: new THREE.MeshStandardMaterial({ color: 0x1f5f9f, metalness: 0.2, roughness: 0.6 }),
  red: new THREE.MeshStandardMaterial({ color: 0xb42318, metalness: 0.2, roughness: 0.5 }),
  lens: new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.6, roughness: 0.2 }),
  crate: new THREE.MeshStandardMaterial({ color: 0xc8a25a, metalness: 0.05, roughness: 0.85 }),
  strap: new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.1, roughness: 0.9 }),
};

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

function cylZ(r: number, len: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, seg = 32): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Build the rover from the drawing dimensions. Every part is placed from the spec, nothing is sculpted. */
export function buildRover(spec: RoverSpec): RoverModel {
  const d = derived(spec);
  const group = new THREE.Group();
  const { bayHalf, plate, floorY, deckY, topY } = spec;
  const bodyLen = d.bodyLen;
  const bodyX = -2;

  const tracks = new THREE.Group();
  group.add(tracks);
  const belts = [d.trackZ, -d.trackZ].map((z) => {
    const belt = new TrackBelt(spec, z, { rubber: M.rubber, steel: M.steel, axle: M.alDark });
    tracks.add(belt.group);
    return belt;
  });

  const frame = new THREE.Group();
  group.add(frame);
  const midY = (floorY + topY) / 2;
  const wallH = topY - floorY;
  box(bodyLen, wallH, plate, M.al, bodyX, midY, bayHalf + plate / 2, frame);
  box(bodyLen, wallH, plate, M.al, bodyX, midY, -bayHalf - plate / 2, frame);
  box(bodyLen, plate, bayHalf * 2, M.alDark, bodyX, floorY + plate / 2, 0, frame);
  box(plate, wallH, bayHalf * 2, M.al, bodyX + bodyLen / 2 - plate / 2, midY, 0, frame);
  box(plate, wallH, bayHalf * 2, M.al, bodyX - bodyLen / 2 + plate / 2, midY, 0, frame);
  for (const side of [1, -1]) {
    const zb = side * (bayHalf + plate + 3);
    cylZ(14, 6, M.alDark, d.xS, d.yS, zb, frame, 24);
    cylZ(11, 6, M.alDark, d.xI, d.yI, zb, frame, 24);
  }

  const lid = box(bodyLen, 2, bayHalf * 2 + plate * 2, M.al, bodyX, topY - 1, 0, frame);

  const deck = new THREE.Group();
  frame.add(deck);
  box(bodyLen - 8, plate, bayHalf * 2 - 2, M.alDark, bodyX, deckY, 0, deck);
  box(60, 2, 40, M.pcb, -20, deckY + 3, 0, deck);
  box(18, 3, 18, M.lens, -28, deckY + 5.5, 0, deck);
  box(16, 2, 14, M.red, spec.cg.x, deckY + 3, 0, deck);
  box(40, 12, 30, M.pcb, -150, deckY + 8, 30, deck);
  box(40, 12, 30, M.pcb, -150, deckY + 8, -30, deck);
  box(36, 6, 26, M.alDark, -150, deckY + 17, 30, deck);
  box(36, 6, 26, M.alDark, -150, deckY + 17, -30, deck);
  box(30, 8, 18, M.pcb, 120, deckY + 6, -40, deck);
  box(20, 10, 10, M.lens, 120, deckY + 7, 0, deck);
  box(22, 10, 12, M.lens, 120, deckY + 7, 30, deck);
  box(14, 2, 12, M.pcb, -60, deckY + 3, 55, deck);

  const estop = new THREE.Group();
  frame.add(estop);
  const button = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 10, 32), M.red);
  button.position.set(-120, topY + 7, 0);
  button.castShadow = true;
  estop.add(button);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, 3, 32), M.alDark);
  base.position.set(-120, topY + 1.5, 0);
  estop.add(base);

  box(140, 25, 45, M.batt, 60, floorY + plate + 12.5, 0, frame);

  // payload cube on the lid, strapped down
  const payload = new THREE.Group();
  frame.add(payload);
  const pl = spec.payload;
  box(pl.size, pl.size, pl.size, M.crate, pl.x, d.payloadY, 0, payload);
  box(pl.size + 2, 4, 12, M.strap, pl.x, topY + pl.size + 1, 0, payload);
  box(4, pl.size + 2, 12, M.strap, pl.x - pl.size / 2 - 1, d.payloadY, 0, payload);
  box(4, pl.size + 2, 12, M.strap, pl.x + pl.size / 2 + 1, d.payloadY, 0, payload);

  for (const side of [1, -1]) {
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(18.5, 18.5, 70, 32), M.steel);
    motor.geometry.rotateX(Math.PI / 2);
    motor.position.set(d.xS, d.yS, side * (bayHalf - 36));
    motor.castShadow = true;
    frame.add(motor);
    const encoder = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 10, 24), M.lens);
    encoder.geometry.rotateX(Math.PI / 2);
    encoder.position.set(d.xS, d.yS, side * (bayHalf - 76));
    frame.add(encoder);
  }

  const cam = new THREE.Group();
  cam.position.set(bodyX + bodyLen / 2 + 2, 92, 0);
  cam.rotation.z = (-20 * Math.PI) / 180;
  frame.add(cam);
  box(10, 18, 22, M.alDark, 4, 0, 0, cam);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 6, 24), M.lens);
  lens.geometry.rotateZ(Math.PI / 2);
  lens.position.set(11, 0, 0);
  cam.add(lens);

  box(4, 10, 14, M.red, bodyX + bodyLen / 2 + 2, 60, 0, frame);
  box(12, 4, 12, M.red, d.xI - 10, floorY - 2, bayHalf - 14, frame);
  box(12, 4, 12, M.red, d.xI - 10, floorY - 2, -(bayHalf - 14), frame);
  for (let v = 0; v < 5; v++) box(1, 30, 2, M.lens, bodyX - bodyLen / 2 - 0.5, midY, 30 - v * 8, frame);

  return {
    spec,
    group,
    tracks,
    belts,
    lid,
    estop,
    deck,
    payload,
    advance(distMm) {
      for (const b of belts) b.advance(distMm);
    },
  };
}
