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
  LANES,
  PLAYER_FIRST_ROW,
  RIVER_BOTTOM_ROW,
  RIVER_TOP_ROW,
  ROWS,
  SCENE_HEIGHT,
  TILE,
  TOP_STAND_PX,
  TOWER_LAYOUTS,
  rectToPx,
  type Lane,
  type Side,
} from './arena';
import { TILE_GRID, isPlaceableForPlayer } from './tiles';
import { Tower } from './tower';
import { Unit, UNIT_STATS, type UnitType } from './unit';
import { SPELL_STATS, type SpellCode } from './spells';
import { ThreeBattleLayer } from './ThreeBattleLayer';
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
import { playSound } from '@/audio/soundEngine';

interface TowerView {
  body: Phaser.GameObjects.Graphics;
  /** Турель — поворачивается к цели. */
  turret: Phaser.GameObjects.Graphics;
  hpBar: Phaser.GameObjects.Graphics;
  hpText: Phaser.GameObjects.Text;
  rangeCircle: Phaser.GameObjects.Graphics;
}

interface UnitView {
  /** Невидимый Phaser-объект для совместимости с текущими tween-хуками. */
  shadow: Phaser.GameObjects.Graphics;
  body: Phaser.GameObjects.Graphics;
  hpBar: Phaser.GameObjects.Graphics;
  hpText: Phaser.GameObjects.Text;
  lastHp: number;
}

/** Высота «корпуса» над землёй — псевдо-3D. */
const UNIT_LIFT = 5;
const RENDER_DPR = Math.min(
  3,
  Math.max(1, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1),
);

export class ArenaScene extends Phaser.Scene {
  private engine!: BattleEngine;

  /** Контейнер всех «мировых» объектов — смещён на TOP_STAND_PX вниз,
   *  чтобы трибуны помещались сверху и снизу за пределами игрового мира. */
  private world!: Phaser.GameObjects.Container;
  private waterWaves?: Phaser.GameObjects.Graphics;
  private threeLayer?: ThreeBattleLayer;

  private towerViews = new Map<string, TowerView>();
  private unitViews = new Map<string, UnitView>();
  private projectileViews = new Map<string, Phaser.GameObjects.Graphics>();

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
    this.projectileViews.clear();

    this.cameras.main.setBackgroundColor('#0b0d12');

    // Сначала декор — трибуны живут вне world-контейнера.
    this.drawTopStand();
    this.drawBottomStand();

    // Все объекты арены ездят внутри world-контейнера, сдвинутого на
    // TOP_STAND_PX вниз. Логические координаты остаются в 0..720.
    this.world = this.add.container(0, TOP_STAND_PX);
    const parent = this.game.canvas.parentElement;
    if (parent) this.threeLayer = new ThreeBattleLayer(parent, this.game.canvas);

    this.drawZones();
    this.drawArenaHighlights();
    this.drawLanes();
    this.drawEdgeDecor();
    this.drawRiver();
    this.drawBridges();
    this.drawGrid();
    this.drawSideLabels();
    this.startWaterAnimation();

    for (const t of this.engine.state.towers) this.attachTowerView(t);
    this.threeLayer?.sync(this.engine.state.units, this.engine.state.towers);

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

    // Регэн энергии — плавный, рассчитывается каждый кадр в update().
    // Старые таймеры оставлены ради совместимости полей класса (см. shutdown).

    // Запуск AI бота.
    this.scheduleBotTick();

    // Фанфары начала матча (с маленькой задержкой, чтобы дать AudioContext
    // проснуться после user-gesture в меню).
    this.time.delayedCall(140, () => playSound('matchStart'));

