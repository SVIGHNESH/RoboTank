import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { stairSteps, type StairSpec } from "./config";

export type ViewName = "iso" | "side" | "front" | "top" | "rear";

const VIEWS: Record<ViewName, { theta: number; phi: number; r: number }> = {
  iso: { theta: 0.75, phi: 1.05, r: 1250 },
  side: { theta: Math.PI / 2, phi: Math.PI / 2 - 0.01, r: 1300 },
  front: { theta: 0, phi: Math.PI / 2 - 0.01, r: 1100 },
  top: { theta: 0.001, phi: 0.02, r: 1300 },
  rear: { theta: Math.PI + 0.7, phi: 1.1, r: 1250 },
};

function isDark(): boolean {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return true;
  if (attr === "light") return false;
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Renderer, camera, lights, ground and the stair. Scene units are millimetres. */
export class RoverScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly stair = new THREE.Group();
  private readonly stairMat: THREE.MeshStandardMaterial;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const dark = isDark();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(dark ? 0x1a1b1e : 0xedece7);

    this.camera = new THREE.PerspectiveCamera(32, 1, 10, 8000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 300;
    this.controls.maxDistance = 4000;
    this.controls.target.set(0, 55, 0);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a80, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.7);
    sun.position.set(500, 900, 400);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -900;
    sc.right = 1500;
    sc.top = 900;
    sc.bottom = -700;
    sc.near = 100;
    sc.far = 3000;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(-600, 300, -500);
    this.scene.add(fill);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: dark ? 0x26282c : 0xdcdad2, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(3000, 60, dark ? 0x44474d : 0xb8b6ae, dark ? 0x33363b : 0xcfcdc5);
    grid.position.y = 0.5;
    this.scene.add(grid);

    this.stairMat = new THREE.MeshStandardMaterial({ color: dark ? 0x33363c : 0xcfccc2, roughness: 0.9 });
    this.stair.visible = false;
    this.scene.add(this.stair);

    this.setView("iso");
  }

  /** Replace the stair geometry. Visibility is kept. */
  setStair(st: StairSpec): void {
    for (const child of [...this.stair.children]) {
      this.stair.remove(child);
      (child as THREE.Mesh).geometry.dispose();
    }
    for (const [x0, h, len] of stairSteps(st)) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len * 1000, h * 1000, st.depth * 1000), this.stairMat);
      m.position.set((x0 + len / 2) * 1000, (h / 2) * 1000, 0);
      m.receiveShadow = m.castShadow = true;
      this.stair.add(m);
    }
  }

  /** Move the camera to a preset angle around the current target. */
  setView(name: ViewName): void {
    const v = VIEWS[name];
    const t = this.controls.target;
    this.camera.position.set(
      t.x + v.r * Math.sin(v.phi) * Math.cos(v.theta),
      t.y + v.r * Math.cos(v.phi),
      t.z + v.r * Math.sin(v.phi) * Math.sin(v.theta),
    );
    this.controls.update();
  }

  /**
   * Move the orbit target toward a point without changing the orbit angle or distance.
   * `rate` is the fraction of the remaining distance closed per second; Infinity snaps.
   */
  follow(point: THREE.Vector3, dt = 0, rate = Infinity): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const k = rate === Infinity ? 1 : 1 - Math.exp(-rate * dt);
    this.controls.target.lerp(point, k);
    this.camera.position.copy(this.controls.target).add(offset);
  }

  render(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const pr = this.renderer.getPixelRatio();
    if (this.canvas.width !== Math.floor(w * pr) || this.canvas.height !== Math.floor(h * pr)) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
