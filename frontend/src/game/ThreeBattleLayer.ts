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
import type { SpellCode } from './spells';

const CAMERA_Y = 760;
const CAMERA_Z = 620;
const GROUND_Z_SCALE = Math.hypot(CAMERA_Y, CAMERA_Z) / CAMERA_Y;
const MODEL_DPR = Math.min(2.25, Math.max(1, window.devicePixelRatio || 1));

interface UnitModel {
  group: THREE.Group;
  parts: THREE.Object3D[];
  /** Базовое смещение «тела» по Y — для walk-bob. */
  bodyBaseY: number;
  body?: THREE.Object3D;
  /** Ноги — оси крутим по X для шаговой анимации. */
  legLeft?: THREE.Object3D;
  legRight?: THREE.Object3D;
  /** Правая «ударная» рука. */
  armRight?: THREE.Object3D;
  armLeft?: THREE.Object3D;
  weapon?: THREE.Object3D;
  prev: Vec;
  hp: number;
  /** Анимация удара: до этого времени (performance.now()) играть свинг. */
  attackUntil: number;
  attackAngle: number;
  /** Состояние смерти — пройдена ли уже визуализация. */
  dying: boolean;
}

interface TowerModel {
  group: THREE.Group;
  parts: THREE.Object3D[];
  hp: number;
  destroyedAnimStart: number;
  isDestroyed: boolean;
}