    this.events.once('shutdown', () => {
      this.zoneUnsub?.();
      this.engineUnsub?.();
      this.threeLayer?.dispose();
      this.threeLayer = undefined;
    });
  }

  override update(_time: number, deltaMs: number) {
    if (this.engine.state.outcome) return;
    // Плавный регэн: 1 эликсир каждые ENERGY_REGEN_INTERVAL_MS, дробно за кадр.
    const regenPerSec = 1000 / ENERGY_REGEN_INTERVAL_MS; // эликсиров в секунду
    const dEnergy = (regenPerSec * deltaMs) / 1000;
    this.engine.addEnergy('player', dEnergy);
    this.engine.addEnergy('enemy', dEnergy);

    this.engine.tick(deltaMs);
    // Синхронизируем визуал юнитов с актуальным состоянием.
    for (const u of this.engine.state.units) {
      if (u.isDead) continue;
      this.updateUnitView(u);
    }
    // Снаряды — двигаем графику в точку из state, разворачиваем по направлению.
    for (const p of this.engine.state.projectiles) {
      const g = this.projectileViews.get(p.id);
      if (!g) continue;
      const px = (g.getData('px') as number | undefined) ?? p.x;
      const py = (g.getData('py') as number | undefined) ?? p.y;
      const dx = p.x - px;
      const dy = p.y - py;
      if (dx * dx + dy * dy > 0.4) g.rotation = Math.atan2(dy, dx);
      g.x = p.x;
      g.y = p.y;
      g.setData('px', p.x);
      g.setData('py', p.y);
    }
    // Поворот турелей башен к цели.
    for (const tower of this.engine.state.towers) {
      if (tower.isDestroyed) continue;
      const view = this.towerViews.get(tower.id);
      if (!view) continue;
      const target = this.engine.getTowerTarget(tower);
      if (target) {
        view.turret.rotation = Math.atan2(target.y - tower.y, target.x - tower.x);
      }
    }
    this.threeLayer?.sync(this.engine.state.units, this.engine.state.towers);
  }

  // ───── обработка событий движка ─────

  private handleEngineEvent(e: import('@/battle/types').BattleEvent) {
    const store = useBattleStore.getState();
    switch (e.kind) {
      case 'unitSpawned':
        this.attachUnitView(e.unit);
        playSound('unitSpawn');
        break;
      case 'unitDamaged':
        this.flashUnitDamage(e.unit, e.amount);
        this.updateUnitView(e.unit);
        break;
      case 'unitHealed':
        this.updateUnitView(e.unit);
        break;
      case 'unitDied':
        this.handleUnitDeath(e.unit);
        playSound('unitDeath');
        break;
      case 'attack':
        this.renderAttackEffect(e);
        if (e.ranged) {
          playSound(e.attacker.type === 'mage' ? 'magicShoot' : 'rangedShoot');
        } else {
          playSound('meleeHit');
        }
        break;
      case 'towerAttack':
        // Анимация лучницы на принцессе + звук тетивы.
        if (e.tower.type === 'princess') {
          this.threeLayer?.towerAttackAnim(e.tower.id);
          playSound('rangedShoot');
        }
        break;
      case 'towerDamaged':
        this.flashTowerDamage(e.tower);
        this.updateTowerHud(e.tower);
        playSound('towerHit');
        break;
      case 'towerDestroyed':
        this.handleTowerDestroyed(e.tower);
        store.setTowersDestroyed('player', this.engine.state.towersDestroyed.player);
        store.setTowersDestroyed('enemy', this.engine.state.towersDestroyed.enemy);
        playSound('towerDestroy');
        break;
      case 'spellCast':
        this.renderSpellEffect(e.code, e.x, e.y, e.sourceX, e.sourceY);
        playSound(e.code === 'fireball' ? 'fireballCast' : 'healCast');
        break;
      case 'projectileSpawned':
        this.attachProjectileView(e.projectile);
        break;
      case 'projectileHit':
        this.handleProjectileHit(e.projectile);
        playSound('projectileHit');
        break;
      case 'energyChanged':
        if (e.team === 'player') store.setEnergy(e.value);
        break;
      case 'timeTick':
        store.setMatchTimeLeft(e.timeLeftMs);
        break;
      case 'gameOver':
        this.finalizeMatch(e.outcome);
        playSound(
          e.outcome === 'won'
            ? 'matchVictory'
            : e.outcome === 'lost'
              ? 'matchDefeat'
              : 'matchDraw',
        );
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
      playSound('insufficient');
      return;
    }
    if (!this.engine.spendEnergy('player', card.energyCost)) {
      store.pulseInsufficient();
      playSound('insufficient');
      return;
    }
    store.cycleCard(code);
    playSound('cardPlace');

    if (card.kind === 'spell') {
      this.engine.castSpell({ team: 'player', code: code as SpellCode, x, y });
      return;
    }
    const lane: Lane = x < ARENA_WIDTH / 2 ? 'left' : 'right';
    const col = Math.floor(x / TILE);
    const row = Math.floor(y / TILE);
    this.engine.spawnUnit({
      team: 'player',
      type: code as UnitType,
      lane,
      cell: { col, row },
    });
  }

  private isValidPlacement(code: CardCode, x: number, y: number): boolean {
    if (x < 0 || x > ARENA_WIDTH || y < 0 || y > ARENA_HEIGHT) return false;
    const card = CARDS[code];
    if (card.kind === 'spell') return true;
    // Юнит — проверяем тип клетки (вода/мост/башня запрещены).
    const col = Math.floor(x / TILE);
    const row = Math.floor(y / TILE);
    return isPlaceableForPlayer(col, row);
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
      // td.player = сколько вражеских башен снёс игрок.
      // td.enemy  = сколько своих башен потерял.
      towersDestroyed: td.player,
      towersLost: td.enemy,
      coinsEarned: baseCoins + td.player * 10,
      xpEarned: baseXp + td.player * 5,
    };

    const store = useBattleStore.getState();
    store.setResult(matchResult);
    store.setGameState(outcome);

    this.playerEnergyTimer?.remove();
    this.botEnergyTimer?.remove();
    this.playerEnergyTimer = undefined;
    this.botEnergyTimer = undefined;
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
    t.setResolution(RENDER_DPR);
    this.world.add(t);
    return t;
  }

  private drawZones() {
    // Рендерим клетки tile-by-tile по типу из TILE_GRID.
    const g = this.wG();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = TILE_GRID[r][c];
        const fill = colorForTile(t, r);
        if (fill === null) continue; // мост/река отрисовываются отдельно
        g.fillStyle(fill, 1);
        g.fillRect(c * TILE, r * TILE, TILE, TILE);
      }
    }
    // Текстура травы — мелкие тёмные «кустики» для разнообразия.
    const tufts = this.wG();
    tufts.fillStyle(0x000000, 0.1);
    const rng = mulberry32(42);
    for (let i = 0; i < 70; i++) {
      const x = rng() * ARENA_WIDTH;
      const y = rng() * ARENA_HEIGHT;
      if (y > RIVER_TOP_ROW * TILE - 4 && y < (RIVER_BOTTOM_ROW + 1) * TILE + 4) continue;
      tufts.fillRect(x, y, 2, 2);
    }
    tufts.fillStyle(0xffffff, 0.05);
    for (let i = 0; i < 40; i++) {
      const x = rng() * ARENA_WIDTH;
      const y = rng() * ARENA_HEIGHT;
      if (y > RIVER_TOP_ROW * TILE - 4 && y < (RIVER_BOTTOM_ROW + 1) * TILE + 4) continue;
      tufts.fillCircle(x, y, 1.5);
    }
  }

  private drawArenaHighlights() {
    const light = this.wG();

    // Мягкое цветовое разделение половин без новых текстур.
    light.fillStyle(0xff6a7d, 0.06);
    light.fillRoundedRect(8, 8, ARENA_WIDTH - 16, RIVER_TOP_ROW * TILE - 16, 18);
    light.fillStyle(0x65c8ff, 0.065);
    light.fillRoundedRect(
      8,
      PLAYER_FIRST_ROW * TILE + 8,
      ARENA_WIDTH - 16,
      ARENA_HEIGHT - PLAYER_FIRST_ROW * TILE - 16,
      18,
    );

    // Подиумы башен в 2D подчёркивают 3D-модели и делают сцену плотнее.
    for (const tower of TOWER_LAYOUTS) {
      const r = rectToPx(tower.rect);
      const cx = r.cx;
      const cy = r.cy;
      const isPlayer = tower.team === 'player';
      light.fillStyle(isPlayer ? 0x65c8ff : 0xff6a7d, tower.type === 'king' ? 0.12 : 0.09);
      light.fillEllipse(cx, cy + (tower.type === 'king' ? 18 : 12), r.w * 0.72, r.h * 0.38);
      light.lineStyle(1, isPlayer ? 0x9ddcff : 0xffa0ad, 0.18);
      light.strokeEllipse(cx, cy + (tower.type === 'king' ? 18 : 12), r.w * 0.76, r.h * 0.42);
    }
  }

  /**
   * Дороги — простые вертикали по обеим линиям (lane col=1 / col=7).
   * Принцессы теперь стоят на той же оси, поэтому достаточно прямой дороги
   * через всю арену — никаких изгибов, ничего не пропадает за 3D-моделью.
   */
  private drawLanes() {
    const road = this.wG();
    road.fillStyle(ARENA_COLORS.lane, 1);
    road.lineStyle(1, ARENA_COLORS.laneStroke, 0.65);

    const laneW = TILE - 10;
    const bridgeTopY = RIVER_TOP_ROW * TILE; // 320
    const bridgeBotY = (RIVER_BOTTOM_ROW + 1) * TILE; // 400
    const arenaH = ARENA_HEIGHT;

    for (const lane of ['left', 'right'] as const) {
      const laneRectX = LANES[lane].col * TILE + 5;
      // Верхняя половина — от края арены до моста.
      road.fillRoundedRect(laneRectX, 0, laneW, bridgeTopY, 9);
      road.strokeRoundedRect(laneRectX, 0, laneW, bridgeTopY, 9);
      // Нижняя половина — от моста до края арены.
      road.fillRoundedRect(laneRectX, bridgeBotY, laneW, arenaH - bridgeBotY, 9);
      road.strokeRoundedRect(laneRectX, bridgeBotY, laneW, arenaH - bridgeBotY, 9);
    }

    // Декор: камешки на дороге.
    const stones = this.wG();
    stones.fillStyle(0x000000, 0.18);
    const rng = mulberry32(7);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (TILE_GRID[r][c] !== 'road') continue;
        for (let i = 0; i < 2; i++) {
          if (rng() < 0.45) continue;
          const sx = c * TILE + 4 + rng() * (TILE - 8);
          const sy = r * TILE + 4 + rng() * (TILE - 8);
          stones.fillCircle(sx, sy, 1.4);
        }
      }
    }
  }

  private drawRiver() {
    const g = this.wG();
    const top = RIVER_TOP_ROW * TILE;
    const height = 2 * TILE;

    // Глубокая вода (база).
    g.fillStyle(0x1d4f6e, 1);
    g.fillRect(0, top, ARENA_WIDTH, height);

    // Градиент глубины — несколько горизонтальных полос светлеющего цвета
    // от центра к краям, чтобы река выглядела «глубокой посередине».
    const bands = [
      { y: top + 4, h: 4, color: 0x2a6d8f, alpha: 0.7 },
      { y: top + 10, h: 6, color: 0x3a8fb7, alpha: 0.75 },
      { y: top + 22, h: 28, color: 0x4ea4cf, alpha: 0.85 },
      { y: top + 54, h: 6, color: 0x3a8fb7, alpha: 0.7 },
      { y: top + 64, h: 6, color: 0x2a6d8f, alpha: 0.6 },
    ];
    for (const b of bands) {
      g.fillStyle(b.color, b.alpha);
      g.fillRect(0, b.y, ARENA_WIDTH, b.h);
    }

    // Берега — тёмная кромка.
    g.fillStyle(ARENA_COLORS.riverEdge, 1);
    g.fillRect(0, top, ARENA_WIDTH, 2);
    g.fillRect(0, (RIVER_BOTTOM_ROW + 1) * TILE - 2, ARENA_WIDTH, 2);
    // Тёмный осадок «у берега».
    g.fillStyle(0x183d56, 0.55);
    g.fillRect(0, top + 2, ARENA_WIDTH, 3);
    g.fillRect(0, (RIVER_BOTTOM_ROW + 1) * TILE - 5, ARENA_WIDTH, 3);

    // Слои бегущих волн — анимируются в startWaterAnimation.
    this.waterWaves = this.wG();
  }

  private startWaterAnimation() {
    // Несколько параллакс-слоёв волн + статичные блестящие искры с мерцанием.
    const top = RIVER_TOP_ROW * TILE + 4;
    const bottom = (RIVER_BOTTOM_ROW + 1) * TILE - 4;

    // Предварительно расставляем искры — позиция стабильна, меняется только альфа.
    const sparkRng = mulberry32(404);
    const sparks: { x: number; y: number; phase: number }[] = [];
    for (let i = 0; i < 22; i++) {
      sparks.push({
        x: sparkRng() * ARENA_WIDTH,
        y: top + sparkRng() * (bottom - top),
        phase: sparkRng() * Math.PI * 2,
      });
    }

    let phase = 0;
    this.time.addEvent({
      delay: 60,
      loop: true,
      callback: () => {
        const w = this.waterWaves;
        if (!w) return;
        phase += 1;
        w.clear();

        // Слой 1: длинные тёмные «впадины» (медленный).
        w.lineStyle(2, 0x163d56, 0.45);
        const offset1 = (phase * 1.6) % 80;
        for (let y = top + 6; y < bottom; y += 14) {
          for (let x = -80 + offset1; x < ARENA_WIDTH + 80; x += 80) {
            const wobble = Math.sin((x + phase * 0.6) * 0.06) * 1.2;
            w.lineBetween(x, y + wobble, x + 36, y - wobble);
          }
        }

        // Слой 2: средние белые блики (стандартная скорость).
        w.lineStyle(1.4, 0xeaf6ff, 0.35);
        const offset2 = (phase * 3.0) % 60;
        for (let y = top + 10; y < bottom; y += 9) {
          for (let x = -60 + offset2; x < ARENA_WIDTH + 60; x += 60) {
            const wobble = Math.sin((x + phase * 1.2) * 0.08 + y * 0.05) * 0.8;
            w.lineBetween(x, y + wobble, x + 22, y + wobble);
          }
        }

        // Слой 3: короткие верхние блики (быстрый).
        w.lineStyle(1, 0xffffff, 0.25);
        const offset3 = (phase * 4.5) % 40;
        for (let y = top + 4; y < bottom; y += 18) {
          for (let x = -40 + offset3; x < ARENA_WIDTH + 40; x += 40) {
            w.lineBetween(x, y, x + 9, y);
          }
        }

        // Статичные искры на воде с мерцанием — каждая со своей фазой.
        for (const s of sparks) {
          const a = 0.2 + 0.55 * Math.max(0, Math.sin(phase * 0.18 + s.phase));
          if (a < 0.32) continue;
          w.fillStyle(0xffffff, a);
          w.fillCircle(s.x, s.y, 0.8);
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
      g.fillStyle(0xffffff, 0.08);
      g.fillRect(r.x + 2, r.y + 2, r.w - 4, 4);
      g.fillStyle(0x000000, 0.14);
      g.fillRect(r.x + 2, r.y + r.h - 6, r.w - 4, 4);
      g.fillStyle(ARENA_COLORS.bridge, 1);
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

  /** Декор по краям арены отключён — сливался с башнями и создавал
   *  «другие» пятна травы около них. Поле теперь однородное. */
  private drawEdgeDecor() {
    /* no-op */
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
    const isPlayer = tower.team === 'player';

    const rangeCircle = this.wG();
    rangeCircle.lineStyle(1, isPlayer ? ARENA_COLORS.playerTower : ARENA_COLORS.enemyTower, 0.1);
    rangeCircle.strokeCircle(tower.x, tower.y, tower.range);

    const body = this.wG().setVisible(false);
    const turret = this.wG().setVisible(false);
    turret.x = tower.x;
    turret.y = tower.y;

    const hpBar = this.wG();
    // HP-текст и бар центрируем на tower.x (с lane-offset), а не на rect.
    // Поднимаем выше, чтобы 3D-модель не перекрывала.
    const hpY = r.y - 14;
    const hpText = this.wT(tower.x, hpY - 4, '', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '10px',
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5, 1);

    this.towerViews.set(tower.id, { body, turret, hpBar, hpText, rangeCircle });
    this.updateTowerHud(tower);
  }

  private updateTowerHud(tower: Tower) {
    const view = this.towerViews.get(tower.id);
    if (!view) return;
    const r = rectToPx(tower.rect);
    const isPlayer = tower.team === 'player';
    const isKing = tower.type === 'king';
    const barW = isKing ? 60 : 44;
    const barH = 4;
    const barX = tower.x - barW / 2; // строго по центру башни
    const barY = r.y - 12;
    const fill = isPlayer ? ARENA_COLORS.playerTower : ARENA_COLORS.enemyTower;

    const bar = view.hpBar;
    bar.clear();
    // Тёмная подложка.
    bar.fillStyle(0x000000, 0.55);
    bar.fillRoundedRect(barX - 1, barY - 1, barW + 2, barH + 2, 2);
    // Серый «трек».
    bar.fillStyle(0x303a4d, 1);
    bar.fillRoundedRect(barX, barY, barW, barH, 2);
    // Цветной заполненный прогресс.
    bar.fillStyle(fill, 1);
    bar.fillRoundedRect(barX, barY, Math.max(0, barW * tower.hpRatio), barH, 2);

    view.hpText.setText(`${tower.hp}`);
    view.hpText.setX(tower.x);
    view.hpText.setY(barY - 2);
  }

  private flashTowerDamage(tower: Tower) {
    const view = this.towerViews.get(tower.id);
    if (!view || tower.isDestroyed) return;
    this.threeLayer?.flashTower(tower.id);
    this.tweens.killTweensOf(view.body);
    view.body.alpha = 0.5;
    this.tweens.add({ targets: view.body, alpha: 1, duration: 130 });
  }

  private handleTowerDestroyed(tower: Tower) {
    const view = this.towerViews.get(tower.id);
    this.cameras.main.shake(320, 0.006);
    if (!view) return;
    view.turret.setAlpha(0);
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
    this.threeLayer?.destroyTower(tower.id);
  }

  // ───── визуал: юниты ─────

  private attachUnitView(unit: Unit) {
    const shadow = this.wG().setVisible(false);
    shadow.x = unit.x;
    shadow.y = unit.y;

    const body = this.wG().setVisible(false);
    body.x = unit.x;
    body.y = unit.y - UNIT_LIFT;

    const hpText = this.wT(unit.x, unit.y - UNIT_LIFT - unit.radius - 8, `${unit.hp}`, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '9px',
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#071018',
      strokeThickness: 2,
    }).setOrigin(0.5, 1);

    const hpBar = this.wG();

    this.unitViews.set(unit.id, { shadow, body, hpBar, hpText, lastHp: unit.hp });
    this.updateUnitView(unit);

    // Spawn-in animation.
    body.setScale(0.3);
    body.alpha = 0.5;
    hpText.setScale(0.85);
    hpText.alpha = 0;
    this.tweens.add({
      targets: [body, hpText],
      scale: 1,
      alpha: 1,
      duration: 230,
      ease: 'Back.Out',
    });
  }

  private updateUnitView(unit: Unit) {
    const view = this.unitViews.get(unit.id);
    if (!view) return;

    // Walk-bob: при движении корпус слегка покачивается по Y синусоидой.
    const bob =
      unit.state === 'moving'
        ? Math.sin(this.time.now / 110 + unit.x * 0.05) * 1.5
        : 0;

    view.shadow.x = unit.x;
    view.shadow.y = unit.y;
    view.body.x = unit.x;
    view.body.y = unit.y - UNIT_LIFT + bob;
    view.hpText.x = unit.x;
    view.hpText.y = unit.y - unit.radius - UNIT_LIFT - 8 + bob;
    if (view.lastHp !== unit.hp) {
      view.hpText.setText(`${unit.hp}`);
      view.lastHp = unit.hp;
    }

    const barW = unit.radius * 2;
    const barH = 2;
    const barX = unit.x - unit.radius;
    const barY = unit.y - unit.radius - UNIT_LIFT - 4 + bob;
    const fill = unit.team === 'player' ? ARENA_COLORS.playerTower : ARENA_COLORS.enemyTower;

    const bar = view.hpBar;
    bar.clear();
    bar.fillStyle(0x000000, 0.5);
    bar.fillRect(barX, barY, barW, barH);
    bar.fillStyle(fill, 1);
    bar.fillRect(barX, barY, Math.max(0, barW * unit.hpRatio), barH);
  }

  private flashUnitDamage(unit: Unit, amount: number) {
    const view = this.unitViews.get(unit.id);
    if (!view) return;
    this.threeLayer?.flashUnit(unit.id);
    this.tweens.killTweensOf(view.body);
    if (!unit.isDead) {
      view.body.alpha = 0.4;
      this.tweens.add({ targets: view.body, alpha: 1, duration: 130 });
    }
    this.floatDamageNumber(unit.x, unit.y - unit.radius - UNIT_LIFT - 10, amount);
  }

  private handleUnitDeath(unit: Unit) {
    const color = unit.team === 'player' ? 0x2a5d8a : 0xc1334a;
    this.deathPoof(unit.x, unit.y, color);
    this.threeLayer?.removeUnit(unit.id);
    const view = this.unitViews.get(unit.id);
    if (!view) return;
    this.tweens.add({
      targets: [view.shadow, view.body, view.hpBar, view.hpText],
      alpha: 0,
      duration: 250,
      onComplete: () => {
        view.shadow.destroy();
        view.body.destroy();
        view.hpBar.destroy();
        view.hpText.destroy();
        this.unitViews.delete(unit.id);
      },
    });
  }

  private floatDamageNumber(x: number, y: number, amount: number) {
    const txt = this.wT(x, y, `-${Math.round(amount)}`, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '12px',
      color: '#ffd267',
      fontStyle: 'bold',
      stroke: '#2a1208',
      strokeThickness: 2,
    }).setOrigin(0.5);
    this.tweens.add({
      targets: txt,
      y: y - 18,
      alpha: 0,
      duration: 650,
      ease: 'Quad.Out',
      onComplete: () => txt.destroy(),
    });
  }

  /**
   * Эффект смерти: «эликсир» проливается каплями вокруг и быстро исчезает.
   * Рисуем все примитивы в локальной системе координат (0,0) и позиционируем
   * через graphics.x/y, чтобы scale-tween не «отлетал» от точки смерти.
   */
  private deathPoof(x: number, y: number, color: number) {
    // Лужа эликсира на земле.
    const puddle = this.wG();
    puddle.fillStyle(color, 0.65);
    puddle.fillEllipse(0, 0, 22, 10);
    puddle.x = x;
    puddle.y = y + 2;
    this.tweens.add({
      targets: puddle,
      scaleX: 1.6,
      scaleY: 1.6,
      alpha: 0,
      duration: 700,
      ease: 'Quad.Out',
      onComplete: () => puddle.destroy(),
    });

    // Капли эликсира — короткие траектории во все стороны.
    const drops = 7;
    for (let i = 0; i < drops; i++) {
      const drop = this.wG();
      drop.fillStyle(color, 0.95);
      drop.fillCircle(0, 0, 2.4);
      drop.fillStyle(0xffffff, 0.6);
      drop.fillCircle(-0.7, -0.7, 1);
      drop.x = x;
      drop.y = y - 4;
      const angle = (Math.PI * 2 * i) / drops + Math.random() * 0.4;
      const dist = 12 + Math.random() * 10;
      this.tweens.add({
        targets: drop,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist + 6,
        scale: 0.4,
        alpha: 0,
        duration: 480 + Math.random() * 80,
        ease: 'Quad.Out',
        onComplete: () => drop.destroy(),
      });
    }
  }

  // ───── визуал: эффекты атак ─────

  /**
   * Эффект атаки юнита. Для ближнего боя — арка-вспышка возле цели,
   * для дальнего — короткая вспышка-«дульный» блик у атакующего и
   * подёргивание модели в сторону цели через ThreeBattleLayer.
   */
  private renderAttackEffect(e: Extract<import('@/battle/types').BattleEvent, { kind: 'attack' }>) {
    const dx = e.to.x - e.from.x;
    const dy = e.to.y - e.from.y;
    const angle = Math.atan2(dy, dx);
    const attacker = e.attacker;

    // Анимация в 3D: коротко толкнуть модель в сторону цели.
    this.threeLayer?.attackAnim(attacker.id, angle);

    if (e.ranged) {
      // Дульный/тетивный блик у атакующего.
      const muzzle = this.wG();
      const color = attacker.type === 'mage' ? 0xb08fff : 0xfff58c;
      muzzle.fillStyle(color, 0.95);
      muzzle.fillCircle(0, 0, 5);
      muzzle.fillStyle(0xffffff, 0.7);
      muzzle.fillCircle(0, 0, 2.5);
      muzzle.x = e.from.x + Math.cos(angle) * 6;
      muzzle.y = e.from.y + Math.sin(angle) * 6 - 6;
      this.tweens.add({
        targets: muzzle,
        scale: 1.7,
        alpha: 0,
        duration: 160,
        ease: 'Quad.Out',
        onComplete: () => muzzle.destroy(),
      });
    } else {
      // Slash-арка возле цели (без линии до цели — никаких следов вдоль луча).
      const slash = this.wG();
      const slashColor = attacker.team === 'player' ? 0xb0d8ff : 0xffb0a0;
      slash.lineStyle(2.5, slashColor, 0.95);
      // Дугу рисуем в локальной системе и поворачиваем перпендикулярно к лучу удара.
      slash.beginPath();
      slash.arc(0, 0, 12, -1.0, 1.0);
      slash.strokePath();
      slash.lineStyle(1.4, 0xffffff, 0.85);
      slash.beginPath();
      slash.arc(0, 0, 9, -0.6, 0.6);
      slash.strokePath();
      slash.x = e.to.x;
      slash.y = e.to.y;
      slash.rotation = angle - Math.PI;
      slash.scale = 0.6;
      this.tweens.add({
        targets: slash,
        scale: 1.15,
        alpha: 0,
        duration: 220,
        ease: 'Quad.Out',
        onComplete: () => slash.destroy(),
      });

      // Маленькая искорка в точке удара.
      const spark = this.wG();
      spark.fillStyle(0xfff58c, 0.95);
      spark.fillCircle(0, 0, 3);
      spark.x = e.to.x;
      spark.y = e.to.y;
      this.tweens.add({
        targets: spark,
        scale: 1.8,
        alpha: 0,
        duration: 200,
        onComplete: () => spark.destroy(),
      });
    }
  }

  // ───── визуал: снаряды ─────

  private attachProjectileView(p: import('@/battle/types').Projectile) {
    const g = this.wG();
    if (p.kind === 'magic') {
      // Магический шарик — фиолетовый с golden core.
      g.fillStyle(0xb08fff, 0.18);
      g.fillEllipse(-8, 0, 24, 8);
      g.fillStyle(0xb08fff, 0.85);
      g.fillCircle(0, 0, 4);
      g.fillStyle(0xffd267, 1);
      g.fillCircle(0, 0, 2);
    } else {
      // Стрела — желто-коричневая капля.
      g.fillStyle(0xffd267, 0.16);
      g.fillTriangle(-14, -3, -2, 0, -14, 3);
      g.fillStyle(0xb89a64, 1);
      g.fillTriangle(-5, -2, 5, 0, -5, 2);
      g.fillStyle(0xffffff, 0.6);
      g.fillCircle(5, 0, 1.4);
    }
    g.x = p.x;
    g.y = p.y;
    this.projectileViews.set(p.id, g);
  }

  private handleProjectileHit(p: import('@/battle/types').Projectile) {
    const g = this.projectileViews.get(p.id);
    if (!g) return;
    // Маленькая вспышка попадания. Рисуем круг в локальном (0,0)
    // и позиционируем графику — иначе scale-tween «отлетает» от точки.
    const flash = this.wG();
    flash.fillStyle(p.kind === 'magic' ? 0xb08fff : 0xffd267, 0.85);
    flash.fillCircle(0, 0, 6);
    flash.lineStyle(1.6, p.kind === 'magic' ? 0xd8c7ff : 0xfff0b0, 0.9);
    flash.strokeCircle(0, 0, 9);
    flash.x = p.x;
    flash.y = p.y;
    this.tweens.add({
      targets: flash,
      scale: 1.8,
      alpha: 0,
      duration: 220,
      onComplete: () => flash.destroy(),
    });
    for (let i = 0; i < 5; i++) {
      const shard = this.wG();
      shard.fillStyle(p.kind === 'magic' ? 0xb08fff : 0xffd267, 0.75);
      shard.fillCircle(0, 0, 1.6);
      shard.x = p.x;
      shard.y = p.y;
      const a = (Math.PI * 2 * i) / 5 + Math.random() * 0.35;
      const dist = 8 + Math.random() * 9;
      this.tweens.add({
        targets: shard,
        x: p.x + Math.cos(a) * dist,
        y: p.y + Math.sin(a) * dist,
        alpha: 0,
        scale: 0.35,
        duration: 240,
        ease: 'Quad.Out',
        onComplete: () => shard.destroy(),
      });
    }
    g.destroy();
    this.projectileViews.delete(p.id);
  }

  // ───── визуал: спеллы ─────

  private renderSpellEffect(
    code: SpellCode,
    x: number,
    y: number,
    sourceX: number,
    sourceY: number,
  ) {
    const stats = SPELL_STATS[code];

    if (code === 'fireball') {
      // 3D — фаербол летит с башни короля и взрывается на цели.
      this.threeLayer?.castFireball(sourceX, sourceY, x, y);
      // Земля под целью трясётся в момент взрыва.
      this.time.delayedCall(680, () => this.cameras.main.shake(220, 0.006));
    } else {
      // 3D — зелье падает в точку и оставляет 3-сек зону.
      this.threeLayer?.castHealPotion(x, y, 3000);

      // 2D-«мягкий» индикатор зоны лечения на земле.
      const ringFill = this.wG();
      ringFill.fillStyle(stats.color, 0.08);
      ringFill.fillCircle(0, 0, stats.radius);
      ringFill.x = x;
      ringFill.y = y;
      this.tweens.add({
        targets: ringFill,
        alpha: 0,
        duration: 3000,
        ease: 'Linear',
        onComplete: () => ringFill.destroy(),
      });
    }
  }
}

export function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0b0d12',
    antialias: true,
    pixelArt: false,
    roundPixels: false,
    resolution: RENDER_DPR,
    render: {
      antialias: true,
      pixelArt: false,
      roundPixels: false,
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: ARENA_WIDTH,
      // SCENE_HEIGHT включает в себя верхнюю и нижнюю «трибуны» — арт,
      // который не часть игрового мира, но визуально расширяет сцену.
      height: SCENE_HEIGHT,
    },
    scene: [ArenaScene],
  } as Phaser.Types.Core.GameConfig & { resolution: number });
}

/** Цвет тайла по типу. null значит «отрисуется отдельно» (вода/мост — в своих методах). */
function colorForTile(t: import('./tiles').TileType, row: number): number | null {
  switch (t) {
    case 'water':
      return null; // отрисуется в drawRiver
    case 'bridge':
      return null; // отрисуется в drawBridges
    case 'road':
      return ARENA_COLORS.lane;
    case 'tower_zone':
    case 'grass':
      return row < ROWS / 2 ? ARENA_COLORS.enemyZone : ARENA_COLORS.playerZone;
    case 'blocked':
      return 0x222222;
  }
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
