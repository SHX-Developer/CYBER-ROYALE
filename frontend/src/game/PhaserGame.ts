/**
 * Phaser-сцена — тонкий рендерер и адаптер ввода поверх BattleEngine.
 *
 * Все игровые расчёты (юниты, башни, цели, урон, энергия, спеллы, таймер)
 * живут в `frontend/src/battle/BattleEngine.ts`. Здесь только:
 *   • рисование арены, башен, юнитов, эффектов;
 *   • отлов клика игрока и трансляция в команду движка;
 *   • AI-бот, который тоже шлёт команды в движок;
 *   • синхронизация состояния движка в Zustand (energy / time / score / result).
 */
import Phaser from 'phaser';
import {
  ARENA_COLORS,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BOTTOM_STAND_PX,
  BRIDGES,
  COLS,
  LANE_PATHS,
  PLAYER_FIRST_ROW,
  RIVER_BOTTOM_ROW,
  RIVER_TOP_ROW,
  ROWS,
  SCENE_HEIGHT,
  TILE,
  TOP_STAND_PX,
  rectToPx,
  type Lane,
  type Side,
} from './arena';
import { Tower } from './tower';
import { Unit, UNIT_STATS, type UnitType } from './unit';
import { SPELL_STATS, type SpellCode } from './spells';
import {
  CARDS,
  ENERGY_REGEN_INTERVAL_MS,
  HAND_SIZE,
  STARTER_DECK,
  useBattleStore,
  type CardCode,
  type MatchResult,
} from '@/store/battleStore';
import { BattleEngine } from '@/battle/BattleEngine';

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

export class ArenaScene extends Phaser.Scene {
  private engine!: BattleEngine;

  /** Контейнер всех «мировых» объектов — смещён на TOP_STAND_PX вниз,
   *  чтобы трибуны помещались сверху и снизу за пределами игрового мира. */
  private world!: Phaser.GameObjects.Container;
  private waterWaves?: Phaser.GameObjects.Graphics;

  private towerViews = new Map<string, TowerView>();
  private unitViews = new Map<string, UnitView>();

  private playerEnergyTimer?: Phaser.Time.TimerEvent;
  private botEnergyTimer?: Phaser.Time.TimerEvent;
  private matchStartedAt = 0;

  // AI-бот: своя колода, тики раз в 3-5 секунд
  private botDeck: CardCode[] = [...STARTER_DECK];

  private zoneGfx?: Phaser.GameObjects.Graphics;
  private zoneUnsub?: () => void;
  private engineUnsub?: () => void;
  private lastSelected: CardCode | null = null;

  constructor() {
    super('Arena');
  }

  create() {
    useBattleStore.getState().reset();

    this.engine = new BattleEngine();
    this.matchStartedAt = this.time.now;
    this.botDeck = [...STARTER_DECK];
    this.towerViews.clear();
    this.unitViews.clear();

    this.cameras.main.setBackgroundColor('#0b0d12');

    // Сначала декор — трибуны живут вне world-контейнера.
    this.drawTopStand();
    this.drawBottomStand();

    // Все объекты арены ездят внутри world-контейнера, сдвинутого на
    // TOP_STAND_PX вниз. Логические координаты остаются в 0..720.
    this.world = this.add.container(0, TOP_STAND_PX);

    this.drawZones();
    this.drawLanes();
    this.drawEdgeDecor();
    this.drawRiver();
    this.drawBridges();
    this.drawGrid();
    this.drawSideLabels();
    this.startWaterAnimation();

    for (const t of this.engine.state.towers) this.attachTowerView(t);

    this.zoneGfx = this.add.graphics();
    this.zoneGfx.setDepth(50);
    this.world.add(this.zoneGfx);

    this.input.on('pointerdown', this.onPointerDown, this);

    // Реакция на смену выбранной карты для подсветки зоны.
    this.zoneUnsub = useBattleStore.subscribe((state) => {
      if (state.selectedCard !== this.lastSelected) {
        this.lastSelected = state.selectedCard;
        this.updateZoneOverlay(state.selectedCard);
      }
    });

    // Подписываемся на события движка для визуала + зеркаление в стор.
    this.engineUnsub = this.engine.on((e) => this.handleEngineEvent(e));

    // Регэн энергии игрока.
    this.playerEnergyTimer = this.time.addEvent({
      delay: ENERGY_REGEN_INTERVAL_MS,
      loop: true,
      callback: () => {
        if (this.engine.state.outcome) return;
        this.engine.addEnergy('player', 1);
      },
    });

    // Регэн энергии бота.
    this.botEnergyTimer = this.time.addEvent({
      delay: ENERGY_REGEN_INTERVAL_MS,
      loop: true,
      callback: () => {
        if (this.engine.state.outcome) return;
        this.engine.addEnergy('enemy', 1);
      },
    });

    // Запуск AI бота.
    this.scheduleBotTick();

    this.events.once('shutdown', () => {
      this.zoneUnsub?.();
      this.engineUnsub?.();
    });
  }