interface SpellEffect {
  root: THREE.Object3D;
  start: number;
  duration: number;
  update?: (tNorm: number) => void;
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
  private readonly spellEffects: SpellEffect[] = [];

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
    for (const eff of this.spellEffects) this.disposeModel(eff.root);
    this.units.clear();
    this.towers.clear();
    this.spellEffects.length = 0;
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }

  sync(units: readonly Unit[], towers: readonly Tower[]) {
    this.resize();
    this.syncTowers(towers);
    this.syncUnits(units);
    this.syncSpells();
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

  /**
   * Запускает анимацию атаки у юнита: модель «толкается» в сторону цели,
   * правая рука свингует. Угол — в плоскости арены (рад).
   */
  attackAnim(unitId: string, angle: number) {
    const m = this.units.get(unitId);
    if (!m) return;
    m.attackUntil = performance.now() + 240;
    m.attackAngle = angle;
  }

  /** Анимация разрушения башни: трескается, опускается, осколки разлетаются. */
  destroyTower(id: string) {
    const model = this.towers.get(id);
    if (!model || model.isDestroyed) return;
    model.isDestroyed = true;
    model.destroyedAnimStart = performance.now();

    // Вырвать пару кусков как осколки.
    const debrisParent = new THREE.Group();
    debrisParent.position.copy(model.group.position);
    debrisParent.position.y += 18;
    this.scene.add(debrisParent);

    const debrisMat = new THREE.MeshStandardMaterial({
      color: 0x8a8478,
      roughness: 0.85,
      metalness: 0.15,
    });
    const debris: { mesh: THREE.Mesh; vy: number; vx: number; vz: number; spin: THREE.Vector3 }[] = [];
    for (let i = 0; i < 8; i++) {
      const size = 3 + Math.random() * 4;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), debrisMat);
      mesh.position.set(
        (Math.random() - 0.5) * 18,
        Math.random() * 8,
        (Math.random() - 0.5) * 18,
      );
      mesh.castShadow = true;
      debrisParent.add(mesh);
      debris.push({
        mesh,
        vy: 60 + Math.random() * 30,
        vx: (Math.random() - 0.5) * 60,
        vz: (Math.random() - 0.5) * 60,
        spin: new THREE.Vector3(Math.random() * 4, Math.random() * 4, Math.random() * 4),
      });
    }

    const start = performance.now();
    const duration = 850;
    this.spellEffects.push({
      root: debrisParent,
      start,
      duration,
      update: (tNorm) => {
        const dt = 0.016;
        for (const d of debris) {
          d.mesh.position.x += d.vx * dt;
          d.mesh.position.z += d.vz * dt;
          d.mesh.position.y += d.vy * dt;
          d.vy -= 320 * dt; // гравитация
          d.mesh.rotation.x += d.spin.x * dt;
          d.mesh.rotation.y += d.spin.y * dt;
          d.mesh.rotation.z += d.spin.z * dt;
          if (d.mesh.position.y < 0) d.mesh.position.y = 0;
        }
        debrisParent.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!(mesh.material instanceof THREE.MeshStandardMaterial)) return;
          mesh.material.transparent = true;
          mesh.material.opacity = 1 - tNorm;
        });
      },
    });

    // Сама башня плавно «оседает», дымка появляется.
    const settle = { p: 0 };
    const initialY = model.group.position.y;
    const animateSettle = () => {
      settle.p += 0.03;
      if (settle.p >= 1) {
        model.group.scale.y = 0.18;
        model.group.position.y = initialY - 6;
        finalize();
        return;
      }
      model.group.scale.y = 1 - settle.p * 0.82;
      model.group.position.y = initialY - settle.p * 6;
      requestAnimationFrame(animateSettle);
    };
    animateSettle();

    const finalize = () => {
      model.group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        const mat = mesh.material;
        if (!mat || Array.isArray(mat) || !(mat instanceof THREE.MeshStandardMaterial)) return;
        mat.transparent = true;
        mat.opacity = 0.35;
      });
    };
  }

  /** 3D-эффект заклинания (Фаербол / Лечение). */
  castSpellEffect(code: SpellCode, x: number, y: number) {
    const pos = worldToThree(x, y);
    const root = new THREE.Group();
    root.position.copy(pos);
    this.scene.add(root);

    if (code === 'fireball') {
      // Огненный шар.
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(10, 24, 16),
        new THREE.MeshStandardMaterial({
          color: 0xff7b2a,
          emissive: 0xff5500,
          emissiveIntensity: 1.25,
          roughness: 0.4,
          metalness: 0.1,
          transparent: true,
        }),
      );
      core.position.y = 6;
      root.add(core);

      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(16, 24, 16),
        new THREE.MeshStandardMaterial({
          color: 0xffa14a,
          emissive: 0xff7733,
          emissiveIntensity: 1,
          roughness: 0.5,
          metalness: 0,
          transparent: true,
          opacity: 0.55,
        }),
      );
      halo.position.y = 6;
      root.add(halo);

      // Кольцо ударной волны.
      const ringGeom = new THREE.RingGeometry(0.5, 1, 32);
      const ring = new THREE.Mesh(
        ringGeom,
        new THREE.MeshBasicMaterial({
          color: 0xffd267,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 1;
      root.add(ring);

      // Искры.
      const sparkMat = new THREE.MeshStandardMaterial({
        color: 0xffe199,
        emissive: 0xffaa33,
        emissiveIntensity: 0.9,
      });
      const sparks: { mesh: THREE.Mesh; vel: THREE.Vector3 }[] = [];
      for (let i = 0; i < 14; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), sparkMat);
        const a = (i / 14) * Math.PI * 2;
        m.position.set(Math.cos(a) * 4, 6, Math.sin(a) * 4);
        root.add(m);
        sparks.push({
          mesh: m,
          vel: new THREE.Vector3(Math.cos(a) * 80, 60 + Math.random() * 40, Math.sin(a) * 80),
        });
      }

      const point = new THREE.PointLight(0xff8855, 2.5, 240, 2);
      point.position.y = 16;
      root.add(point);

      const duration = 700;
      this.spellEffects.push({
        root,
        start: performance.now(),
        duration,
        update: (tNorm) => {
          const t = tNorm;
          const grow = 1 + t * 4.5;
          core.scale.setScalar(0.6 + t * 1.8);
          halo.scale.setScalar(0.8 + t * 3);
          ring.scale.setScalar(grow * 70);
          (core.material as THREE.MeshStandardMaterial).opacity = 1 - t;
          (halo.material as THREE.MeshStandardMaterial).opacity = (1 - t) * 0.55;
          (ring.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.85;
          point.intensity = (1 - t) * 2.5;
          const dt = 0.016;
          for (const s of sparks) {
            s.mesh.position.addScaledVector(s.vel, dt);
            s.vel.y -= 220 * dt;
            (s.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 1 - t * 1.4);
            (s.mesh.material as THREE.MeshStandardMaterial).transparent = true;
          }
        },
      });
    } else {
      // heal — зелёное сияние + восходящие искры.
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(11, 24, 16),
        new THREE.MeshStandardMaterial({
          color: 0x9affc4,
          emissive: 0x4dffa6,
          emissiveIntensity: 1.4,
          roughness: 0.4,
          metalness: 0.05,
          transparent: true,
          opacity: 0.85,
        }),
      );
      orb.position.y = 14;
      root.add(orb);

      // Восходящий «купол» — диск, расширяющийся вверх.
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: 0xb6ffd0,
          transparent: true,
          opacity: 0.35,
          side: THREE.DoubleSide,
        }),
      );
      dome.position.y = 1;
      root.add(dome);

      // Восходящие искры-кресты.
      const sparkMat = new THREE.MeshStandardMaterial({
        color: 0xc8ffd9,
        emissive: 0x88ffaa,
        emissiveIntensity: 1,
      });
      const sparks: { mesh: THREE.Mesh; vy: number; ax: number; az: number }[] = [];
      for (let i = 0; i < 12; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), sparkMat);
        const ang = Math.random() * Math.PI * 2;
        const r = 6 + Math.random() * 10;
        m.position.set(Math.cos(ang) * r, 2, Math.sin(ang) * r);
        root.add(m);
        sparks.push({
          mesh: m,
          vy: 70 + Math.random() * 50,
          ax: (Math.random() - 0.5) * 8,
          az: (Math.random() - 0.5) * 8,
        });
      }

      const point = new THREE.PointLight(0x88ffaa, 1.6, 220, 2);
      point.position.y = 14;
      root.add(point);

      const duration = 750;
      this.spellEffects.push({
        root,
        start: performance.now(),
        duration,
        update: (tNorm) => {
          orb.scale.setScalar(0.7 + tNorm * 1.0);
          (orb.material as THREE.MeshStandardMaterial).opacity = (1 - tNorm) * 0.85;
          dome.scale.setScalar(8 + tNorm * 70);
          dome.position.y = 1 + tNorm * 18;
          (dome.material as THREE.MeshBasicMaterial).opacity = (1 - tNorm) * 0.35;
          point.intensity = (1 - tNorm) * 1.6;
          const dt = 0.016;
          for (const s of sparks) {
            s.mesh.position.y += s.vy * dt;
            s.mesh.position.x += s.ax * dt;
            s.mesh.position.z += s.az * dt;
            s.mesh.rotation.x += 4 * dt;
            s.mesh.rotation.y += 5 * dt;
            (s.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 1 - tNorm * 1.2);
            (s.mesh.material as THREE.MeshStandardMaterial).transparent = true;
          }
        },
      });
    }
  }

  // ───── юниты ─────

  private syncUnits(units: readonly Unit[]) {
    const alive = new Set<string>();
    const now = performance.now();
    const runT = now / 90;

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
      const moved = dx * dx + dy * dy > 0.25;
      if (moved) {
        model.group.rotation.y = Math.atan2(dx, dy);
        model.prev = { x: unit.x, y: unit.y };
      }

      // Walk-bob — отскакивающее тело при движении.
      const moving = unit.state === 'moving';
      const bob = moving ? Math.sin(runT + unit.x * 0.05) * 1.4 : 0;
      if (model.body) model.body.position.y = model.bodyBaseY + bob;

      // Шаговая анимация: ноги качаются.
      if (model.legLeft && model.legRight) {
        const swing = moving ? Math.sin(runT * 1.2 + unit.x * 0.05) * 0.85 : 0;
        model.legLeft.rotation.x = swing;
        model.legRight.rotation.x = -swing;
      }

      // Анимация атаки — короткий свинг рукой.
      if (model.armRight) {
        if (now < model.attackUntil) {
          const remaining = model.attackUntil - now;
          const t = 1 - remaining / 240;
          const phase = Math.sin(t * Math.PI);
          model.armRight.rotation.x = -phase * 1.3;
          // Лёгкий «толчок» всей модели в сторону цели.
          const push = phase * 1.6;
          const ax = Math.cos(model.attackAngle) * push;
          const az = Math.sin(model.attackAngle) * push;
          model.group.position.x = pos.x + ax;
          model.group.position.z = pos.z + az;
        } else {
          // Idle/stride рук — лёгкий контр-свинг.
          const stride = moving ? Math.sin(runT * 1.2 + unit.x * 0.05) * 0.5 : 0;
          model.armRight.rotation.x = -stride;
          if (model.armLeft) model.armLeft.rotation.x = stride;
        }
      }

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
      if (tower.isDestroyed && !model.isDestroyed) this.destroyTower(tower.id);
    }
  }

  private syncSpells() {
    const now = performance.now();
    for (let i = this.spellEffects.length - 1; i >= 0; i--) {
      const eff = this.spellEffects[i];
      const t = (now - eff.start) / eff.duration;
      if (t >= 1) {
        this.disposeModel(eff.root);
        this.scene.remove(eff.root);
        this.spellEffects.splice(i, 1);
        continue;
      }
      eff.update?.(t);
    }
  }

  // ───── factories ─────

  private createUnitModel(unit: Unit): UnitModel {
    const group = new THREE.Group();
    const parts: THREE.Object3D[] = [];
    const teamColor = unit.team === 'player' ? 0x2f80c8 : 0xd64455;
    const trim = unit.team === 'player' ? 0x8fd1ff : 0xffa0ad;
    const dark = unit.team === 'player' ? 0x163a59 : 0x5e1722;
    const skin = 0xe8b48a;

    const add = (mesh: THREE.Mesh, parent: THREE.Object3D = group) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parts.push(mesh);
      parent.add(mesh);
      return mesh;
    };

    const bodyMat = mat(teamColor, 0.55, 0.38);
    const trimMat = mat(trim, 0.45, 0.42);
    const darkMat = mat(dark, 0.7, 0.3);
    const metalMat = mat(0xcfd8e3, 0.65, 0.4);
    const goldMat = mat(0xf2c14e, 0.5, 0.5);
    const skinMat = mat(skin, 0.7, 0.05);
    const woodMat = mat(0x6b4a2a, 0.85, 0.05);

    let body: THREE.Object3D | undefined;
    let legLeft: THREE.Object3D | undefined;
    let legRight: THREE.Object3D | undefined;
    let armLeft: THREE.Object3D | undefined;
    let armRight: THREE.Object3D | undefined;
    let weapon: THREE.Object3D | undefined;
    let bodyBaseY = 0;

    const buildHumanoid = (
      scale: number,
      bodyColor: THREE.MeshStandardMaterial,
      armorColor: THREE.MeshStandardMaterial,
      headColor: THREE.MeshStandardMaterial,
    ) => {
      const torsoH = 10 * scale;
      const legH = 8 * scale;
      const armH = 9 * scale;
      const legSpacing = 2.4 * scale;

      // Ноги — pivot сверху (колено), чтобы качались в плечо.
      const makeLeg = (x: number) => {
        const pivot = new THREE.Group();
        pivot.position.set(x, legH, 0);
        const leg = new THREE.Mesh(
          new THREE.CapsuleGeometry(1.7 * scale, legH, 4, 8),
          darkMat,
        );
        leg.position.y = -legH / 2;
        leg.castShadow = true;
        leg.receiveShadow = true;
        parts.push(leg);
        pivot.add(leg);
        // Стопа.
        const boot = new THREE.Mesh(
          new THREE.BoxGeometry(2.6 * scale, 1.4 * scale, 3.4 * scale),
          darkMat,
        );
        boot.position.y = -legH;
        boot.position.z = 0.4 * scale;
        boot.castShadow = true;
        boot.receiveShadow = true;
        parts.push(boot);
        pivot.add(boot);
        group.add(pivot);
        return pivot;
      };
      legLeft = makeLeg(-legSpacing);
      legRight = makeLeg(legSpacing);

      // Туловище.
      bodyBaseY = legH + torsoH / 2 - 1;
      body = new THREE.Group();
      body.position.y = bodyBaseY;
      group.add(body);
      const torso = add(
        new THREE.Mesh(new THREE.CapsuleGeometry(3.4 * scale, torsoH, 5, 10), bodyColor),
        body,
      );
      torso.scale.set(1.05, 1, 0.85);
      // Грудная пластина.
      const plate = add(
        new THREE.Mesh(
          new THREE.BoxGeometry(6 * scale, torsoH * 0.7, 1.4 * scale),
          armorColor,
        ),
        body,
      );
      plate.position.set(0, 0.6 * scale, 1.6 * scale);

      // Голова.
      const head = add(
        new THREE.Mesh(new THREE.SphereGeometry(2.6 * scale, 18, 14), headColor),
        body,
      );
      head.position.y = torsoH / 2 + 2.2 * scale;
      // Глаза (просто маленькие тёмные точки).
      const eyeMat = mat(0x101820, 0.3, 0);
      const eyeL = add(
        new THREE.Mesh(new THREE.SphereGeometry(0.35 * scale, 6, 4), eyeMat),
        body,
      );
      eyeL.position.set(-0.9 * scale, torsoH / 2 + 2.4 * scale, 2 * scale);
      const eyeR = add(
        new THREE.Mesh(new THREE.SphereGeometry(0.35 * scale, 6, 4), eyeMat),
        body,
      );
      eyeR.position.set(0.9 * scale, torsoH / 2 + 2.4 * scale, 2 * scale);

      // Руки — pivot в плече.
      const makeArm = (x: number) => {
        const pivot = new THREE.Group();
        pivot.position.set(x, torsoH / 2 - 1, 0);
        const arm = new THREE.Mesh(
          new THREE.CapsuleGeometry(1.4 * scale, armH, 4, 8),
          bodyColor,
        );
        arm.position.y = -armH / 2;
        arm.castShadow = true;
        arm.receiveShadow = true;
        parts.push(arm);
        pivot.add(arm);
        body!.add(pivot);
        return pivot;
      };
      armLeft = makeArm(-(3.4 * scale + 1.2));
      armRight = makeArm(3.4 * scale + 1.2);
    };

    switch (unit.type) {
      case 'warrior': {
        buildHumanoid(1.0, bodyMat, trimMat, skinMat);
        // Меч в правой руке.
        const sword = new THREE.Mesh(new THREE.BoxGeometry(1.4, 12, 0.8), metalMat);
        sword.position.y = -10;
        sword.castShadow = true;
        parts.push(sword);
        armRight!.add(sword);
        weapon = sword;
        // Щит на левой руке.
        const shield = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 1.2, 18), trimMat);
        shield.rotation.z = Math.PI / 2;
        shield.position.set(0, -6, 1.5);
        shield.castShadow = true;
        parts.push(shield);
        armLeft!.add(shield);
        break;
      }
      case 'archer': {
        buildHumanoid(0.95, bodyMat, trimMat, skinMat);
        // Лук — кривая дуга.
        const bow = new THREE.Mesh(
          new THREE.TorusGeometry(5, 0.5, 8, 22, Math.PI * 1.2),
          goldMat,
        );
        bow.rotation.set(Math.PI / 2, 0.05, 0.15);
        bow.position.set(0, -6, 0.5);
        bow.castShadow = true;
        parts.push(bow);
        armLeft!.add(bow);
        // Стрела на тетиве.
        const arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 9, 8), woodMat);
        arrow.rotation.x = Math.PI / 2;
        arrow.position.set(0, -6, 4);
        parts.push(arrow);
        armRight!.add(arrow);
        // Колчан за спиной.
        const quiver = add(
          new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 7, 12), darkMat),
          body!,
        );
        quiver.position.set(2, 1, -2.6);
        quiver.rotation.x = 0.3;
        weapon = arrow;
        break;
      }
      case 'tank': {
        // Танк — гигантский человек. Большой масштаб, тяжёлая броня, молот.
        buildHumanoid(1.85, bodyMat, darkMat, skinMat);
        // Дополнительные плечи-наплечники.
        const pauldL = new THREE.Mesh(new THREE.SphereGeometry(3.2, 14, 10), darkMat);
        pauldL.scale.set(1.2, 0.7, 1.2);
        pauldL.position.set(-7.6, 1.5, 0);
        pauldL.castShadow = true;
        parts.push(pauldL);
        body!.add(pauldL);
        const pauldR = pauldL.clone();
        pauldR.position.x = 7.6;
        body!.add(pauldR);
        parts.push(pauldR);

        // Огромный молот в правой руке.
        const hammer = new THREE.Group();
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 18, 10), woodMat);
        handle.position.y = -9;
        handle.castShadow = true;
        parts.push(handle);
        hammer.add(handle);
        const head = new THREE.Mesh(new THREE.BoxGeometry(7, 5, 5), metalMat);
        head.position.y = -16;
        head.castShadow = true;
        parts.push(head);
        hammer.add(head);
        armRight!.add(hammer);
        weapon = hammer;

        // Шипастые наручи.
        const cuffL = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 3, 12), metalMat);
        cuffL.position.y = -10;
        cuffL.castShadow = true;
        parts.push(cuffL);
        armLeft!.add(cuffL);
        const cuffR = cuffL.clone();
        armRight!.add(cuffR);
        parts.push(cuffR);
        break;
      }
      case 'assassin': {
        buildHumanoid(0.9, darkMat, bodyMat, mat(0x1a1d22, 0.6, 0.05));
        // Капюшон.
        const hood = new THREE.Mesh(new THREE.ConeGeometry(2.8, 4, 12), darkMat);
        hood.position.y = 11;
        hood.castShadow = true;
        parts.push(hood);
        body!.add(hood);
        // Два клинка в обеих руках.
        const makeBlade = () => {
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 0.5), metalMat);
          b.position.y = -10;
          b.castShadow = true;
          parts.push(b);
          return b;
        };
        const bL = makeBlade();
        armLeft!.add(bL);
        const bR = makeBlade();
        armRight!.add(bR);
        weapon = bR;
        break;
      }
      case 'squad': {
        // Три миниатюрных юнита-«солдата».
        const offsets: ReadonlyArray<readonly [number, number]> = [
          [-5, -1],
          [5, -1],
          [0, 5],
        ];
        const subBodies: THREE.Object3D[] = [];
        const subLegsL: THREE.Object3D[] = [];
        const subLegsR: THREE.Object3D[] = [];
        for (const [ox, oz] of offsets) {
          const sub = new THREE.Group();
          sub.position.set(ox, 0, oz);
          group.add(sub);
          // Body.
          const subBody = new THREE.Group();
          subBody.position.y = 6;
          sub.add(subBody);
          subBodies.push(subBody);
          const torso = new THREE.Mesh(new THREE.CapsuleGeometry(2.2, 5, 4, 8), bodyMat);
          torso.castShadow = true;
          subBody.add(torso);
          parts.push(torso);
          const head = new THREE.Mesh(new THREE.SphereGeometry(1.7, 12, 10), trimMat);
          head.position.y = 4;
          head.castShadow = true;
          subBody.add(head);
          parts.push(head);
          // Legs.
          const lL = new THREE.Group();
          lL.position.set(-1.2, 4.5, 0);
          sub.add(lL);
          const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 4, 3, 6), darkMat);
          legL.position.y = -2;
          legL.castShadow = true;
          parts.push(legL);
          lL.add(legL);
          subLegsL.push(lL);
          const lR = new THREE.Group();
          lR.position.set(1.2, 4.5, 0);
          sub.add(lR);
          const legR = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 4, 3, 6), darkMat);
          legR.position.y = -2;
          legR.castShadow = true;
          parts.push(legR);
          lR.add(legR);
          subLegsR.push(lR);
          // Sword.
          const sw = new THREE.Mesh(new THREE.BoxGeometry(0.7, 4, 0.4), metalMat);
          sw.position.set(2, 7, 0);
          sw.castShadow = true;
          parts.push(sw);
          subBody.add(sw);
        }
        // Берём «общими» ноги первого солдата для основной анимации.
        legLeft = subLegsL[0];
        legRight = subLegsR[0];
        body = subBodies[0];
        bodyBaseY = 6;
        break;
      }
      case 'mage': {
        buildHumanoid(1.0, bodyMat, trimMat, skinMat);
        // Шляпа-колпак.
        const hat = new THREE.Mesh(new THREE.ConeGeometry(3.4, 7, 16), darkMat);
        hat.position.y = 13;
        hat.castShadow = true;
        parts.push(hat);
        body!.add(hat);
        // Посох.
        const staff = new THREE.Group();
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 18, 10), woodMat);
        stick.position.y = -9;
        stick.castShadow = true;
        parts.push(stick);
        staff.add(stick);
        // Кристалл.
        const crystal = new THREE.Mesh(
          new THREE.OctahedronGeometry(2),
          mat(0xb08fff, 0.3, 0.05),
        );
        crystal.position.y = 0;
        crystal.castShadow = true;
        parts.push(crystal);
        staff.add(crystal);
        const aura = new THREE.PointLight(0xb08fff, 0.7, 60, 2);
        aura.position.y = 0;
        staff.add(aura);
        armRight!.add(staff);
        weapon = staff;
        break;
      }
    }

    // Подставка-кружок под юнитом.
    const base = add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(unit.radius * 0.85, unit.radius * 0.95, 1.6, 24),
        darkMat,
      ),
    );
    base.position.y = 0.8;

    group.position.copy(worldToThree(unit.x, unit.y));
    return {
      group,
      parts,
      bodyBaseY,
      body,
      legLeft,
      legRight,
      armLeft,
      armRight,
      weapon,
      prev: { x: unit.x, y: unit.y },
      hp: unit.hp,
      attackUntil: 0,
      attackAngle: 0,
      dying: false,
    };
  }

  private createTowerModel(tower: Tower): TowerModel {
    const group = new THREE.Group();
    const parts: THREE.Object3D[] = [];
    const r = rectToPx(tower.rect);
    const pos = worldToThree(tower.x, tower.y);
    const isKing = tower.type === 'king';
    const color =
      tower.team === 'player' ? (isKing ? 0x1f5f9d : 0x2f80c8) : isKing ? 0x9e243d : 0xd64455;
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
    add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(width * 0.36, width * 0.44, height, isKing ? 8 : 6),
        stone,
      ),
    ).position.y = 8 + height / 2;
    add(
      new THREE.Mesh(
        new THREE.ConeGeometry(width * 0.48, isKing ? 18 : 14, isKing ? 8 : 6),
        roof,
      ),
    ).position.y = height + 19;

    const cannon = add(
      new THREE.Mesh(new THREE.CylinderGeometry(2, 2, isKing ? 22 : 16, 12), dark),
    );
    cannon.position.set(0, height + 10, tower.team === 'player' ? -10 : 10);
    cannon.rotation.x = Math.PI / 2;

    if (isKing) {
      for (const x of [-8, 0, 8]) {
        const crown = add(
          new THREE.Mesh(new THREE.ConeGeometry(2.4, 7, 5), mat(0xf2c14e, 0.5, 0.38)),
        );
        crown.position.set(x, height + 32, 0);
      }
    }

    group.position.set(pos.x, 0, pos.z);
    return { group, parts, hp: tower.hp, destroyedAnimStart: 0, isDestroyed: false };
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
