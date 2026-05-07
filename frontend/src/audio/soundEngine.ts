/**
 * Звуковой движок CYBER ROYALE — процедурные эффекты на Web Audio API.
 *
 * Никаких ассетов: все звуки синтезируются осцилляторами и шумом, поэтому
 * не требуют сети, лицензий и не бьют по бандлу. Идеально для Telegram WebApp.
 *
 * Особенности:
 *   • lazy-init AudioContext — браузеры требуют user-gesture перед первой
 *     инициализацией; контекст создаётся при первом вызове play().
 *   • mute сохраняется в localStorage между сессиями.
 *   • throttle на «частые» звуки (атаки, попадания) — не больше одного
 *     каждого `minIntervalMs`, иначе при толпе юнитов будет каша.
 */
export type SoundCode =
  | 'cardSelect'
  | 'cardPlace'
  | 'insufficient'
  | 'buttonClick'
  | 'tabSwitch'
  | 'unitSpawn'
  | 'meleeHit'
  | 'rangedShoot'
  | 'magicShoot'
  | 'projectileHit'
  | 'unitDeath'
  | 'towerHit'
  | 'towerDestroy'
  | 'fireballCast'
  | 'healCast'
  | 'matchStart'
  | 'matchVictory'
  | 'matchDefeat'
  | 'matchDraw';

const STORAGE_KEY = 'cyber_royale_muted_v1';
const MASTER_GAIN = 0.55;