  override update(_time: number, deltaMs: number) {
    if (this.engine.state.outcome) return;
    this.engine.tick(deltaMs);
    // Синхронизируем визуал юнитов с актуальным состоянием.
    for (const u of this.engine.state.units) {
      if (u.isDead) continue;
      this.updateUnitView(u);
    }
  }

  // ───── обработка событий движка ─────

  private handleEngineEvent(e: import('@/battle/types').BattleEvent) {
    const store = useBattleStore.getState();
    switch (e.kind) {
      case 'unitSpawned':
        this.attachUnitView(e.unit);
        break;
      case 'unitDamaged':
        this.flashUnitDamage(e.unit);
        this.updateUnitView(e.unit);
        break;
      case 'unitHealed':
        this.updateUnitView(e.unit);
        break;
      case 'unitDied':
        this.handleUnitDeath(e.unit);
        break;
      case 'attack':
        this.flashAttackLine(e.from, e.to);
        break;
      case 'towerDamaged':
        this.flashTowerDamage(e.tower);
        this.updateTowerHud(e.tower);
        break;
      case 'towerDestroyed':
        this.handleTowerDestroyed(e.tower);
        store.setTowersDestroyed('player', this.engine.state.towersDestroyed.player);
        store.setTowersDestroyed('enemy', this.engine.state.towersDestroyed.enemy);
        break;
      case 'spellCast':
        this.renderSpellEffect(e.code, e.x, e.y);
        break;
      case 'energyChanged':
        if (e.team === 'player') store.setEnergy(e.value);
        break;
      case 'timeTick':
        store.setMatchTimeLeft(e.timeLeftMs);
        break;
      case 'gameOver':
        this.finalizeMatch(e.outcome);
        break;
    }
  }

  // ───── pointer / placement (игрок) ─────

  private onPointerDown(pointer: Phaser.Input.Pointer) {
    if (this.engine.state.outcome) return;
    const store = useBattleStore.getState();
    const code = store.selectedCard;
    if (!code) return;

    const card = CARDS[code];
    // Сценный canvas выше арены на TOP_STAND_PX (трибуна сверху) — переводим
    // координаты тапа из канваса в мировые (0..ARENA_HEIGHT).
    const x = pointer.worldX;
    const y = pointer.worldY - TOP_STAND_PX;

    if (!this.isValidPlacement(code, x, y)) {
      store.pulseInsufficient();
      return;
    }
    if (!this.engine.spendEnergy('player', card.energyCost)) {
      store.pulseInsufficient();
      return;
    }
    store.cycleCard(code);

    if (card.kind === 'spell') {
      this.engine.castSpell({ team: 'player', code: code as SpellCode, x, y });
      return;
    }
    const lane: Lane = x < ARENA_WIDTH / 2 ? 'left' : 'right';
    this.engine.spawnUnit({ team: 'player', type: code as UnitType, lane });
  }

