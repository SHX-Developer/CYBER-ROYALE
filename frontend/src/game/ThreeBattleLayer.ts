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
const IS_COARSE_POINTER =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches;
const DEVICE_DPR = Math.max(1, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
const DEVICE_MEMORY_GB =
  typeof navigator === 'undefined'
    ? 8
    : ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8);
const CPU_THREADS = typeof navigator === 'undefined' ? 8 : navigator.hardwareConcurrency || 8;
const IS_LOW_MOBILE = IS_COARSE_POINTER && (DEVICE_MEMORY_GB <= 4 || CPU_THREADS <= 4);
const MOBILE_DPR_CAP = IS_LOW_MOBILE ? 2 : 2.35;
const SHADOW_MAP_SIZE = IS_LOW_MOBILE ? 768 : 1024;
const USE_SOFT_SHADOWS = !IS_LOW_MOBILE;
// На мобилках тоже держим качественный рендер, но не выше разумного лимита.
const MODEL_DPR = Math.min(IS_COARSE_POINTER ? MOBILE_DPR_CAP : 2.5, DEVICE_DPR);

// Универсальный масштаб всех юнитов — увеличен на 20% по запросу.
const UNIT_SCALE = 1.2;

interface UnitModel {
  group: THREE.Group;
  parts: THREE.Object3D[];
  aura?: THREE.Mesh;
  bodyBaseY: number;
  body?: THREE.Object3D;
  legLeft?: THREE.Object3D;
  legRight?: THREE.Object3D;
  armRight?: THREE.Object3D;
  armLeft?: THREE.Object3D;
  weapon?: THREE.Object3D;
  prev: Vec;
  hp: number;
  attackUntil: number;
  attackAngle: number;
  dying: boolean;
}

interface TowerModel {
  group: THREE.Group;
  parts: THREE.Object3D[];
  aura?: THREE.Mesh;
  hp: number;
  destroyedAnimStart: number;
  isDestroyed: boolean;
  /** Лучница на принцессе — анимация натяжения тетивы. */
  archer?: THREE.Group;
  archerArm?: THREE.Object3D;
  archerAttackUntil: number;
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
  /** Пул переиспользуемых материалов — по color+roughness+metalness. */
  private readonly materialCache = new Map<string, THREE.MeshStandardMaterial>();

