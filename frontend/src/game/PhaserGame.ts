import Phaser from 'phaser';
import {
  ARENA_COLORS,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BRIDGES,
  COLS,
  LANE_PATHS,
  LANE_PATHS_PX,
  LANES,
  PLAYER_FIRST_ROW,
  RIVER_BOTTOM_ROW,
  RIVER_TOP_ROW,
  ROWS,
  TILE,
  TOWER_LAYOUTS,
  rectToPx,
  type Lane,
  type Side,
  type Vec,
} from './arena';
import { Tower } from './tower';
import { Unit, UNIT_STATS, type UnitType } from './unit';
import { SPELL_STATS, type SpellCode } from './spells';
import {
  CARDS,
  ENERGY_REGEN_INTERVAL_MS,
  HAND_SIZE,
  MATCH_DURATION_MS,
  MAX_ENERGY,
  START_ENERGY,
  STARTER_DECK,
  useBattleStore,
  type CardCode,
  type MatchResult,
} from '@/store/battleStore';

interface TowerView {
  body: Phaser.GameObjects.Graphics;
  hpBar: Phaser.GameObjects.Graphics;
  hpText: Phaser.GameObjects.Text;
  rangeCircle: Phaser.GameObjects.Graphics;
}

interface UnitView {
  body: Phaser.GameObjects.Graphics;
  hpBar: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
}

type AttackTarget =
  | { kind: 'unit'; ref: Unit }
  | { kind: 'tower'; ref: Tower };

const PERCEPTION_BONUS = 80;

export class ArenaScene extends Phaser.Scene {
  towers: Tower[] = [];
  units: Unit[] = [];

  private towerViews = new Map<string, TowerView>();
  private unitViews = new Map<string, UnitView>();
  private nextUnitId = 1;

  private energyTimer?: Phaser.Time.TimerEvent;
  private botEnergyTimer?: Phaser.Time.TimerEvent;
  private matchTimer?: Phaser.Time.TimerEvent;
  private gameOver = false;
  private matchStartedAt = 0;

  // AI-бот
  private botEnergy = START_ENERGY;
  private botDeck: CardCode[] = [...STARTER_DECK];

  private zoneGfx?: Phaser.GameObjects.Graphics;
  private zoneUnsub?: () => void;
  private lastSelected: CardCode | null = null;

  constructor() {
    super('Arena');
  }

  create() {
    useBattleStore.getState().reset();

    this.gameOver = false;
    this.towers = [];
    this.units = [];
    this.towerViews.clear();
    this.unitViews.clear();
    this.nextUnitId = 1;
    this.botEnergy = START_ENERGY;
    this.botDeck = [...STARTER_DECK];
    this.matchStartedAt = this.time.now;

    this.cameras.main.setBackgroundColor('#0b0d12');
    this.drawZones();
    this.drawLanes();
    this.drawRiver();
    this.drawBridges();
    this.drawGrid();
    this.drawSideLabels();
    this.spawnTowers();

    this.zoneGfx = this.add.graphics();
    this.zoneGfx.setDepth(50);

    this.input.on('pointerdown', this.onPointerDown, this);

    this.zoneUnsub = useBattleStore.subscribe((state) => {
      if (state.selectedCard !== this.lastSelected) {
        this.lastSelected = state.selectedCard;
        this.updateZoneOverlay(state.selectedCard);
      }
    });

    // Регэн энергии игрока.
    this.energyTimer = this.time.addEvent({
      delay: ENERGY_REGEN_INTERVAL_MS,
      loop: true,
      callback: () => {
        if (this.gameOver) return;
        useBattleStore.getState().addEnergy(1);
      },
    });

    // Регэн энергии бота.
    this.botEnergyTimer = this.time.addEvent({
      delay: ENERGY_REGEN_INTERVAL_MS,
      loop: true,
      callback: () => {
        if (this.gameOver) return;
        this.botEnergy = Math.min(MAX_ENERGY, this.botEnergy + 1);
      },
    });

    // Тайм-тик матча: каждые 200мс обновляем оставшееся время в стор.
    this.matchTimer = this.time.addEvent({
      delay: 200,
      loop: true,
      callback: () => {
        if (this.gameOver) return;
        const elapsed = this.time.now - this.matchStartedAt;
        const left = Math.max(0, MATCH_DURATION_MS - elapsed);
        useBattleStore.getState().setMatchTimeLeft(left);
        if (left === 0) this.onTimeout();
      },
    });

    // Запуск AI-бота с рандомным интервалом.
    this.scheduleBotTick();

    this.events.once('shutdown', () => {
      this.zoneUnsub?.();
    });
  }