  private isValidPlacement(code: CardCode, x: number, y: number): boolean {
    if (x < 0 || x > ARENA_WIDTH || y < 0 || y > ARENA_HEIGHT) return false;
    const card = CARDS[code];
    if (card.kind === 'spell') return true;
    if (y < PLAYER_FIRST_ROW * TILE) return false;
    for (const t of this.engine.state.towers) {
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
      for (const t of this.engine.state.towers) {
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

  // ───── AI-бот ─────

  private scheduleBotTick() {
    if (this.engine.state.outcome) return;
    const delay = 3000 + Math.random() * 2000;
    this.time.delayedCall(delay, () => {
      if (this.engine.state.outcome) return;
      this.botTick();
      this.scheduleBotTick();
    });
  }

  private botTick() {
    const energy = this.engine.state.energy.enemy;
    const hand = this.botDeck.slice(0, HAND_SIZE);
    const affordable = hand.filter((c) => CARDS[c].energyCost <= energy);
    if (!affordable.length) return;
    if (energy < 4 && Math.random() < 0.4) return;

    const code = affordable[Math.floor(Math.random() * affordable.length)];
    const card = CARDS[code];

    if (card.kind === 'spell') {
      const target =
        code === 'heal' ? this.pickHealCenter('enemy') : this.pickHostileCenter('player');
      if (!target) return;
      if (!this.engine.spendEnergy('enemy', card.energyCost)) return;
      this.engine.castSpell({ team: 'enemy', code: code as SpellCode, x: target.x, y: target.y });
      this.cycleBotCard(code);
      return;
    }

    const lane = this.pickBotLane();
    if (!this.engine.spendEnergy('enemy', card.energyCost)) return;
    this.engine.spawnUnit({ team: 'enemy', type: code as UnitType, lane });
    this.cycleBotCard(code);
  }

  private cycleBotCard(code: CardCode) {
    const i = this.botDeck.indexOf(code);
    if (i < 0) return;
    this.botDeck.splice(i, 1);
    this.botDeck.push(code);
  }

  private pickBotLane(): Lane {
    const left = this.engine.state.units.filter(
      (u) => u.team === 'player' && !u.isDead && u.lane === 'left',
    ).length;
    const right = this.engine.state.units.filter(
      (u) => u.team === 'player' && !u.isDead && u.lane === 'right',
    ).length;
    if (left === right) return Math.random() < 0.5 ? 'left' : 'right';
    return left > right ? 'left' : 'right';
  }

  private pickHostileCenter(team: Side): { x: number; y: number } | null {
    const targets = this.engine.state.units.filter((u) => u.team === team && !u.isDead);
    if (targets.length === 0) return null;
    const seed = targets[Math.floor(Math.random() * targets.length)];
    const nearby = targets.filter((u) => Math.hypot(u.x - seed.x, u.y - seed.y) < 70);
    if (nearby.length < 2) return null;
    const cx = nearby.reduce((s, u) => s + u.x, 0) / nearby.length;
    const cy = nearby.reduce((s, u) => s + u.y, 0) / nearby.length;
    return { x: cx, y: cy };
  }

  private pickHealCenter(team: Side): { x: number; y: number } | null {
    const wounded = this.engine.state.units.filter(
      (u) => u.team === team && !u.isDead && u.hpRatio < 0.6,
    );
    if (wounded.length < 2) return null;
    const cx = wounded.reduce((s, u) => s + u.x, 0) / wounded.length;
    const cy = wounded.reduce((s, u) => s + u.y, 0) / wounded.length;
    return { x: cx, y: cy };
  }

  // ───── финал матча ─────

  private finalizeMatch(outcome: 'won' | 'lost' | 'draw') {
    const td = this.engine.state.towersDestroyed;
    const elapsedMs = this.time.now - this.matchStartedAt;
    const durationSec = Math.max(0, Math.floor(elapsedMs / 1000));

    const baseCoins = outcome === 'won' ? 50 : outcome === 'draw' ? 15 : 5;
    const baseXp = outcome === 'won' ? 25 : outcome === 'draw' ? 10 : 5;

    const matchResult: MatchResult = {
      outcome,
      durationSec,
      towersDestroyed: td.enemy,
      towersLost: td.player,
      coinsEarned: baseCoins + td.enemy * 10,
      xpEarned: baseXp + td.enemy * 5,
    };

    const store = useBattleStore.getState();
    store.setResult(matchResult);
    store.setGameState(outcome);

    this.playerEnergyTimer?.remove();
    this.botEnergyTimer?.remove();
  }

  // ───── визуал: статика арены ─────

  private wG(): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    this.world.add(g);
    return g;
  }

  private wT(
    x: number,
    y: number,
    text: string,
    style: Phaser.Types.GameObjects.Text.TextStyle,
  ): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, text, style);
    this.world.add(t);
    return t;
  }