  constructor(
    private readonly parent: HTMLElement,
    private readonly phaserCanvas: HTMLCanvasElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
      // Стабильная отрисовка на iOS Safari.
      preserveDrawingBuffer: false,
      stencil: false,
    });
    this.renderer.setPixelRatio(MODEL_DPR);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = IS_COARSE_POINTER ? 1.12 : 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = USE_SOFT_SHADOWS
      ? THREE.PCFSoftShadowMap
      : THREE.PCFShadowMap;

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
    for (const m of this.materialCache.values()) m.dispose();
    this.materialCache.clear();
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
    // Не диспозим закэшированные материалы — другие юниты их используют.
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
      // Используем emissive флэш — но только если у материала уникальный
      // экземпляр. Закэшированные пропускаем, чтобы не мигали все юниты сразу.
      if ((mat as THREE.MeshStandardMaterial & { __shared?: boolean }).__shared) continue;
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
      if ((mat as THREE.MeshStandardMaterial & { __shared?: boolean }).__shared) continue;
      mat.emissive.setHex(0xffd267);
      mat.emissiveIntensity = 0.45;
    }
    window.setTimeout(() => this.clearFlash(model.parts), 140);
  }

  attackAnim(unitId: string, angle: number) {
    const m = this.units.get(unitId);
    if (!m) return;
    m.attackUntil = performance.now() + 240;
    m.attackAngle = angle;
  }

  /** Анимация выстрела лучницы на принцессе. */
  towerAttackAnim(towerId: string) {
    const m = this.towers.get(towerId);
    if (!m || !m.archer) return;
    m.archerAttackUntil = performance.now() + 220;
  }

  destroyTower(id: string) {
    const model = this.towers.get(id);
    if (!model || model.isDestroyed) return;
    model.isDestroyed = true;
    model.destroyedAnimStart = performance.now();

    const debrisParent = new THREE.Group();
    debrisParent.position.copy(model.group.position);
    debrisParent.position.y += 18;
    this.scene.add(debrisParent);

    const debrisMat = this.getCachedMat(0x8a8478, 0.85, 0.15);
    const debris: { mesh: THREE.Mesh; vy: number; vx: number; vz: number; spin: THREE.Vector3 }[] = [];
    for (let i = 0; i < 8; i++) {
      const size = 3 + Math.random() * 4;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), debrisMat);
      mesh.position.set(
        (Math.random() - 0.5) * 18,
        Math.random() * 8,
        (Math.random() - 0.5) * 18,
      );
      // Тени отключены — короткоживущие осколки, экономия fps.
      mesh.castShadow = false;
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
          d.vy -= 320 * dt;
          d.mesh.rotation.x += d.spin.x * dt;
          d.mesh.rotation.y += d.spin.y * dt;
          d.mesh.rotation.z += d.spin.z * dt;
          if (d.mesh.position.y < 0) d.mesh.position.y = 0;
          // Скрываем по времени — без mutate материала (он закэширован).
          d.mesh.visible = tNorm < 0.95;
        }
      },
    });

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
      // Спрятать модель — не возимся с прозрачностью на shared-материалах.
      model.group.visible = false;
    };
  }

  // ───── 3D-эффект Фаербола ─────
  // Запускается с башни короля (caster), летит дугой к точке цели, взрывается.
  castFireball(fromX: number, fromY: number, toX: number, toY: number) {
    const from = worldToThree(fromX, fromY);
    const to = worldToThree(toX, toY);
    const root = new THREE.Group();
    this.scene.add(root);

    const startY = 22;
    const endY = 0;
    const peakY = 110 + Math.random() * 14;

    // Сам шар — горящий орб.
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(7, 20, 14),
      new THREE.MeshStandardMaterial({
        color: 0xff7b2a,
        emissive: 0xff4400,
        emissiveIntensity: 1.4,
        roughness: 0.4,
      }),
    );
    orb.castShadow = false;
    root.add(orb);

    // Хвост — несколько затухающих сфер позади основного шара.
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0xffaa55,
      transparent: true,
      opacity: 0.55,
    });
    const trail: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const t = new THREE.Mesh(new THREE.SphereGeometry(5 - i * 0.6, 12, 10), trailMat.clone());
      (t.material as THREE.MeshBasicMaterial).opacity = 0.5 - i * 0.08;
      root.add(t);
      trail.push(t);
    }

    const point = new THREE.PointLight(0xff7733, 1.6, 180, 2);
    root.add(point);

    const flightDuration = 680;
    this.spellEffects.push({
      root,
      start: performance.now(),
      duration: flightDuration + 750, // полёт + взрыв
      update: (tNorm) => {
        const flightT = Math.min(1, tNorm / (flightDuration / (flightDuration + 750)));
        if (flightT < 1) {
          // Параболический полёт.
          const x = from.x + (to.x - from.x) * flightT;
          const z = from.z + (to.z - from.z) * flightT;
          // y по параболе через peakY.
          const y = (1 - flightT) * startY + flightT * endY + 4 * peakY * flightT * (1 - flightT);
          orb.position.set(x, y, z);
          point.position.set(x, y + 6, z);
          // Хвост — задержка с интерполяцией прошлой точки.
          for (let i = 0; i < trail.length; i++) {
            const lag = 0.04 + i * 0.025;
            const tt = Math.max(0, flightT - lag);
            const tx = from.x + (to.x - from.x) * tt;
            const tz = from.z + (to.z - from.z) * tt;
            const ty = (1 - tt) * startY + tt * endY + 4 * peakY * tt * (1 - tt);
            trail[i].position.set(tx, ty, tz);
          }
          orb.rotation.x += 0.3;
          orb.rotation.y += 0.2;
        } else {
          // Взрыв.
          const e = Math.min(1, (tNorm - flightDuration / (flightDuration + 750)) / (750 / (flightDuration + 750)));
          orb.scale.setScalar(1 + e * 6);
          (orb.material as THREE.MeshStandardMaterial).opacity = 1 - e;
          (orb.material as THREE.MeshStandardMaterial).transparent = true;
          (orb.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.4 * (1 - e);
          point.intensity = (1 - e) * 3;
          for (const tmesh of trail) tmesh.visible = false;
        }
      },
    });

    // Через flightDuration ms — добавляем «взрывное кольцо» на земле.
    window.setTimeout(() => {
      this.spawnExplosion(toX, toY);
    }, flightDuration);
  }

  /** Самостоятельный эффект взрыва — кольцо + искры в точке (x, y). */
  private spawnExplosion(x: number, y: number) {
    const root = new THREE.Group();
    root.position.copy(worldToThree(x, y));
    this.scene.add(root);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 1.0, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffd267,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 1;
    root.add(ring);

    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(8, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff58c, transparent: true, opacity: 1 }),
    );
    flash.position.y = 8;
    root.add(flash);

    const point = new THREE.PointLight(0xff7733, 3, 240, 2);
    point.position.y = 18;
    root.add(point);

    const sparks: { mesh: THREE.Mesh; vel: THREE.Vector3 }[] = [];
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffe199, transparent: true });
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), sparkMat.clone());
      const a = (i / 14) * Math.PI * 2;
      m.position.set(Math.cos(a) * 4, 6, Math.sin(a) * 4);
      root.add(m);
      sparks.push({
        mesh: m,
        vel: new THREE.Vector3(Math.cos(a) * 100, 70 + Math.random() * 50, Math.sin(a) * 100),
      });
    }

    this.spellEffects.push({
      root,
      start: performance.now(),
      duration: 700,
      update: (tNorm) => {
        ring.scale.setScalar(8 + tNorm * 80);
        (ring.material as THREE.MeshBasicMaterial).opacity = (1 - tNorm) * 0.9;
        flash.scale.setScalar(0.6 + tNorm * 2.2);
        (flash.material as THREE.MeshBasicMaterial).opacity = 1 - tNorm;
        point.intensity = (1 - tNorm) * 3;
        const dt = 0.016;
        for (const s of sparks) {
          s.mesh.position.addScaledVector(s.vel, dt);
          s.vel.y -= 220 * dt;
          (s.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - tNorm * 1.4);
        }
      },
    });
  }

  // ───── 3D-эффект Зелья исцеления ─────
  // Зелье падает с неба в точку, разбивается, оставляет 3-сек зону лечения.
  castHealPotion(x: number, y: number, durationMs = 3000) {
    const pos = worldToThree(x, y);
    const root = new THREE.Group();
    root.position.copy(pos);
    this.scene.add(root);

    // Бутыль зелья — стеклянная сфера с пробкой.
    const bottle = new THREE.Group();
    const glass = new THREE.Mesh(
      new THREE.SphereGeometry(3.5, 16, 12),
      new THREE.MeshStandardMaterial({
        color: 0x88ffaa,
        emissive: 0x4dffa6,
        emissiveIntensity: 0.55,
        roughness: 0.2,
        metalness: 0.1,
        transparent: true,
        opacity: 0.85,
      }),
    );
    glass.position.y = 0;
    glass.castShadow = false;
    bottle.add(glass);
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 2, 10),
      new THREE.MeshStandardMaterial({ color: 0xc8ffd9, roughness: 0.4 }),
    );
    neck.position.y = 4;
    bottle.add(neck);
    const cork = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, 1.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x8c5a2a, roughness: 0.85 }),
    );
    cork.position.y = 5.6;
    bottle.add(cork);
    bottle.position.y = 130;
    root.add(bottle);

    // Зона лечения на земле.
    const ringInner = 28;
    const ringOuter = 50;
    const heroAura = new THREE.Mesh(
      new THREE.RingGeometry(ringInner, ringOuter, 48),
      new THREE.MeshBasicMaterial({
        color: 0x88ffaa,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
      }),
    );
    heroAura.rotation.x = -Math.PI / 2;
    heroAura.position.y = 1;
    root.add(heroAura);

    const innerDome = new THREE.Mesh(
      new THREE.SphereGeometry(ringOuter, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.5),
      new THREE.MeshBasicMaterial({
        color: 0xb6ffd0,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
      }),
    );
    innerDome.position.y = 1;
    root.add(innerDome);

    const point = new THREE.PointLight(0x88ffaa, 0, 220, 2);
    point.position.y = 14;
    root.add(point);

    // Восходящие искры — генерируются в zone-фазе.
    const sparkBank: { mesh: THREE.Mesh; vy: number; ax: number; az: number; born: number }[] = [];
    const sparkMatBase = new THREE.MeshStandardMaterial({
      color: 0xc8ffd9,
      emissive: 0x88ffaa,
      emissiveIntensity: 1,
    });

    const fallDuration = 600;
    const totalDuration = fallDuration + durationMs;
    const startTime = performance.now();

    this.spellEffects.push({
      root,
      start: startTime,
      duration: totalDuration + 350,
      update: () => {
        const elapsed = performance.now() - startTime;
        if (elapsed < fallDuration) {
          const t = elapsed / fallDuration;
          // Зелье падает по дуге с вращением.
          bottle.position.y = 130 * (1 - t * t);
          bottle.rotation.x = t * 4;
          bottle.rotation.z = t * 2;
        } else if (elapsed < fallDuration + durationMs) {
          // Активная зона лечения.
          if (bottle.visible) {
            // Эффект «разбилось»: прячем бутылку, спавним splash-искры.
            bottle.visible = false;
            for (let i = 0; i < 10; i++) {
              const m = new THREE.Mesh(
                new THREE.BoxGeometry(1.4, 1.4, 1.4),
                sparkMatBase.clone(),
              );
              const a = Math.random() * Math.PI * 2;
              m.position.set(Math.cos(a) * 2, 1, Math.sin(a) * 2);
              root.add(m);
              sparkBank.push({
                mesh: m,
                vy: 60 + Math.random() * 60,
                ax: Math.cos(a) * (40 + Math.random() * 30),
                az: Math.sin(a) * (40 + Math.random() * 30),
                born: performance.now(),
              });
            }
          }
          const zoneT = (elapsed - fallDuration) / durationMs;
          // Кольцо «дышит» — opacity синусоидой, легкая ротация.
          const breathe = 0.4 + 0.25 * Math.sin(zoneT * Math.PI * 6);
          (heroAura.material as THREE.MeshBasicMaterial).opacity = breathe;
          (innerDome.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.1 * breathe;
          heroAura.rotation.z += 0.02;
          point.intensity = 0.8 + 0.4 * breathe;
          // Восходящие искры.
          if (Math.random() < 0.55) {
            const m = new THREE.Mesh(
              new THREE.BoxGeometry(1.2, 1.2, 1.2),
              sparkMatBase.clone(),
            );
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * ringOuter;
            m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
            root.add(m);
            sparkBank.push({
              mesh: m,
              vy: 30 + Math.random() * 40,
              ax: 0,
              az: 0,
              born: performance.now(),
            });
          }
        } else {
          // Угасание.
          const fade = (elapsed - fallDuration - durationMs) / 350;
          (heroAura.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.5 * (1 - fade));
          (innerDome.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.2 * (1 - fade));
          point.intensity = Math.max(0, 1 * (1 - fade));
        }
        // Анимация и отбраковка искр.
        const dt = 0.016;
        const now = performance.now();
        for (let i = sparkBank.length - 1; i >= 0; i--) {
          const s = sparkBank[i];
          s.mesh.position.x += s.ax * dt;
          s.mesh.position.z += s.az * dt;
          s.mesh.position.y += s.vy * dt;
          s.vy -= 60 * dt;
          s.mesh.rotation.x += 4 * dt;
          s.mesh.rotation.y += 5 * dt;
          const age = now - s.born;
          if (age > 700) {
            (s.mesh.material as THREE.MeshStandardMaterial).dispose();
            root.remove(s.mesh);
            sparkBank.splice(i, 1);
          } else {
            (s.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 1 - age / 700);
            (s.mesh.material as THREE.MeshStandardMaterial).transparent = true;
          }
        }
      },
    });
  }

  /** Лёгкий 2D-fallback (используется PhaserGame по необходимости). */
  castSpellEffect(code: SpellCode, x: number, y: number) {
    if (code === 'fireball') {
      // На случай прямого вызова без аркового полёта — просто взрыв.
      this.spawnExplosion(x, y);
    } else {
      this.castHealPotion(x, y);
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

      const moving = unit.state === 'moving';
      const bob = moving ? Math.sin(runT + unit.x * 0.05) * 1.4 : 0;
      if (model.body) model.body.position.y = model.bodyBaseY + bob;
      if (model.aura) {
        const pulse = 1 + Math.sin(now / 260 + unit.x * 0.03) * 0.045;
        const size =
          unit.type === 'tank'
            ? 1.45
            : unit.type === 'guardian'
              ? 1.25
              : unit.type === 'squad'
                ? 1.15
                : unit.type === 'drone'
                  ? 0.9
                  : 1;
        model.aura.scale.setScalar(size * pulse);
        const mat = model.aura.material as THREE.MeshBasicMaterial;
        mat.opacity = unit.state === 'moving' ? 0.18 : 0.13;
      }

      if (model.legLeft && model.legRight) {
        const swing = moving ? Math.sin(runT * 1.2 + unit.x * 0.05) * 0.85 : 0;
        model.legLeft.rotation.x = swing;
        model.legRight.rotation.x = -swing;
      }

      if (model.armRight) {
        if (now < model.attackUntil) {
          const remaining = model.attackUntil - now;
          const t = 1 - remaining / 240;
          const phase = Math.sin(t * Math.PI);
          model.armRight.rotation.x = -phase * 1.3;
          const push = phase * 1.6;
          const ax = Math.cos(model.attackAngle) * push;
          const az = Math.sin(model.attackAngle) * push;
          model.group.position.x = pos.x + ax;
          model.group.position.z = pos.z + az;
        } else {
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
    const now = performance.now();
    for (const tower of towers) {
      let model = this.towers.get(tower.id);
      if (!model) {
        model = this.createTowerModel(tower);
        this.towers.set(tower.id, model);
        this.scene.add(model.group);
      }
      model.hp = tower.hp;
      if (tower.isDestroyed && !model.isDestroyed) this.destroyTower(tower.id);
      if (model.aura) {
        const mat = model.aura.material as THREE.MeshBasicMaterial;
        const pulse = 1 + Math.sin(now / 520 + tower.x * 0.02) * 0.035;
        model.aura.scale.setScalar(pulse);
        mat.opacity = tower.isDestroyed ? 0 : tower.type === 'king' ? 0.2 : 0.16;
      }

      // Анимация лучницы — натяжение тетивы при выстреле.
      if (model.archer && model.archerArm) {
        if (now < model.archerAttackUntil) {
          const t = 1 - (model.archerAttackUntil - now) / 220;
          const phase = Math.sin(t * Math.PI);
          model.archerArm.rotation.x = -phase * 0.9;
        } else {
          model.archerArm.rotation.x = 0;
        }
      }
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

  private getCachedMat(color: number, roughness: number, metalness: number) {
    const key = `${color.toString(16)}|${roughness.toFixed(2)}|${metalness.toFixed(2)}`;
    const cached = this.materialCache.get(key);
    if (cached) return cached;
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    (m as THREE.MeshStandardMaterial & { __shared?: boolean }).__shared = true;
    this.materialCache.set(key, m);
    return m;
  }

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

    const bodyMat = this.getCachedMat(teamColor, 0.55, 0.38);
    const trimMat = this.getCachedMat(trim, 0.45, 0.42);
    const darkMat = this.getCachedMat(dark, 0.7, 0.3);
    const metalMat = this.getCachedMat(0xcfd8e3, 0.65, 0.4);
    const goldMat = this.getCachedMat(0xf2c14e, 0.5, 0.5);
    const skinMat = this.getCachedMat(skin, 0.7, 0.05);
    const woodMat = this.getCachedMat(0x6b4a2a, 0.85, 0.05);

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

      bodyBaseY = legH + torsoH / 2 - 1;
      body = new THREE.Group();
      body.position.y = bodyBaseY;
      group.add(body);
      const torso = add(
        new THREE.Mesh(new THREE.CapsuleGeometry(3.4 * scale, torsoH, 5, 10), bodyColor),
        body,
      );
      torso.scale.set(1.05, 1, 0.85);
      const plate = add(
        new THREE.Mesh(
          new THREE.BoxGeometry(6 * scale, torsoH * 0.7, 1.4 * scale),
          armorColor,
        ),
        body,
      );
      plate.position.set(0, 0.6 * scale, 1.6 * scale);

      add(
        new THREE.Mesh(new THREE.SphereGeometry(2.6 * scale, 18, 14), headColor),
        body,
      ).position.y = torsoH / 2 + 2.2 * scale;
      const eyeMat = this.getCachedMat(0x101820, 0.3, 0);
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
        const sword = new THREE.Mesh(new THREE.BoxGeometry(1.4, 12, 0.8), metalMat);
        sword.position.y = -10;
        sword.castShadow = true;
        parts.push(sword);
        armRight!.add(sword);
        weapon = sword;
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
        const bow = new THREE.Mesh(
          new THREE.TorusGeometry(5, 0.5, 8, 22, Math.PI * 1.2),
          goldMat,
        );
        bow.rotation.set(Math.PI / 2, 0.05, 0.15);
        bow.position.set(0, -6, 0.5);
        bow.castShadow = true;
        parts.push(bow);
        armLeft!.add(bow);
        const arrow = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 9, 8), woodMat);
        arrow.rotation.x = Math.PI / 2;
        arrow.position.set(0, -6, 4);
        parts.push(arrow);
        armRight!.add(arrow);
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
        buildHumanoid(1.85, bodyMat, darkMat, skinMat);
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
        buildHumanoid(0.9, darkMat, bodyMat, this.getCachedMat(0x1a1d22, 0.6, 0.05));
        const hood = new THREE.Mesh(new THREE.ConeGeometry(2.8, 4, 12), darkMat);
        hood.position.y = 11;
        hood.castShadow = true;
        parts.push(hood);
        body!.add(hood);
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
          const sw = new THREE.Mesh(new THREE.BoxGeometry(0.7, 4, 0.4), metalMat);
          sw.position.set(2, 7, 0);
          sw.castShadow = true;
          parts.push(sw);
          subBody.add(sw);
        }
        legLeft = subLegsL[0];
        legRight = subLegsR[0];
        body = subBodies[0];
        bodyBaseY = 6;
        break;
      }
      case 'mage': {
        buildHumanoid(1.0, bodyMat, trimMat, skinMat);
        const hat = new THREE.Mesh(new THREE.ConeGeometry(3.4, 7, 16), darkMat);
        hat.position.y = 13;
        hat.castShadow = true;
        parts.push(hat);
        body!.add(hat);
        const staff = new THREE.Group();
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 18, 10), woodMat);
        stick.position.y = -9;
        stick.castShadow = true;
        parts.push(stick);
        staff.add(stick);
        const crystal = new THREE.Mesh(
          new THREE.OctahedronGeometry(2),
          this.getCachedMat(0xb08fff, 0.3, 0.05),
        );
        crystal.position.y = 0;
        crystal.castShadow = true;
        parts.push(crystal);
        staff.add(crystal);
        armRight!.add(staff);
        weapon = staff;
        break;
      }
      case 'lancer': {
        buildHumanoid(1.02, bodyMat, trimMat, skinMat);
        const spear = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 20, 10), woodMat);
        shaft.position.y = -10;
        shaft.castShadow = true;
        parts.push(shaft);
        spear.add(shaft);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(1.5, 4.5, 12), metalMat);
        tip.position.y = -21.5;
        tip.castShadow = true;
        parts.push(tip);
        spear.add(tip);
        spear.rotation.z = -0.2;
        armRight!.add(spear);
        weapon = spear;
        const crest = add(new THREE.Mesh(new THREE.ConeGeometry(2.4, 3.8, 12), trimMat), body!);
        crest.position.y = 11.8;
        break;
      }
      case 'guardian': {
        buildHumanoid(1.35, bodyMat, darkMat, skinMat);
        const towerShield = new THREE.Mesh(new THREE.BoxGeometry(8, 13, 1.5), trimMat);
        towerShield.position.set(0, -7, 1.8);
        towerShield.castShadow = true;
        parts.push(towerShield);
        armLeft!.add(towerShield);
        const mace = new THREE.Group();
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 12, 10), woodMat);
        handle.position.y = -8;
        parts.push(handle);
        mace.add(handle);
        const head = new THREE.Mesh(new THREE.DodecahedronGeometry(2.8), metalMat);
        head.position.y = -15;
        head.castShadow = true;
        parts.push(head);
        mace.add(head);
        armRight!.add(mace);
        weapon = mace;
        break;
      }
      case 'bombardier': {
        buildHumanoid(0.95, bodyMat, trimMat, skinMat);
        const pack = add(new THREE.Mesh(new THREE.BoxGeometry(5.5, 7, 3), darkMat), body!);
        pack.position.set(0, 0, -2.8);
        const bomb = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 12), this.getCachedMat(0x28242a, 0.7, 0.25));
        bomb.position.set(0, -7, 0.8);
        bomb.castShadow = true;
        parts.push(bomb);
        armRight!.add(bomb);
        const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 3, 6), goldMat);
        fuse.position.set(1.4, -4.4, 0.8);
        fuse.rotation.z = 0.55;
        parts.push(fuse);
        armRight!.add(fuse);
        weapon = bomb;
        break;
      }
      case 'frost_witch': {
        const frostMat = this.getCachedMat(0x83d8ff, 0.42, 0.22);
        buildHumanoid(0.98, frostMat, trimMat, this.getCachedMat(0xd8f8ff, 0.55, 0.04));
        const crown = new THREE.Group();
        for (let i = 0; i < 5; i++) {
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.7, 4.2, 8), frostMat);
          spike.position.set((i - 2) * 1.15, 12 + Math.abs(i - 2) * -0.25, 0);
          spike.castShadow = true;
          parts.push(spike);
          crown.add(spike);
        }
        body!.add(crown);
        const wand = new THREE.Group();
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 15, 8), woodMat);
        stick.position.y = -8;
        parts.push(stick);
        wand.add(stick);
        const ice = new THREE.Mesh(new THREE.OctahedronGeometry(2.2), frostMat);
        ice.position.y = -0.5;
        ice.castShadow = true;
        parts.push(ice);
        wand.add(ice);
        armRight!.add(wand);
        weapon = wand;
        break;
      }
      case 'stormcaller': {
        const stormMat = this.getCachedMat(0x36465f, 0.58, 0.35);
        buildHumanoid(1.08, stormMat, goldMat, skinMat);
        const coil = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.45, 8, 24), goldMat);
        coil.position.y = 10.5;
        coil.rotation.x = Math.PI / 2;
        coil.castShadow = true;
        parts.push(coil);
        body!.add(coil);
        const rod = new THREE.Group();
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 18, 10), metalMat);
        shaft.position.y = -9;
        parts.push(shaft);
        rod.add(shaft);
        const orb = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), goldMat);
        orb.position.y = 0;
        orb.castShadow = true;
        parts.push(orb);
        rod.add(orb);
        armRight!.add(rod);
        weapon = rod;
        break;
      }
      case 'drone': {
        const shellMat = this.getCachedMat(unit.team === 'player' ? 0x4ba6dc : 0xdc4b62, 0.42, 0.55);
        body = new THREE.Group();
        bodyBaseY = 13;
        body.position.y = bodyBaseY;
        group.add(body);
        const core = add(new THREE.Mesh(new THREE.SphereGeometry(4.6, 20, 14), shellMat), body);
        core.scale.set(1.25, 0.55, 1);
        const lens = add(new THREE.Mesh(new THREE.SphereGeometry(1.3, 12, 8), trimMat), body);
        lens.position.set(0, 0, 4.2);
        for (const sx of [-1, 1]) {
          const wing = add(new THREE.Mesh(new THREE.BoxGeometry(7, 0.8, 2.2), darkMat), body);
          wing.position.set(sx * 5.2, 0.2, 0);
          const rotor = add(new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.25, 6, 18), trimMat), body);
          rotor.position.set(sx * 8.4, 0.35, 0);
          rotor.rotation.x = Math.PI / 2;
        }
        weapon = core;
        break;
      }
      case 'berserker': {
        buildHumanoid(1.03, bodyMat, darkMat, this.getCachedMat(0xffc0a0, 0.62, 0.04));
        const hair = new THREE.Mesh(new THREE.ConeGeometry(3.2, 4.5, 12), this.getCachedMat(0xff5a3d, 0.6, 0.08));
        hair.position.y = 12.2;
        hair.castShadow = true;
        parts.push(hair);
        body!.add(hair);
        const makeAxe = () => {
          const axe = new THREE.Group();
          const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 10, 8), woodMat);
          handle.position.y = -7;
          parts.push(handle);
          axe.add(handle);
          const blade = new THREE.Mesh(new THREE.BoxGeometry(4.2, 3, 0.7), metalMat);
          blade.position.set(1.6, -12, 0);
          blade.castShadow = true;
          parts.push(blade);
          axe.add(blade);
          return axe;
        };
        const leftAxe = makeAxe();
        armLeft!.add(leftAxe);
        const rightAxe = makeAxe();
        armRight!.add(rightAxe);
        weapon = rightAxe;
        break;
      }
      case 'priest': {
        const robeMat = this.getCachedMat(0xf2e6b8, 0.62, 0.08);
        buildHumanoid(0.96, robeMat, goldMat, skinMat);
        const halo = new THREE.Mesh(new THREE.TorusGeometry(3, 0.28, 8, 24), goldMat);
        halo.position.y = 13.6;
        halo.rotation.x = Math.PI / 2;
        parts.push(halo);
        body!.add(halo);
        const bell = new THREE.Group();
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 7, 8), woodMat);
        handle.position.y = -5;
        parts.push(handle);
        bell.add(handle);
        const cup = new THREE.Mesh(new THREE.ConeGeometry(2.2, 3.6, 16), goldMat);
        cup.position.y = -9.8;
        cup.rotation.x = Math.PI;
        cup.castShadow = true;
        parts.push(cup);
        bell.add(cup);
        armRight!.add(bell);
        weapon = bell;
        break;
      }
    }

    const aura = new THREE.Mesh(
      new THREE.RingGeometry(unit.radius * 0.42, unit.radius * 0.78, 40),
      new THREE.MeshBasicMaterial({
        color: unit.team === 'player' ? 0x65c8ff : 0xff6a7d,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.35;
    group.add(aura);

    // Общее увеличение всех юнитов на ~20%.
    group.scale.setScalar(UNIT_SCALE);
    group.position.copy(worldToThree(unit.x, unit.y));
    return {
      group,
      parts,
      aura,
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
    const stone = this.getCachedMat(color, 0.55, 0.36);
    const roof = this.getCachedMat(trim, 0.45, 0.42);
    const dark = this.getCachedMat(0x151a25, 0.7, 0.32);

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

    if (isKing) {
      // У короля — пушка-ракетница.
      const cannon = add(
        new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 22, 12), dark),
      );
      cannon.position.set(0, height + 10, tower.team === 'player' ? -10 : 10);
      cannon.rotation.x = Math.PI / 2;
      for (const x of [-8, 0, 8]) {
        const crown = add(
          new THREE.Mesh(new THREE.ConeGeometry(2.4, 7, 5), this.getCachedMat(0xf2c14e, 0.5, 0.38)),
        );
        crown.position.set(x, height + 32, 0);
      }
    }

    const aura = new THREE.Mesh(
      new THREE.RingGeometry(isKing ? width * 0.42 : width * 0.36, isKing ? width * 0.72 : width * 0.62, 48),
      new THREE.MeshBasicMaterial({
        color: tower.team === 'player' ? 0x65c8ff : 0xff6a7d,
        transparent: true,
        opacity: isKing ? 0.2 : 0.16,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.45;
    group.add(aura);

    const model: TowerModel = {
      group,
      parts,
      aura,
      hp: tower.hp,
      destroyedAnimStart: 0,
      isDestroyed: false,
      archerAttackUntil: 0,
    };

    if (!isKing) {
      // На принцессе — лучница, которая стреляет.
      const teamColor = tower.team === 'player' ? 0x2f80c8 : 0xd64455;
      const trimC = tower.team === 'player' ? 0x8fd1ff : 0xffa0ad;
      const archerScale = 0.85;
      const archer = new THREE.Group();
      archer.position.y = height + 12; // на «крыше» — внутри башни-конуса крыши
      const bodyMat2 = this.getCachedMat(teamColor, 0.55, 0.38);
      const trimMat2 = this.getCachedMat(trimC, 0.45, 0.42);
      const darkMat2 = this.getCachedMat(0x163a59, 0.7, 0.3);
      const goldMat2 = this.getCachedMat(0xf2c14e, 0.5, 0.5);
      const skinMat2 = this.getCachedMat(0xe8b48a, 0.7, 0.05);

      const torso = new THREE.Mesh(
        new THREE.CapsuleGeometry(2.4 * archerScale, 7 * archerScale, 4, 8),
        bodyMat2,
      );
      torso.position.y = 4;
      torso.castShadow = true;
      parts.push(torso);
      archer.add(torso);

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(2 * archerScale, 14, 10),
        skinMat2,
      );
      head.position.y = 9;
      head.castShadow = true;
      parts.push(head);
      archer.add(head);

      // Капюшон/шлем.
      const helm = new THREE.Mesh(
        new THREE.ConeGeometry(2.3 * archerScale, 2.3 * archerScale, 14),
        trimMat2,
      );
      helm.position.y = 11;
      helm.castShadow = true;
      parts.push(helm);
      archer.add(helm);

      // Лук — неподвижная основа.
      const bow = new THREE.Mesh(
        new THREE.TorusGeometry(3.2 * archerScale, 0.36, 6, 18, Math.PI * 1.3),
        goldMat2,
      );
      bow.rotation.set(Math.PI / 2, 0, 0.18);
      bow.position.set(2.6, 4.5, 0);
      bow.castShadow = false;
      parts.push(bow);
      archer.add(bow);

      // «Рука с тетивой» — pivot, анимируется при выстреле.
      const armPivot = new THREE.Group();
      armPivot.position.set(0, 5, 0);
      archer.add(armPivot);
      const arm = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.8 * archerScale, 5 * archerScale, 4, 6),
        bodyMat2,
      );
      arm.position.y = -2;
      arm.castShadow = true;
      parts.push(arm);
      armPivot.add(arm);

      // Колчан за спиной.
      const quiver = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.9, 5, 10),
        darkMat2,
      );
      quiver.position.set(-1.8, 5, -1.6);
      quiver.rotation.x = 0.25;
      quiver.castShadow = true;
      parts.push(quiver);
      archer.add(quiver);

      // Лучница смотрит на середину арены.
      archer.rotation.y = tower.team === 'player' ? 0 : Math.PI;

      group.add(archer);
      model.archer = archer;
      model.archerArm = armPivot;
    }

    group.position.set(pos.x, 0, pos.z);
    return model;
  }

  private setupLighting() {
    this.scene.add(new THREE.HemisphereLight(0xf7fbff, 0x2d3445, IS_COARSE_POINTER ? 1.3 : 1.22));
    const key = new THREE.DirectionalLight(0xffffff, IS_COARSE_POINTER ? 2.28 : 2.15);
    key.position.set(-140, 360, 240);
    key.castShadow = true;
    key.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 900;
    key.shadow.camera.left = -260;
    key.shadow.camera.right = 260;
    key.shadow.camera.top = 520;
    key.shadow.camera.bottom = -520;
    // Bias смягчает self-shadow артефакты на тонких объектах.
    key.shadow.bias = -0.0007;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x8fd1ff, IS_COARSE_POINTER ? 0.86 : 0.72);
    rim.position.set(180, 180, -260);
    this.scene.add(rim);

    const warmFill = new THREE.DirectionalLight(0xffd267, IS_COARSE_POINTER ? 0.34 : 0.28);
    warmFill.position.set(120, 120, 260);
    this.scene.add(warmFill);
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
      // Материалы не диспозим если они закэшированы (используются другими).
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        const shared = (material as THREE.Material & { __shared?: boolean }).__shared;
        if (!shared) material.dispose();
      }
    });
  }

  private clearFlash(parts: THREE.Object3D[]) {
    for (const part of parts) {
      const mesh = part as THREE.Mesh;
      const mat = mesh.material;
      if (!mat || Array.isArray(mat) || !(mat instanceof THREE.MeshStandardMaterial)) continue;
      if ((mat as THREE.MeshStandardMaterial & { __shared?: boolean }).__shared) continue;
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
  if (type === 'tank') return 1.5;
  if (type === 'drone') return 8.5;
  return 2.2;
}