  override update(time: number, deltaMs: number) {
    if (this.gameOver) return;
    const dt = deltaMs / 1000;
    for (const unit of this.units) {
      if (unit.isDead) continue;
      this.tickUnit(unit, time, dt);
    }
  }

  // ───── Цикл боя одного юнита ─────

  private tickUnit(unit: Unit, time: number, dt: number) {
    const target = this.pickTarget(unit);

    if (!target) {
      if (unit.waypointIndex < unit.waypoints.length) {
        this.advanceUnitWaypoints(unit, dt);
        unit.state = 'moving';
      } else {
        unit.state = 'idle';
      }
      return;
    }

    const tx = targetX(target);
    const ty = targetY(target);
    const tr = targetRadius(target);
    const dx = tx - unit.x;
    const dy = ty - unit.y;
    const dist = Math.hypot(dx, dy);
    const attackDist = unit.range + tr;

    if (dist <= attackDist) {
      unit.state = 'attacking';
      const cooldownMs = unit.attackSpeed * 1000;
      if (time - unit.lastAttackAt >= cooldownMs) {
        this.applyDamage(target, unit.damage);
        unit.lastAttackAt = time;
        this.flashAttack({ x: unit.x, y: unit.y }, { x: tx, y: ty });
      }
      this.updateUnitView(unit);
      return;
    }

    unit.state = 'moving';
    if (target.kind === 'unit') {
      this.moveUnitToward(unit, { x: tx, y: ty }, dt);
    } else if (unit.waypointIndex < unit.waypoints.length) {
      this.advanceUnitWaypoints(unit, dt);
    } else {
      this.moveUnitToward(unit, { x: tx, y: ty }, dt);
    }
  }

  private pickTarget(unit: Unit): AttackTarget | null {
    const perception = unit.range + PERCEPTION_BONUS;

    let bestUnit: Unit | null = null;
    let bestUnitDist = Infinity;
    for (const other of this.units) {
      if (other.team === unit.team || other.isDead) continue;
      const d = Math.hypot(unit.x - other.x, unit.y - other.y) - other.radius;
      if (d <= perception && d < bestUnitDist) {
        bestUnit = other;
        bestUnitDist = d;
      }
    }
    if (bestUnit) return { kind: 'unit', ref: bestUnit };

    let bestPrincess: Tower | null = null;
    let bestPrincessDist = Infinity;
    let king: Tower | null = null;
    let kingDist = Infinity;

    for (const t of this.towers) {
      if (t.team === unit.team || t.isDestroyed) continue;
      const half = towerHalfSize(t);
      const d = Math.hypot(unit.x - t.x, unit.y - t.y) - half;
      if (t.type === 'princess' && d < bestPrincessDist) {
        bestPrincess = t;
        bestPrincessDist = d;
      }
      if (t.type === 'king' && d < kingDist) {
        king = t;
        kingDist = d;
      }
    }

    if (bestPrincess) return { kind: 'tower', ref: bestPrincess };
    if (king) return { kind: 'tower', ref: king };
    return null;
  }

  private moveUnitToward(unit: Unit, point: Vec, dt: number) {
    const dx = point.x - unit.x;
    const dy = point.y - unit.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return;
    const step = unit.moveSpeed * dt;
    const t = Math.min(1, step / dist);
    unit.x += dx * t;
    unit.y += dy * t;
    this.updateUnitView(unit);
  }