  private drawZones() {
    const g = this.wG();
    g.fillStyle(ARENA_COLORS.enemyZone, 1);
    g.fillRect(0, 0, ARENA_WIDTH, RIVER_TOP_ROW * TILE);
    g.fillStyle(ARENA_COLORS.playerZone, 1);
    g.fillRect(
      0,
      (RIVER_BOTTOM_ROW + 1) * TILE,
      ARENA_WIDTH,
      ARENA_HEIGHT - (RIVER_BOTTOM_ROW + 1) * TILE,
    );

    // Текстура травы — мелкие тёмные «кустики» для разнообразия.
    const tufts = this.wG();
    tufts.fillStyle(0x000000, 0.1);
    const rng = mulberry32(42);
    for (let i = 0; i < 70; i++) {
      const x = rng() * ARENA_WIDTH;
      const y = rng() * ARENA_HEIGHT;
      // не на реке
      if (y > RIVER_TOP_ROW * TILE - 4 && y < (RIVER_BOTTOM_ROW + 1) * TILE + 4) continue;
      tufts.fillRect(x, y, 2, 2);
    }
    // Несколько светлых пятен — будто пробивающийся свет.
    tufts.fillStyle(0xffffff, 0.05);
    for (let i = 0; i < 40; i++) {
      const x = rng() * ARENA_WIDTH;
      const y = rng() * ARENA_HEIGHT;
      if (y > RIVER_TOP_ROW * TILE - 4 && y < (RIVER_BOTTOM_ROW + 1) * TILE + 4) continue;
      tufts.fillCircle(x, y, 1.5);
    }
  }

  private drawLanes() {
    const g = this.wG();
    g.fillStyle(ARENA_COLORS.lane, 1);
    g.lineStyle(1, ARENA_COLORS.laneStroke, 0.8);
    for (const path of LANE_PATHS) {
      const r = rectToPx(path);
      g.fillRect(r.x, r.y, r.w, r.h);
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }
    // Тёмные «камешки» вдоль дорожек — каменная мостовая.
    const stones = this.wG();
    stones.fillStyle(0x000000, 0.18);
    const rng = mulberry32(7);
    for (const path of LANE_PATHS) {
      const r = rectToPx(path);
      for (let y = r.y + 4; y < r.y + r.h - 4; y += 6) {
        for (let i = 0; i < 2; i++) {
          if (rng() < 0.45) continue;
          const sx = r.x + 4 + rng() * (r.w - 8);
          stones.fillCircle(sx, y, 1.4);
        }
      }
    }
  }

  private drawRiver() {
    const g = this.wG();
    g.fillStyle(ARENA_COLORS.river, 1);
    g.fillRect(0, RIVER_TOP_ROW * TILE, ARENA_WIDTH, 2 * TILE);
    g.fillStyle(ARENA_COLORS.riverEdge, 1);
    g.fillRect(0, RIVER_TOP_ROW * TILE, ARENA_WIDTH, 2);
    g.fillRect(0, (RIVER_BOTTOM_ROW + 1) * TILE - 2, ARENA_WIDTH, 2);

    // Слой бегущих волн — анимируется в startWaterAnimation.
    this.waterWaves = this.wG();
  }

