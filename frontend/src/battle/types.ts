/**
 * Типы боевого движка. Никаких зависимостей от Phaser/React —
 * BattleEngine можно будет позже заместить серверной симуляцией.
 */
import type { Lane, Side } from '@/game/arena';
import type { Tower } from '@/game/tower';
import type { Unit, UnitType } from '@/game/unit';
import type { SpellCode } from '@/game/spells';

export type BattleOutcome = 'won' | 'lost' | 'draw';

export interface EnergyState {
  player: number;
  enemy: number;
}

export interface BattleEngineState {
  units: Unit[];
  towers: Tower[];
  energy: EnergyState;
  towersDestroyed: { player: number; enemy: number };
  /** Прошло мс с начала матча. */
  timeMs: number;
  /** Длительность матча в мс (когда timeMs >= это, тайм-аут). */
  matchDurationMs: number;
  /** Закончился ли матч. */
  outcome: BattleOutcome | null;
}

/** Команды, которыми внешний слой управляет движком. */
export type BattleCommand =
  | { kind: 'placeUnit'; team: Side; type: UnitType; lane: Lane }
  | { kind: 'castSpell'; team: Side; code: SpellCode; x: number; y: number };

/** События, на которые подписывается рендерер для визуальных эффектов. */
export type BattleEvent =
  | { kind: 'unitSpawned'; unit: Unit }
  | { kind: 'unitDamaged'; unit: Unit; amount: number }
  | { kind: 'unitHealed'; unit: Unit; amount: number }
  | { kind: 'unitDied'; unit: Unit }
  | { kind: 'attack'; from: { x: number; y: number }; to: { x: number; y: number } }
  | { kind: 'towerDamaged'; tower: Tower; amount: number }
  | { kind: 'towerDestroyed'; tower: Tower }
  | { kind: 'spellCast'; code: SpellCode; x: number; y: number; team: Side }
  | { kind: 'energyChanged'; team: Side; value: number }
  | { kind: 'timeTick'; timeLeftMs: number }
  | { kind: 'gameOver'; outcome: BattleOutcome };

export type BattleListener = (e: BattleEvent) => void;