  private advanceUnitWaypoints(unit: Unit, dt: number) {
    let budget = unit.moveSpeed * dt;
    while (budget > 0 && unit.waypointIndex < unit.waypoints.length) {
      const wp = unit.waypoints[unit.waypointIndex];
      const dx = wp.x - unit.x;
      const dy = wp.y - unit.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) {
        unit.waypointIndex++;
        continue;
      }
      if (budget >= dist) {
        unit.x = wp.x;
        unit.y = wp.y;
        budget -= dist;
        unit.waypointIndex++;
      } else {
        const t = budget / dist;
        unit.x += dx * t;
        unit.y += dy * t;
        budget = 0;
      }
    }
    this.updateUnitView(unit);
  }

  private applyDamage(target: AttackTarget, amount: number) {
    if (target.kind === 'tower') {
      this.damageTower(target.ref.id, amount);
    } else {
      this.damageUnit(target.ref, amount);
    }
  }

  private damageUnit(unit: Unit, amount: number) {
    const wasAlive = !unit.isDead;
    const destroyed = unit.takeDamage(amount);
    this.updateUnitView(unit);
    const view = this.unitViews.get(unit.id);
    if (!view) return;

    if (wasAlive && !destroyed) {
      // Damage flash.
      this.tweens.killTweensOf(view.body);
      view.body.alpha = 0.4;
      this.tweens.add({
        targets: view.body,
        alpha: 1,
        duration: 130,
      });
    }

    if (destroyed) {
      this.deathPoof(unit.x, unit.y, unit.team === 'player' ? 0x2a5d8a : 0xc1334a);
      this.tweens.add({
        targets: [view.body, view.hpBar, view.label],
        alpha: 0,
        duration: 250,
        onComplete: () => {
          view.body.destroy();
          view.hpBar.destroy();
          view.label.destroy();
          this.unitViews.delete(unit.id);
        },
      });
    }
  }

  private deathPoof(x: number, y: number, color: number) {
    const g = this.add.graphics();
    g.fillStyle(color, 0.55);
    g.fillCircle(x, y, 10);
    this.tweens.add({
      targets: g,
      scale: 2.5,
      alpha: 0,
      duration: 380,
      onComplete: () => g.destroy(),
    });
  }

  private flashAttack(from: Vec, to: Vec) {
    const line = this.add.graphics();
    line.lineStyle(2, 0xffffff, 0.8);
    line.lineBetween(from.x, from.y, to.x, to.y);
    this.tweens.add({
      targets: line,
      alpha: 0,
      duration: 220,
      onComplete: () => line.destroy(),
    });
  }

  // ───── Pointer / placement (игрок) ─────

  private onPointerDown(pointer: Phaser.Input.Pointer) {
    if (this.gameOver) return;
    const store = useBattleStore.getState();
    const code = store.selectedCard;
    if (!code) return;

    const card = CARDS[code];
    const x = pointer.worldX;
    const y = pointer.worldY;

    if (!this.isValidPlacement(code, x, y)) {
      store.pulseInsufficient();
      return;
    }
    if (store.energy < card.energyCost) {
      store.pulseInsufficient();
      return;
    }

    store.spendEnergy(card.energyCost);
    store.cycleCard(code);

    if (card.kind === 'spell') {
      this.castSpell(code as SpellCode, x, y, 'player');
      return;
    }
    if (card.kind === 'unit') {
      const lane: Lane = x < ARENA_WIDTH / 2 ? 'left' : 'right';
      this.spawnUnit(code as UnitType, 'player', lane);
    }
  }

  private isValidPlacement(code: CardCode, x: number, y: number): boolean {
    if (x < 0 || x > ARENA_WIDTH || y < 0 || y > ARENA_HEIGHT) return false;
    const card = CARDS[code];
    if (card.kind === 'spell') return true;
    if (y < PLAYER_FIRST_ROW * TILE) return false;
    for (const t of this.towers) {
      if (t.team !== 'player') continue;
      const r = rectToPx(t.rect);
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return false;
    }
    return true;
  }

  private updateZoneOverlay(code: CardCode | null) {
    if (!this.zoneGfx) return;
    this.zoneGfx.clear();
    if (!code) return;
    const card = CARDS[code];

    if (card.kind === 'unit') {
      this.zoneGfx.fillStyle(0x88ffaa, 0.12);
      this.zoneGfx.fillRect(
        0,
        PLAYER_FIRST_ROW * TILE,
        ARENA_WIDTH,
        ARENA_HEIGHT - PLAYER_FIRST_ROW * TILE,
      );
      this.zoneGfx.fillStyle(0xff5566, 0.25);
      for (const t of this.towers) {
        if (t.team !== 'player') continue;
        const r = rectToPx(t.rect);
        this.zoneGfx.fillRect(r.x, r.y, r.w, r.h);
      }
      this.zoneGfx.lineStyle(2, 0x88ffaa, 0.5);
      this.zoneGfx.strokeRect(
        1,
        PLAYER_FIRST_ROW * TILE + 1,
        ARENA_WIDTH - 2,
        ARENA_HEIGHT - PLAYER_FIRST_ROW * TILE - 2,
      );
    } else {
      this.zoneGfx.fillStyle(0xffaa55, 0.1);
      this.zoneGfx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
      this.zoneGfx.lineStyle(2, 0xffaa55, 0.5);
      this.zoneGfx.strokeRect(1, 1, ARENA_WIDTH - 2, ARENA_HEIGHT - 2);
    }
  }

  // ───── Заклинания ─────

  private castSpell(code: SpellCode, x: number, y: number, casterTeam: Side) {
    const stats = SPELL_STATS[code];

    // Внутренний круг (область).
    const gfx = this.add.graphics();
    gfx.fillStyle(stats.color, 0.45);
    gfx.fillCircle(x, y, stats.radius);
    this.tweens.add({
      targets: gfx,
      alpha: 0,
      duration: 600,
      onComplete: () => gfx.destroy(),
    });

    // Расширяющееся кольцо.
    const ringState = { r: 0 };
    const ring = this.add.graphics();
    this.tweens.add({
      targets: ringState,
      r: stats.radius * 1.15,
      duration: 500,
      ease: 'Quad.Out',
      onUpdate: () => {
        ring.clear();
        ring.lineStyle(3, stats.color, 0.7);
        ring.strokeCircle(x, y, ringState.r);
      },
      onComplete: () => ring.destroy(),
    });

    if (stats.hostile) {
      this.cameras.main.shake(180, 0.003);
      for (const u of this.units) {
        if (u.isDead || u.team === casterTeam) continue;
        const d = Math.hypot(u.x - x, u.y - y);
        if (d <= stats.radius) this.damageUnit(u, stats.unitImpact);
      }
      if (stats.towerImpact > 0) {
        for (const t of this.towers) {
          if (t.isDestroyed || t.team === casterTeam) continue;
          const half = towerHalfSize(t);
          const d = Math.hypot(t.x - x, t.y - y) - half;
          if (d <= stats.radius) this.damageTower(t.id, stats.towerImpact);
        }
      }
    } else {
      for (const u of this.units) {
        if (u.isDead || u.team !== casterTeam) continue;
        const d = Math.hypot(u.x - x, u.y - y);
        if (d <= stats.radius) {
          u.heal(stats.unitImpact);
          this.updateUnitView(u);
        }
      }
    }
  }

  // ───── AI-бот ─────

  private scheduleBotTick() {
    if (this.gameOver) return;
    const delay = 3000 + Math.random() * 2000; // 3–5 секунд
    this.time.delayedCall(delay, () => {
      if (this.gameOver) return;
      this.botTick();
      this.scheduleBotTick();
    });
  }

  private botTick() {
    const hand = this.botDeck.slice(0, HAND_SIZE);
    const affordable = hand.filter((code) => CARDS[code].energyCost <= this.botEnergy);
    if (!affordable.length) return;

    // С небольшой вероятностью дождаться больше энергии — не сливать дешёвки на старте.
    if (this.botEnergy < 4 && Math.random() < 0.4) return;

    const code = affordable[Math.floor(Math.random() * affordable.length)];
    const card = CARDS[code];

    if (card.kind === 'spell') {
      const target =
        code === 'heal'
          ? this.pickHealCenter('enemy')
          : this.pickHostileCenter('player');
      if (!target) return; // пропускаем тик — нет смысла кидать в пустоту
      this.botEnergy -= card.energyCost;
      this.castSpell(code as SpellCode, target.x, target.y, 'enemy');
      this.cycleBotCard(code);
      return;
    }

    // Юнит — выбираем линию с ориентацией на угрозу или случайно.
    const lane = this.pickBotLane();
    this.botEnergy -= card.energyCost;
    this.spawnUnit(code as UnitType, 'enemy', lane);
    this.cycleBotCard(code);
  }

  private cycleBotCard(code: CardCode) {
    const i = this.botDeck.indexOf(code);
    if (i < 0) return;
    this.botDeck.splice(i, 1);
    this.botDeck.push(code);
  }

  /** Куда бы ботнуть unit: если игрок копит на одном фланге — туда же. */
  private pickBotLane(): Lane {
    const left = this.units.filter((u) => u.team === 'player' && !u.isDead && u.lane === 'left').length;
    const right = this.units.filter((u) => u.team === 'player' && !u.isDead && u.lane === 'right').length;
    if (left === right) return Math.random() < 0.5 ? 'left' : 'right';
    return left > right ? 'left' : 'right';
  }

  private pickHostileCenter(targetTeam: Side): Vec | null {
    const enemies = this.units.filter((u) => u.team === targetTeam && !u.isDead);
    if (enemies.length === 0) return null;
    const seed = enemies[Math.floor(Math.random() * enemies.length)];
    const nearby = enemies.filter((u) => Math.hypot(u.x - seed.x, u.y - seed.y) < 70);
    if (nearby.length < 2) return null;
    const cx = nearby.reduce((s, u) => s + u.x, 0) / nearby.length;
    const cy = nearby.reduce((s, u) => s + u.y, 0) / nearby.length;
    return { x: cx, y: cy };
  }

  private pickHealCenter(myTeam: Side): Vec | null {
    const wounded = this.units.filter((u) => u.team === myTeam && !u.isDead && u.hpRatio < 0.6);
    if (wounded.length < 2) return null;
    const cx = wounded.reduce((s, u) => s + u.x, 0) / wounded.length;
    const cy = wounded.reduce((s, u) => s + u.y, 0) / wounded.length;
    return { x: cx, y: cy };
  }

  // ───── Финал матча ─────

  private onTimeout() {
    if (this.gameOver) return;
    const td = useBattleStore.getState().towersDestroyed;
    if (td.enemy > td.player) this.endGame('won');
    else if (td.player > td.enemy) this.endGame('lost');
    else this.endGame('draw');
  }

  private endGame(result: 'won' | 'lost' | 'draw') {
    if (this.gameOver) return;
    this.gameOver = true;

    const td = useBattleStore.getState().towersDestroyed;
    const elapsedMs = this.time.now - this.matchStartedAt;
    const durationSec = Math.max(0, Math.floor(elapsedMs / 1000));

    const baseCoins = result === 'won' ? 50 : result === 'draw' ? 15 : 5;
    const baseXp = result === 'won' ? 25 : result === 'draw' ? 10 : 5;
    const coins = baseCoins + td.enemy * 10;
    const xp = baseXp + td.enemy * 5;

    const matchResult: MatchResult = {
      outcome: result,
      durationSec,
      towersDestroyed: td.enemy,
      towersLost: td.player,
      coinsEarned: coins,
      xpEarned: xp,
    };

    useBattleStore.getState().setResult(matchResult);
    useBattleStore.getState().setGameState(result);

    this.energyTimer?.remove();
    this.botEnergyTimer?.remove();
    this.matchTimer?.remove();
  }

  // ───── Статика арены ─────

  private drawZones() {
    const g = this.add.graphics();
    g.fillStyle(ARENA_COLORS.enemyZone, 1);
    g.fillRect(0, 0, ARENA_WIDTH, RIVER_TOP_ROW * TILE);
    g.fillStyle(ARENA_COLORS.playerZone, 1);
    g.fillRect(
      0,
      (RIVER_BOTTOM_ROW + 1) * TILE,
      ARENA_WIDTH,
      ARENA_HEIGHT - (RIVER_BOTTOM_ROW + 1) * TILE,
    );
  }

  private drawLanes() {
    const g = this.add.graphics();
    g.fillStyle(ARENA_COLORS.lane, 1);
    g.lineStyle(1, ARENA_COLORS.laneStroke, 0.8);
    for (const path of LANE_PATHS) {
      const r = rectToPx(path);
      g.fillRect(r.x, r.y, r.w, r.h);
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }
  }

  private drawRiver() {
    const g = this.add.graphics();
    g.fillStyle(ARENA_COLORS.river, 1);
    g.fillRect(0, RIVER_TOP_ROW * TILE, ARENA_WIDTH, 2 * TILE);
    g.fillStyle(ARENA_COLORS.riverEdge, 1);
    g.fillRect(0, RIVER_TOP_ROW * TILE, ARENA_WIDTH, 2);
    g.fillRect(0, (RIVER_BOTTOM_ROW + 1) * TILE - 2, ARENA_WIDTH, 2);
  }

  private drawBridges() {
    const g = this.add.graphics();
    g.fillStyle(ARENA_COLORS.bridge, 1);
    g.lineStyle(2, ARENA_COLORS.bridgeStroke, 1);
    for (const b of BRIDGES) {
      const r = rectToPx(b);
      g.fillRect(r.x, r.y, r.w, r.h);
      g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
  }

  private drawGrid() {
    const g = this.add.graphics();
    g.lineStyle(1, ARENA_COLORS.grid, 0.08);
    for (let c = 1; c < COLS; c++) {
      g.lineBetween(c * TILE, 0, c * TILE, ARENA_HEIGHT);
    }
    for (let r = 1; r < ROWS; r++) {
      if (r === RIVER_TOP_ROW || r === RIVER_BOTTOM_ROW + 1) continue;
      g.lineBetween(0, r * TILE, ARENA_WIDTH, r * TILE);
    }
  }

  private drawSideLabels() {
    const labelStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
      color: '#ffffff',
      fontStyle: 'bold',
    };
    this.add
      .text(ARENA_WIDTH / 2, (PLAYER_FIRST_ROW - 0.4) * TILE, 'ИГРОК', labelStyle)
      .setOrigin(0.5, 0)
      .setAlpha(0.85);
    this.add
      .text(ARENA_WIDTH / 2, (RIVER_TOP_ROW - 0.6) * TILE, 'ВРАГ', labelStyle)
      .setOrigin(0.5, 1)
      .setAlpha(0.85);
  }

  // ───── Башни ─────

  private spawnTowers() {
    for (const layout of TOWER_LAYOUTS) {
      const tower = new Tower({
        id: layout.id,
        team: layout.team,
        type: layout.type,
        lane: layout.lane,
        rect: layout.rect,
      });
      this.towers.push(tower);
      const view = this.drawTower(tower);
      this.towerViews.set(tower.id, view);
      this.updateTowerHud(tower);
    }
  }

  private drawTower(tower: Tower): TowerView {
    const r = rectToPx(tower.rect);
    const isKing = tower.type === 'king';
    const isPlayer = tower.team === 'player';

    const fill = isPlayer
      ? isKing
        ? ARENA_COLORS.playerKingTower
        : ARENA_COLORS.playerTower
      : isKing
        ? ARENA_COLORS.enemyKingTower
        : ARENA_COLORS.enemyTower;
    const stroke = isPlayer
      ? isKing
        ? ARENA_COLORS.playerKingEdge
        : ARENA_COLORS.playerTowerEdge
      : isKing
        ? ARENA_COLORS.enemyKingEdge
        : ARENA_COLORS.enemyTowerEdge;

    const rangeCircle = this.add.graphics();
    rangeCircle.lineStyle(1, isPlayer ? ARENA_COLORS.playerTower : ARENA_COLORS.enemyTower, 0.18);
    rangeCircle.strokeCircle(tower.x, tower.y, tower.range);

    const body = this.add.graphics();
    body.fillStyle(fill, 1);
    body.lineStyle(2, stroke, 1);
    body.fillRoundedRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8, 6);
    body.strokeRoundedRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8, 6);

    if (isKing) {
      const crown = this.add.graphics();
      crown.fillStyle(0xf2c14e, 1);
      crown.fillCircle(tower.x, tower.y - 2, 6);
    }

    const hpBar = this.add.graphics();
    const hpText = this.add.text(tower.x, r.y - 14, '', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '11px',
      color: '#ffffff',
      fontStyle: 'bold',
    });
    hpText.setOrigin(0.5, 1);

    return { body, hpBar, hpText, rangeCircle };
  }

  updateTowerHud(tower: Tower) {
    const view = this.towerViews.get(tower.id);
    if (!view) return;
    const r = rectToPx(tower.rect);
    const isPlayer = tower.team === 'player';
    const barW = r.w - 12;
    const barH = 4;
    const barX = r.x + 6;
    const barY = r.y - 8;
    const fill = isPlayer ? ARENA_COLORS.playerTower : ARENA_COLORS.enemyTower;

    const bar = view.hpBar;
    bar.clear();
    bar.fillStyle(0x000000, 0.45);
    bar.fillRoundedRect(barX, barY, barW, barH, 2);
    bar.fillStyle(fill, 1);
    bar.fillRoundedRect(barX, barY, Math.max(0, barW * tower.hpRatio), barH, 2);
    bar.lineStyle(1, 0x000000, 0.5);
    bar.strokeRoundedRect(barX, barY, barW, barH, 2);

    view.hpText.setText(`${tower.hp} / ${tower.maxHp}`);
  }

  damageTower(id: string, amount: number) {
    const tower = this.towers.find((t) => t.id === id);
    if (!tower) return;
    const wasAlive = !tower.isDestroyed;
    const destroyed = tower.takeDamage(amount);
    this.updateTowerHud(tower);

    const view = this.towerViews.get(id);

    if (wasAlive && !destroyed && view) {
      this.tweens.killTweensOf(view.body);
      view.body.alpha = 0.5;
      this.tweens.add({
        targets: view.body,
        alpha: 1,
        duration: 130,
      });
    }

    if (destroyed) {
      // shake + жёлтая вспышка по корпусу
      this.cameras.main.shake(320, 0.006);
      if (view) {
        const r = rectToPx(tower.rect);
        const flash = this.add.graphics();
        flash.fillStyle(0xfff58c, 0.8);
        flash.fillRoundedRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8, 6);
        this.tweens.add({
          targets: flash,
          alpha: 0,
          duration: 500,
          onComplete: () => flash.destroy(),
        });
        this.tweens.add({
          targets: view.body,
          alpha: 0.3,
          duration: 350,
        });
        view.rangeCircle.setAlpha(0);
        view.hpText.setText('×');
      }

      const store = useBattleStore.getState();
      const side: Side = tower.team;
      const next =
        (side === 'player' ? store.towersDestroyed.player : store.towersDestroyed.enemy) + 1;
      store.setTowersDestroyed(side, next);

      if (tower.type === 'king') {
        this.endGame(tower.team === 'enemy' ? 'won' : 'lost');
      }
    }
  }

  // ───── Юниты ─────

  spawnUnit(type: UnitType, team: Side, lane: Lane): Unit {
    const laneCol = LANES[lane].col;
    const x = laneCol * TILE + TILE / 2;
    const y =
      team === 'player'
        ? (PLAYER_FIRST_ROW + 2) * TILE + TILE / 2
        : (RIVER_TOP_ROW - 3) * TILE + TILE / 2;

    const unit = new Unit({
      id: `u${this.nextUnitId++}-${type}-${team}`,
      type,
      team,
      lane,
      x,
      y,
      waypoints: LANE_PATHS_PX[lane][team],
    });
    this.units.push(unit);

    const view = this.drawUnit(unit);
    this.unitViews.set(unit.id, view);
    this.updateUnitView(unit);

    // spawn-in animation: scale 0.3 → 1
    view.body.setScale(0.3);
    view.body.alpha = 0.5;
    view.label.setScale(0.3);
    view.label.alpha = 0;
    this.tweens.add({
      targets: [view.body, view.label],
      scale: 1,
      alpha: 1,
      duration: 230,
      ease: 'Back.Out',
    });

    return unit;
  }

  private drawUnit(unit: Unit): UnitView {
    const isPlayer = unit.team === 'player';
    const fill = isPlayer ? ARENA_COLORS.playerTower : ARENA_COLORS.enemyTower;
    const stroke = isPlayer ? ARENA_COLORS.playerTowerEdge : ARENA_COLORS.enemyTowerEdge;

    const body = this.add.graphics();
    body.fillStyle(fill, 1);
    body.lineStyle(2, stroke, 1);
    body.fillCircle(0, 0, unit.radius);
    body.strokeCircle(0, 0, unit.radius);
    body.x = unit.x;
    body.y = unit.y;

    const label = this.add.text(unit.x, unit.y, typeGlyph(unit.type), {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      color: '#ffffff',
    });
    label.setOrigin(0.5);

    const hpBar = this.add.graphics();
    return { body, hpBar, label };
  }

  private updateUnitView(unit: Unit) {
    const view = this.unitViews.get(unit.id);
    if (!view) return;
    view.body.x = unit.x;
    view.body.y = unit.y;
    view.label.x = unit.x;
    view.label.y = unit.y;

    const barW = unit.radius * 2;
    const barH = 3;
    const barX = unit.x - unit.radius;
    const barY = unit.y - unit.radius - 6;
    const fill = unit.team === 'player' ? ARENA_COLORS.playerTower : ARENA_COLORS.enemyTower;

    const bar = view.hpBar;
    bar.clear();
    bar.fillStyle(0x000000, 0.5);
    bar.fillRect(barX, barY, barW, barH);
    bar.fillStyle(fill, 1);
    bar.fillRect(barX, barY, Math.max(0, barW * unit.hpRatio), barH);
  }

  unitCount(): number {
    return this.units.filter((u) => !u.isDead).length;
  }
}

// ───── helpers ─────

function targetX(t: AttackTarget): number {
  return t.ref.x;
}

function targetY(t: AttackTarget): number {
  return t.ref.y;
}

function targetRadius(t: AttackTarget): number {
  return t.kind === 'unit' ? t.ref.radius : towerHalfSize(t.ref);
}

function towerHalfSize(t: Tower): number {
  return (Math.max(t.rect.w, t.rect.h) * TILE) / 2;
}

function typeGlyph(type: UnitType): string {
  switch (type) {
    case 'warrior':
      return '⚔';
    case 'archer':
      return '🏹';
    case 'tank':
      return '🛡';
    case 'assassin':
      return '🗡';
    case 'squad':
      return '👥';
    case 'mage':
      return '🪄';
  }
}

export function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0b0d12',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: ARENA_WIDTH,
      height: ARENA_HEIGHT,
    },
    scene: [ArenaScene],
  });
}

export type { UnitType } from './unit';
export type { CardCode } from '@/store/battleStore';

export function getArenaScene(game: Phaser.Game | null): ArenaScene | null {
  if (!game) return null;
  const scene = game.scene.getScene('Arena');
  return (scene as ArenaScene) ?? null;
}

export { UNIT_STATS };