  private startWaterAnimation() {
    let offset = 0;
    this.time.addEvent({
      delay: 90,
      loop: true,
      callback: () => {
        const w = this.waterWaves;
        if (!w) return;
        offset = (offset + 4) % 60;
        w.clear();
        w.lineStyle(1.5, 0xffffff, 0.18);
        const top = RIVER_TOP_ROW * TILE + 6;
        const bottom = (RIVER_BOTTOM_ROW + 1) * TILE - 6;
        for (let y = top; y < bottom; y += 8) {
          for (let x = -60 + offset; x < ARENA_WIDTH + 60; x += 60) {
            w.lineBetween(x, y, x + 24, y);
          }
        }
      },
    });
  }

  private drawBridges() {
    const g = this.wG();
    g.fillStyle(ARENA_COLORS.bridge, 1);
    g.lineStyle(2, ARENA_COLORS.bridgeStroke, 1);
    for (const b of BRIDGES) {
      const r = rectToPx(b);
      g.fillRect(r.x, r.y, r.w, r.h);
      g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
    // Доски на мостах — горизонтальные линии.
    const planks = this.wG();
    planks.lineStyle(1, 0x6b5a3a, 0.55);
    for (const b of BRIDGES) {
      const r = rectToPx(b);
      const stepCount = 5;
      for (let i = 1; i < stepCount; i++) {
        const ly = r.y + (r.h * i) / stepCount;
        planks.lineBetween(r.x + 2, ly, r.x + r.w - 2, ly);
      }
    }
  }

  private drawGrid() {
    const g = this.wG();
    g.lineStyle(1, ARENA_COLORS.grid, 0.06);
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
      fontSize: '10px',
      color: '#ffffff',
      fontStyle: 'bold',
    };
    this.wT(ARENA_WIDTH / 2, (PLAYER_FIRST_ROW - 0.4) * TILE, 'ИГРОК', labelStyle)
      .setOrigin(0.5, 0)
      .setAlpha(0.5);
    this.wT(ARENA_WIDTH / 2, (RIVER_TOP_ROW - 0.6) * TILE, 'ВРАГ', labelStyle)
      .setOrigin(0.5, 1)
      .setAlpha(0.5);
  }

  /** Декор по краям арены — кустики, камни. Только в свободных колонках. */
  private drawEdgeDecor() {
    const g = this.wG();
    const rng = mulberry32(2026);

    // Кустики и камни по левой/правой кромке (вне линий и башен).
    const drawCluster = (x: number, y: number) => {
      const tone = rng() < 0.5 ? 0x3d6a23 : 0x4f3c20;
      g.fillStyle(tone, 0.85);
      g.fillCircle(x, y, 2 + rng() * 1.2);
      g.fillStyle(0x000000, 0.18);
      g.fillCircle(x + 1, y + 1.5, 1.4);
    };

    // Пары полос: над верхней принцессой и под нижней.
    const rows = [1, ROWS - 2];
    for (const row of rows) {
      const yMid = row * TILE + TILE / 2;
      for (let i = 0; i < 6; i++) {
        const x = 4 + rng() * 24;
        drawCluster(x, yMid + (rng() - 0.5) * 6);
        const x2 = ARENA_WIDTH - 4 - rng() * 24;
        drawCluster(x2, yMid + (rng() - 0.5) * 6);
      }
    }

    // Маленькие флажки на углах вражеской и игрокой принцесс.
    const flagPoints = [
      { x: 14, y: 88 }, // enemy left
      { x: ARENA_WIDTH - 14, y: 88 }, // enemy right
      { x: 14, y: ARENA_HEIGHT - 88 }, // player left
      { x: ARENA_WIDTH - 14, y: ARENA_HEIGHT - 88 }, // player right
    ];
    for (const f of flagPoints) {
      const isEnemy = f.y < ARENA_HEIGHT / 2;
      g.fillStyle(0x6b5a3a, 1);
      g.fillRect(f.x, f.y - 8, 1, 8);
      g.fillStyle(isEnemy ? 0xc1334a : 0x2a5d8a, 1);
      g.fillTriangle(f.x + 1, f.y - 8, f.x + 7, f.y - 6, f.x + 1, f.y - 4);
    }
  }