// Минимальный интервал между одинаковыми звуками — чтобы при массовых
// атаках/попаданиях не было «треска» десятков одновременных эффектов.
const THROTTLE_MS: Partial<Record<SoundCode, number>> = {
  meleeHit: 55,
  rangedShoot: 55,
  magicShoot: 55,
  projectileHit: 50,
  towerHit: 80,
  unitSpawn: 60,
  unitDeath: 70,
};

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted: boolean = readMuted();
  private lastPlayedAt = new Map<SoundCode, number>();

  /** Lazy init — вызывается из play(), безопасен при множественных вызовах. */
  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor =
      (window.AudioContext as typeof AudioContext | undefined) ??
      ((window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return null;
    try {
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : MASTER_GAIN;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
    } catch {
      return null;
    }
    return this.ctx;
  }

  isMuted() {
    return this.muted;
  }

  setMuted(v: boolean) {
    this.muted = v;
    try {
      localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
    } catch {
      /* localStorage недоступен (приватное окно/SSR) */
    }
    if (this.master) this.master.gain.value = v ? 0 : MASTER_GAIN;
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  play(code: SoundCode) {
    if (this.muted) return;
    // Throttle частых звуков.
    const minInterval = THROTTLE_MS[code];
    if (minInterval) {
      const now = performance.now();
      const last = this.lastPlayedAt.get(code) ?? 0;
      if (now - last < minInterval) return;
      this.lastPlayedAt.set(code, now);
    }
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    if (ctx.state === 'suspended') {
      // Браузер мог приостановить контекст — пробуем разбудить.
      ctx.resume().catch(() => undefined);
    }
    SOUND_PLAYERS[code](ctx, this.master, ctx.currentTime);
  }
}

const engine = new SoundEngine();
export const soundEngine = engine;
export const playSound = (code: SoundCode) => engine.play(code);

function readMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Утилиты синтеза.
// ─────────────────────────────────────────────────────────────

/** Тон с быстрой attack/release огибающей. */
function tone(
  ctx: AudioContext,
  out: AudioNode,
  start: number,
  freq: number,
  duration: number,
  type: OscillatorType = 'sine',
  peak = 0.3,
  attack = 0.005,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(out);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** Sweep — частота скользит от fromFreq к toFreq. */
function sweep(
  ctx: AudioContext,
  out: AudioNode,
  start: number,
  fromFreq: number,
  toFreq: number,
  duration: number,
  type: OscillatorType = 'sine',
  peak = 0.3,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(fromFreq, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, toFreq), start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(out);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** Шум с band-pass фильтром — для удара/треска/обвала. */
function noise(
  ctx: AudioContext,
  out: AudioNode,
  start: number,
  duration: number,
  centerFreq: number,
  q: number,
  peak = 0.3,
) {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * duration)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(centerFreq, start);
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peak, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  src.connect(filter).connect(gain).connect(out);
  src.start(start);
  src.stop(start + duration + 0.02);
}

// ─────────────────────────────────────────────────────────────
// Конкретные звуки.
// ─────────────────────────────────────────────────────────────
type SoundPlayer = (ctx: AudioContext, out: AudioNode, t: number) => void;

const SOUND_PLAYERS: Record<SoundCode, SoundPlayer> = {
  // ─── UI ───────────────────────────────────────────────────
  cardSelect: (ctx, out, t) => {
    tone(ctx, out, t, 740, 0.07, 'triangle', 0.18);
    tone(ctx, out, t + 0.02, 1100, 0.05, 'triangle', 0.12);
  },
  cardPlace: (ctx, out, t) => {
    // Глухой «бух» постановки + лёгкий металлический blink.
    tone(ctx, out, t, 320, 0.12, 'sine', 0.32);
    tone(ctx, out, t, 180, 0.18, 'sine', 0.22);
    noise(ctx, out, t, 0.08, 600, 1.2, 0.18);
  },
  insufficient: (ctx, out, t) => {
    // Резкий нисходящий «отказ».
    sweep(ctx, out, t, 480, 200, 0.18, 'sawtooth', 0.22);
    tone(ctx, out, t + 0.06, 160, 0.12, 'square', 0.16);
  },
  buttonClick: (ctx, out, t) => {
    tone(ctx, out, t, 1600, 0.04, 'triangle', 0.16);
  },
  tabSwitch: (ctx, out, t) => {
    tone(ctx, out, t, 520, 0.05, 'triangle', 0.18);
    tone(ctx, out, t + 0.04, 780, 0.05, 'triangle', 0.14);
  },

  // ─── Бой ──────────────────────────────────────────────────
  unitSpawn: (ctx, out, t) => {
    // Магическое появление: восходящий sweep + лёгкий шум.
    sweep(ctx, out, t, 220, 540, 0.22, 'triangle', 0.22);
    noise(ctx, out, t, 0.18, 1200, 0.8, 0.06);
    tone(ctx, out, t + 0.08, 720, 0.1, 'sine', 0.14);
  },
  meleeHit: (ctx, out, t) => {
    // Тяжёлый «тут» по броне.
    tone(ctx, out, t, 110, 0.09, 'square', 0.28);
    noise(ctx, out, t, 0.07, 350, 0.9, 0.22);
    tone(ctx, out, t + 0.01, 220, 0.05, 'sine', 0.16);
  },
  rangedShoot: (ctx, out, t) => {
    // Свист стрелы.
    sweep(ctx, out, t, 1300, 600, 0.13, 'triangle', 0.18);
    noise(ctx, out, t, 0.11, 4000, 0.6, 0.05);
  },
  magicShoot: (ctx, out, t) => {
    // Звон магии — два тона + лёгкая вибрация.
    tone(ctx, out, t, 950, 0.18, 'sine', 0.18);
    tone(ctx, out, t, 1380, 0.18, 'triangle', 0.12);
    sweep(ctx, out, t + 0.02, 1380, 1700, 0.12, 'sine', 0.08);
  },
  projectileHit: (ctx, out, t) => {
    // Звон попадания.
    tone(ctx, out, t, 880, 0.07, 'triangle', 0.18);
    noise(ctx, out, t, 0.06, 2200, 1.0, 0.1);
    tone(ctx, out, t + 0.02, 1320, 0.05, 'sine', 0.1);
  },
  unitDeath: (ctx, out, t) => {
    // Лопнувший «эликсир»: bubble pop + sweep вниз.
    sweep(ctx, out, t, 540, 130, 0.28, 'triangle', 0.22);
    noise(ctx, out, t + 0.02, 0.12, 600, 1.2, 0.14);
    tone(ctx, out, t + 0.06, 90, 0.18, 'sine', 0.18);
  },
  towerHit: (ctx, out, t) => {
    // Трескается камень.
    tone(ctx, out, t, 90, 0.14, 'square', 0.3);
    noise(ctx, out, t, 0.18, 220, 0.6, 0.28);
    noise(ctx, out, t + 0.02, 0.08, 1500, 0.8, 0.1);
  },
  towerDestroy: (ctx, out, t) => {
    // Большой обвал — низкий рёв + затухающий шум.
    sweep(ctx, out, t, 140, 50, 0.9, 'sawtooth', 0.32);
    noise(ctx, out, t, 0.85, 350, 0.4, 0.32);
    noise(ctx, out, t + 0.05, 0.4, 1200, 0.6, 0.18);
    tone(ctx, out, t, 65, 0.7, 'square', 0.2);
    tone(ctx, out, t + 0.2, 50, 0.5, 'sine', 0.16);
  },
  fireballCast: (ctx, out, t) => {
    // Громкий взрыв.
    sweep(ctx, out, t, 180, 60, 0.55, 'sawtooth', 0.32);
    noise(ctx, out, t, 0.5, 700, 0.5, 0.32);
    noise(ctx, out, t + 0.05, 0.35, 2200, 0.7, 0.16);
    tone(ctx, out, t, 80, 0.45, 'square', 0.22);
  },
  healCast: (ctx, out, t) => {
    // Восходящий «небесный» аккорд.
    tone(ctx, out, t, 523.25, 0.55, 'sine', 0.18); // C5
    tone(ctx, out, t + 0.05, 659.25, 0.55, 'sine', 0.16); // E5
    tone(ctx, out, t + 0.1, 783.99, 0.55, 'sine', 0.16); // G5
    tone(ctx, out, t + 0.15, 1046.5, 0.55, 'triangle', 0.12); // C6
    sweep(ctx, out, t, 880, 1760, 0.6, 'sine', 0.06);
  },

  // ─── Матч ─────────────────────────────────────────────────
  matchStart: (ctx, out, t) => {
    // Фанфары: G - C - E - G по чуть выше.
    tone(ctx, out, t, 392.0, 0.18, 'triangle', 0.24); // G4
    tone(ctx, out, t + 0.16, 523.25, 0.18, 'triangle', 0.26); // C5
    tone(ctx, out, t + 0.32, 659.25, 0.18, 'triangle', 0.28); // E5
    tone(ctx, out, t + 0.48, 783.99, 0.32, 'triangle', 0.32); // G5
  },
  matchVictory: (ctx, out, t) => {
    // Триумфальный аккорд C-E-G-C поверх лёгкого шума-фанфары.
    tone(ctx, out, t, 523.25, 0.7, 'triangle', 0.2);
    tone(ctx, out, t + 0.1, 659.25, 0.7, 'triangle', 0.2);
    tone(ctx, out, t + 0.2, 783.99, 0.8, 'triangle', 0.22);
    tone(ctx, out, t + 0.3, 1046.5, 0.9, 'triangle', 0.22);
    noise(ctx, out, t, 0.4, 4000, 1.0, 0.05);
    tone(ctx, out, t + 0.5, 1318.51, 0.6, 'sine', 0.18); // E6
  },
  matchDefeat: (ctx, out, t) => {
    // Печальный нисходящий минор.
    tone(ctx, out, t, 392.0, 0.5, 'sine', 0.22); // G4
    tone(ctx, out, t + 0.18, 349.23, 0.5, 'sine', 0.22); // F4
    tone(ctx, out, t + 0.36, 311.13, 0.6, 'sine', 0.22); // Eb4
    tone(ctx, out, t + 0.6, 261.63, 1.0, 'sine', 0.24); // C4
    tone(ctx, out, t + 0.6, 196.0, 1.0, 'sine', 0.18); // G3 unison
  },
  matchDraw: (ctx, out, t) => {
    // Нейтральный двойной бип.
    tone(ctx, out, t, 440, 0.18, 'triangle', 0.22);
    tone(ctx, out, t + 0.22, 440, 0.18, 'triangle', 0.22);
  },
};
