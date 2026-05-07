import * as THREE from 'three';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  SCENE_HEIGHT,
  TOP_STAND_PX,
  rectToPx,
  type Vec,
} from './arena';
import type { Tower } from './tower';
import type { Unit, UnitType } from './unit';

const CAMERA_Y = 760;
const CAMERA_Z = 620;
const GROUND_Z_SCALE = Math.hypot(CAMERA_Y, CAMERA_Z) / CAMERA_Y;
const MODEL_DPR = Math.min(2.25, Math.max(1, window.devicePixelRatio || 1));

interface UnitModel {
  group: THREE.Group;
  parts: THREE.Object3D[];
  prev: Vec;
  hp: number;
}

interface TowerModel {
  group: THREE.Group;
  parts: THREE.Object3D[];
  hp: number;
}

export class ThreeBattleLayer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(
    -ARENA_WIDTH / 2,
    ARENA_WIDTH / 2,
    SCENE_HEIGHT / 2,
    -SCENE_HEIGHT / 2,
    1,
    2500,
  );
  private readonly units = new Map<string, UnitModel>();
  private readonly towers = new Map<string, TowerModel>();

  constructor(
    private readonly parent: HTMLElement,
    private readonly phaserCanvas: HTMLCanvasElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(MODEL_DPR);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas = this.renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '3';
    canvas.style.imageRendering = 'auto';
    this.parent.style.position = 'relative';
    this.parent.appendChild(canvas);

    this.camera.position.set(0, CAMERA_Y, CAMERA_Z);
    this.camera.lookAt(0, 0, 0);
    this.setupLighting();
    this.setupShadowPlane();
    this.resize();
  }

  dispose() {
    for (const model of this.units.values()) this.disposeModel(model.group);
    for (const model of this.towers.values()) this.disposeModel(model.group);
    this.units.clear();
    this.towers.clear();
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }

  sync(units: readonly Unit[], towers: readonly Tower[]) {
    this.resize();
    this.syncTowers(towers);
    this.syncUnits(units);
    this.renderer.render(this.scene, this.camera);
  }

  removeUnit(id: string) {
    const model = this.units.get(id);
    if (!model) return;
    this.disposeModel(model.group);
    this.scene.remove(model.group);
    this.units.delete(id);
  }

  flashUnit(id: string) {
    const model = this.units.get(id);
    if (!model) return;
    for (const part of model.parts) {
      const mesh = part as THREE.Mesh;
      const mat = mesh.material;
      if (!mat || Array.isArray(mat) || !(mat instanceof THREE.MeshStandardMaterial)) continue;
      mat.emissive.setHex(0xffffff);
      mat.emissiveIntensity = 0.55;
    }
    window.setTimeout(() => this.clearFlash(model.parts), 120);
  }

  flashTower(id: string) {
    const model = this.towers.get(id);
    if (!model) return;
    for (const part of model.parts) {
      const mesh = part as THREE.Mesh;
      const mat = mesh.material;
      if (!mat || Array.isArray(mat) || !(mat instanceof THREE.MeshStandardMaterial)) continue;
      mat.emissive.setHex(0xffd267);
      mat.emissiveIntensity = 0.45;
    }
    window.setTimeout(() => this.clearFlash(model.parts), 140);
  }

  destroyTower(id: string) {
    const model = this.towers.get(id);
    if (!model) return;
    model.group.scale.y = 0.38;
    model.group.rotation.x = -0.18;
    model.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const mat = mesh.material;
      if (!mat || Array.isArray(mat) || !(mat instanceof THREE.MeshStandardMaterial)) return;
      mat.transparent = true;
      mat.opacity = 0.42;
    });
  }

  private syncUnits(units: readonly Unit[]) {
    const alive = new Set<string>();
    for (const unit of units) {
      if (unit.isDead) continue;
      alive.add(unit.id);
      let model = this.units.get(unit.id);
      if (!model) {
        model = this.createUnitModel(unit);
        this.units.set(unit.id, model);
        this.scene.add(model.group);
      }

      const pos = worldToThree(unit.x, unit.y);
      model.group.position.set(pos.x, unitLift(unit.type), pos.z);
      const dx = unit.x - model.prev.x;
      const dy = unit.y - model.prev.y;
      if (dx * dx + dy * dy > 0.25) {
        model.group.rotation.y = Math.atan2(dx, dy);
        model.prev = { x: unit.x, y: unit.y };
      }
      model.group.position.y = unitLift(unit.type) + (unit.state === 'moving' ? Math.sin(performance.now() / 110 + unit.x * 0.05) * 1.1 : 0);
      model.hp = unit.hp;
    }

    for (const id of [...this.units.keys()]) {
      if (!alive.has(id)) this.removeUnit(id);
    }
  }

  private syncTowers(towers: readonly Tower[]) {
    for (const tower of towers) {
      let model = this.towers.get(tower.id);
      if (!model) {
        model = this.createTowerModel(tower);
        this.towers.set(tower.id, model);
        this.scene.add(model.group);
      }
      model.hp = tower.hp;
      if (tower.isDestroyed) this.destroyTower(tower.id);
    }
  }

  private createUnitModel(unit: Unit): UnitModel {
    const group = new THREE.Group();
    const parts: THREE.Object3D[] = [];
    const teamColor = unit.team === 'player' ? 0x2f80c8 : 0xd64455;
    const trim = unit.team === 'player' ? 0x8fd1ff : 0xffa0ad;
    const dark = unit.team === 'player' ? 0x163a59 : 0x5e1722;

    const add = (mesh: THREE.Mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parts.push(mesh);
      group.add(mesh);
      return mesh;
    };

    const bodyMat = mat(teamColor, 0.55, 0.38);
    const trimMat = mat(trim, 0.45, 0.42);
    const darkMat = mat(dark, 0.7, 0.3);
    const metalMat = mat(0xcfd8e3, 0.65, 0.35);
    const goldMat = mat(0xf2c14e, 0.6, 0.42);

    switch (unit.type) {
      case 'warrior': {
        add(new THREE.Mesh(new THREE.CapsuleGeometry(7, 11, 5, 10), bodyMat));
        add(new THREE.Mesh(new THREE.SphereGeometry(5.2, 18, 12), metalMat)).position.y = 12;
        const shield = add(new THREE.Mesh(new THREE.CylinderGeometry(4.8, 4.8, 2.2, 18), trimMat));
        shield.rotation.z = Math.PI / 2;
        shield.position.set(-7, 5, 2);
        const sword = add(new THREE.Mesh(new THREE.BoxGeometry(2, 16, 2), metalMat));
        sword.position.set(7, 7, -3);
        sword.rotation.z = -0.45;
        break;
      }
      case 'archer': {
        add(new THREE.Mesh(new THREE.CapsuleGeometry(5.8, 10, 5, 10), bodyMat));
        add(new THREE.Mesh(new THREE.ConeGeometry(6.4, 7, 20), trimMat)).position.y = 12;
        const bow = add(new THREE.Mesh(new THREE.TorusGeometry(7, 0.7, 8, 28, Math.PI * 1.35), goldMat));
        bow.position.set(8, 6, 0);
        bow.rotation.set(Math.PI / 2, 0.2, 0.25);
        const arrow = add(new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 13, 8), metalMat));
        arrow.position.set(7, 6, 0);
        arrow.rotation.z = Math.PI / 2;
        break;
      }
      case 'tank': {
        add(new THREE.Mesh(new THREE.BoxGeometry(22, 11, 18), darkMat)).position.y = 5;
        add(new THREE.Mesh(new THREE.BoxGeometry(17, 13, 14), bodyMat)).position.y = 14;
        add(new THREE.Mesh(new THREE.BoxGeometry(9, 5, 8), trimMat)).position.y = 23;
        const cannon = add(new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 18, 12), metalMat));
        cannon.position.set(8, 22, 0);
        cannon.rotation.z = Math.PI / 2;
        break;
      }
      case 'assassin': {
        add(new THREE.Mesh(new THREE.ConeGeometry(8, 18, 4), darkMat)).position.y = 7;
        add(new THREE.Mesh(new THREE.SphereGeometry(4.8, 18, 10), bodyMat)).position.y = 15;
        for (const x of [-7, 7]) {
          const blade = add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 12, 1.4), metalMat));
          blade.position.set(x, 7, -2);
          blade.rotation.z = x < 0 ? 0.65 : -0.65;
        }
        break;
      }
      case 'squad': {
        for (const [x, z, s] of [
          [-6, -2, 0.8],
          [6, -1, 0.8],
          [0, 6, 0.88],
        ] as const) {
          const mini = add(new THREE.Mesh(new THREE.CapsuleGeometry(4.2 * s, 7 * s, 4, 8), bodyMat));
          mini.position.set(x, 5 * s, z);
          const helm = add(new THREE.Mesh(new THREE.SphereGeometry(3.2 * s, 12, 8), trimMat));
          helm.position.set(x, 11 * s, z);
        }
        break;
      }
      case 'mage': {
        add(new THREE.Mesh(new THREE.ConeGeometry(8.4, 19, 24), bodyMat)).position.y = 7.5;
        add(new THREE.Mesh(new THREE.ConeGeometry(6.2, 9, 24), trimMat)).position.y = 20;
        const orb = add(new THREE.Mesh(new THREE.SphereGeometry(3.8, 18, 12), mat(0xb08fff, 0.1, 0.1)));
        orb.position.set(8, 21, -2);
        const staff = add(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 21, 8), goldMat));
        staff.position.set(7, 10, -2);
        break;
      }
    }

    const base = add(new THREE.Mesh(new THREE.CylinderGeometry(unit.radius * 0.82, unit.radius * 0.92, 2.5, 24), darkMat));
    base.position.y = 1.2;
    group.scale.setScalar(1);
    group.position.copy(worldToThree(unit.x, unit.y));
    return { group, parts, prev: { x: unit.x, y: unit.y }, hp: unit.hp };
  }

  private createTowerModel(tower: Tower): TowerModel {
    const group = new THREE.Group();
    const parts: THREE.Object3D[] = [];
    const r = rectToPx(tower.rect);
    const pos = worldToThree(tower.x, tower.y);
    const isKing = tower.type === 'king';
    const color = tower.team === 'player' ? (isKing ? 0x1f5f9d : 0x2f80c8) : isKing ? 0x9e243d : 0xd64455;
    const trim = tower.team === 'player' ? 0x8fd1ff : 0xffa0ad;
    const stone = mat(color, 0.55, 0.36);
    const roof = mat(trim, 0.45, 0.42);
    const dark = mat(0x151a25, 0.7, 0.32);

    const add = (mesh: THREE.Mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parts.push(mesh);
      group.add(mesh);
      return mesh;
    };

    const width = Math.max(18, r.w * (isKing ? 0.42 : 0.48));
    const depth = Math.max(18, r.h * (isKing ? 0.42 : 0.48));
    const height = isKing ? 36 : 30;
    add(new THREE.Mesh(new THREE.BoxGeometry(width, 8, depth), dark)).position.y = 4;
    add(new THREE.Mesh(new THREE.CylinderGeometry(width * 0.36, width * 0.44, height, isKing ? 8 : 6), stone)).position.y = 8 + height / 2;
    add(new THREE.Mesh(new THREE.ConeGeometry(width * 0.48, isKing ? 18 : 14, isKing ? 8 : 6), roof)).position.y = height + 19;

    const cannon = add(new THREE.Mesh(new THREE.CylinderGeometry(2, 2, isKing ? 22 : 16, 12), dark));
    cannon.position.set(0, height + 10, tower.team === 'player' ? -10 : 10);
    cannon.rotation.x = Math.PI / 2;

    if (isKing) {
      for (const x of [-8, 0, 8]) {
        const crown = add(new THREE.Mesh(new THREE.ConeGeometry(2.4, 7, 5), mat(0xf2c14e, 0.5, 0.38)));
        crown.position.set(x, height + 32, 0);
      }
    }

    group.position.set(pos.x, 0, pos.z);
    return { group, parts, hp: tower.hp };
  }

  private setupLighting() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3d4a5c, 1.35));
    const key = new THREE.DirectionalLight(0xffffff, 2.15);
    key.position.set(-140, 360, 240);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 900;
    key.shadow.camera.left = -260;
    key.shadow.camera.right = 260;
    key.shadow.camera.top = 520;
    key.shadow.camera.bottom = -520;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x8fd1ff, 0.72);
    rim.position.set(180, 180, -260);
    this.scene.add(rim);
  }

  private setupShadowPlane() {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_WIDTH * 2.2, ARENA_HEIGHT * GROUND_Z_SCALE * 2.1),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.2 }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    this.scene.add(plane);
  }

  private resize() {
    const canvasRect = this.phaserCanvas.getBoundingClientRect();
    const parentRect = this.parent.getBoundingClientRect();
    const width = Math.max(1, Math.round(canvasRect.width));
    const height = Math.max(1, Math.round(canvasRect.height));
    const el = this.renderer.domElement;
    el.style.left = `${canvasRect.left - parentRect.left}px`;
    el.style.top = `${canvasRect.top - parentRect.top}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    this.renderer.setSize(width, height, false);
  }

  private disposeModel(root: THREE.Object3D) {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.geometry) return;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) material?.dispose();
    });
  }

  private clearFlash(parts: THREE.Object3D[]) {
    for (const part of parts) {
      const mesh = part as THREE.Mesh;
      const mat = mesh.material;
      if (!mat || Array.isArray(mat) || !(mat instanceof THREE.MeshStandardMaterial)) continue;
      mat.emissive.setHex(0x000000);
      mat.emissiveIntensity = 0;
    }
  }
}

function worldToThree(x: number, y: number): THREE.Vector3 {
  return new THREE.Vector3(
    x - ARENA_WIDTH / 2,
    0,
    (y + TOP_STAND_PX - SCENE_HEIGHT / 2) * GROUND_Z_SCALE,
  );
}

function unitLift(type: UnitType): number {
  return type === 'tank' ? 1.5 : 2.2;
}

function mat(color: number, roughness: number, metalness: number) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
  });
}