  // ───── трибуны (вне world-контейнера) ─────

  private drawTopStand() {
    const g = this.add.graphics();
    // Древесный фон трибуны
    g.fillStyle(0x4a2b3d, 1);
    g.fillRect(0, 0, ARENA_WIDTH, TOP_STAND_PX);
    // Слои-полки лавок
    g.fillStyle(0x3a1f2e, 1);
    g.fillRect(0, TOP_STAND_PX - 8, ARENA_WIDTH, 8);
    // Тонкая нижняя кромка
    g.fillStyle(0x000000, 0.4);
    g.fillRect(0, TOP_STAND_PX - 2, ARENA_WIDTH, 2);

    // Толпа: два ряда «голов».
    const rng = mulberry32(101);
    for (let row = 0; row < 2; row++) {
      const ly = 16 + row * 18;
      for (let i = 0; i < 22; i++) {
        const x = 6 + i * 16;
        const tone =
          rng() < 0.18 ? 0xffd267 : rng() < 0.5 ? 0xe0a0a0 : rng() < 0.7 ? 0xb0a0c0 : 0x9b6b4a;
        g.fillStyle(tone, 0.9);
        g.fillCircle(x + (row % 2 === 0 ? 0 : 8), ly, 2.2);
      }
    }

    // Центральный баннер врага.
    g.fillStyle(0xc1334a, 1);
    g.fillRect(ARENA_WIDTH / 2 - 16, 4, 32, 22);
    g.fillStyle(0xffd267, 1);
    g.fillCircle(ARENA_WIDTH / 2, 15, 5);
  }

  private drawBottomStand() {
    const g = this.add.graphics();
    const top = TOP_STAND_PX + ARENA_HEIGHT;
    g.fillStyle(0x1d2c4a, 1);
    g.fillRect(0, top, ARENA_WIDTH, BOTTOM_STAND_PX);
    g.fillStyle(0x141f37, 1);
    g.fillRect(0, top, ARENA_WIDTH, 6);
    g.fillStyle(0x000000, 0.4);
    g.fillRect(0, top, ARENA_WIDTH, 2);

    const rng = mulberry32(202);
    for (let row = 0; row < 2; row++) {
      const ly = top + 14 + row * 16;
      for (let i = 0; i < 22; i++) {
        const x = 6 + i * 16;
        const tone =
          rng() < 0.18 ? 0xffd267 : rng() < 0.5 ? 0xa0c0e0 : rng() < 0.7 ? 0xb0a0c0 : 0x9b6b4a;
        g.fillStyle(tone, 0.9);
        g.fillCircle(x + (row % 2 === 0 ? 0 : 8), ly, 2.2);
      }
    }

    g.fillStyle(0x2a5d8a, 1);
    g.fillRect(ARENA_WIDTH / 2 - 16, top + BOTTOM_STAND_PX - 24, 32, 20);
    g.fillStyle(0xffd267, 1);
    g.fillCircle(ARENA_WIDTH / 2, top + BOTTOM_STAND_PX - 14, 5);
  }

  // ───── визуал: башни ─────

  private attachTowerView(tower: Tower) {
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

    const rangeCircle = this.wG();
    rangeCircle.lineStyle(1, isPlayer ? ARENA_COLORS.playerTower : ARENA_COLORS.enemyTower, 0.1);
    rangeCircle.strokeCircle(tower.x, tower.y, tower.range);

    const shadow = this.wG();
    shadow.fillStyle(0x000000, 0.28);
    shadow.fillEllipse(tower.x, r.y + r.h - 4, r.w * 0.62, 7);

    const pad = isKing ? 20 : 14;
    const body = this.wG();
    body.fillStyle(fill, 1);
    body.lineStyle(2, stroke, 1);
    body.fillRoundedRect(r.x + pad, r.y + pad, r.w - pad * 2, r.h - pad * 2, 5);
    body.strokeRoundedRect(r.x + pad, r.y + pad, r.w - pad * 2, r.h - pad * 2, 5);

    // Маленький флажок на крыше башни.
    const flag = this.wG();
    const flagColor = isPlayer ? 0x6ec0ff : 0xff8a99;
    flag.fillStyle(0x6b5a3a, 1);
    flag.fillRect(tower.x - 0.5, r.y + pad - 8, 1, 8);
    flag.fillStyle(flagColor, 1);
    flag.fillTriangle(
      tower.x,
      r.y + pad - 8,
      tower.x + 6,
      r.y + pad - 6,
      tower.x,
      r.y + pad - 4,
    );

    if (isKing) {
      const crown = this.wG();
      crown.fillStyle(0xf2c14e, 1);
      crown.fillCircle(tower.x, tower.y - 1, 5);
    }

    const hpBar = this.wG();
    const hpText = this.wT(tower.x, r.y + pad - 12, '', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '9px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5, 1);

    this.towerViews.set(tower.id, { body, hpBar, hpText, rangeCircle });
    this.updateTowerHud(tower);
  }

  private updateTowerHud(tower: Tower) {
    const view = this.towerViews.get(tower.id);
    if (!view) return;
    const r = rectToPx(tower.rect);
    const isPlayer = tower.team === 'player';
    const isKing = tower.type === 'king';
    const pad = isKing ? 20 : 14;
    const barW = r.w - pad * 2;
    const barH = 3;
    const barX = r.x + pad;
    const barY = r.y + pad - 7;
    const fill = isPlayer ? ARENA_COLORS.playerTower : ARENA_COLORS.enemyTower;

    const bar = view.hpBar;
    bar.clear();
    bar.fillStyle(0x000000, 0.45);
    bar.fillRoundedRect(barX, barY, barW, barH, 1.5);
    bar.fillStyle(fill, 1);
    bar.fillRoundedRect(barX, barY, Math.max(0, barW * tower.hpRatio), barH, 1.5);

    view.hpText.setText(`${tower.hp}`);
  }

  private flashTowerDamage(tower: Tower) {
    const view = this.towerViews.get(tower.id);
    if (!view || tower.isDestroyed) return;
    this.tweens.killTweensOf(view.body);
    view.body.alpha = 0.5;
    this.tweens.add({ targets: view.body, alpha: 1, duration: 130 });
  }

  private handleTowerDestroyed(tower: Tower) {
    const view = this.towerViews.get(tower.id);
    this.cameras.main.shake(320, 0.006);
    if (!view) return;
    const r = rectToPx(tower.rect);
    const flash = this.wG();
    flash.fillStyle(0xfff58c, 0.8);
    flash.fillRoundedRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8, 6);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 500,
      onComplete: () => flash.destroy(),
    });
    this.tweens.add({ targets: view.body, alpha: 0.3, duration: 350 });
    view.rangeCircle.setAlpha(0);
    view.hpText.setText('×');
  }

  // ───── визуал: юниты ─────

  private attachUnitView(unit: Unit) {
    const isPlayer = unit.team === 'player';
    const fill = isPlayer ? ARENA_COLORS.playerTower : ARENA_COLORS.enemyTower;
    const stroke = isPlayer ? ARENA_COLORS.playerTowerEdge : ARENA_COLORS.enemyTowerEdge;

    const body = this.wG();
    body.fillStyle(fill, 1);
    body.lineStyle(2, stroke, 1);
    body.fillCircle(0, 0, unit.radius);
    body.strokeCircle(0, 0, unit.radius);
    body.x = unit.x;
    body.y = unit.y;

    const label = this.wT(unit.x, unit.y, typeGlyph(unit.type), {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '11px',
      color: '#ffffff',
    }).setOrigin(0.5);

    const hpBar = this.wG();

    this.unitViews.set(unit.id, { body, hpBar, label });
    this.updateUnitView(unit);

    // Spawn-in animation.
    body.setScale(0.3);
    body.alpha = 0.5;
    label.setScale(0.3);
    label.alpha = 0;
    this.tweens.add({
      targets: [body, label],
      scale: 1,
      alpha: 1,
      duration: 230,
      ease: 'Back.Out',
    });
  }

  private updateUnitView(unit: Unit) {
    const view = this.unitViews.get(unit.id);
    if (!view) return;
    view.body.x = unit.x;
    view.body.y = unit.y;
    view.label.x = unit.x;
    view.label.y = unit.y;

    const barW = unit.radius * 2;
    const barH = 2;
    const barX = unit.x - unit.radius;
    const barY = unit.y - unit.radius - 5;
    const fill = unit.team === 'player' ? ARENA_COLORS.playerTower : ARENA_COLORS.enemyTower;

    const bar = view.hpBar;
    bar.clear();
    bar.fillStyle(0x000000, 0.5);
    bar.fillRect(barX, barY, barW, barH);
    bar.fillStyle(fill, 1);
    bar.fillRect(barX, barY, Math.max(0, barW * unit.hpRatio), barH);
  }

  private flashUnitDamage(unit: Unit) {
    const view = this.unitViews.get(unit.id);
    if (!view || unit.isDead) return;
    this.tweens.killTweensOf(view.body);
    view.body.alpha = 0.4;
    this.tweens.add({ targets: view.body, alpha: 1, duration: 130 });
  }

  private handleUnitDeath(unit: Unit) {
    const color = unit.team === 'player' ? 0x2a5d8a : 0xc1334a;
    this.deathPoof(unit.x, unit.y, color);
    const view = this.unitViews.get(unit.id);
    if (!view) return;
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

  private deathPoof(x: number, y: number, color: number) {
    const g = this.wG();
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

  private flashAttackLine(from: { x: number; y: number }, to: { x: number; y: number }) {
    const line = this.wG();
    line.lineStyle(2, 0xffffff, 0.8);
    line.lineBetween(from.x, from.y, to.x, to.y);
    this.tweens.add({
      targets: line,
      alpha: 0,
      duration: 220,
      onComplete: () => line.destroy(),
    });
  }

  // ───── визуал: спеллы ─────

  private renderSpellEffect(code: SpellCode, x: number, y: number) {
    const stats = SPELL_STATS[code];

    const fillGfx = this.wG();
    fillGfx.fillStyle(stats.color, 0.45);
    fillGfx.fillCircle(x, y, stats.radius);
    this.tweens.add({
      targets: fillGfx,
      alpha: 0,
      duration: 600,
      onComplete: () => fillGfx.destroy(),
    });

    const ringState = { r: 0 };
    const ring = this.wG();
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

    if (stats.hostile) this.cameras.main.shake(180, 0.003);
  }
}

// ───── helpers ─────

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
      // SCENE_HEIGHT включает в себя верхнюю и нижнюю «трибуны» — арт,
      // который не часть игрового мира, но визуально расширяет сцену.
      height: SCENE_HEIGHT,
    },
    scene: [ArenaScene],
  });
}

/** Мини-PRNG: детерминированные «случайные» числа для повторяемости декора. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export type { UnitType } from './unit';
export type { CardCode } from '@/store/battleStore';

export function getArenaScene(game: Phaser.Game | null): ArenaScene | null {
  if (!game) return null;
  const scene = game.scene.getScene('Arena');
  return (scene as ArenaScene) ?? null;
}

export { UNIT_STATS };
