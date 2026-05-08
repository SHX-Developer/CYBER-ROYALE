/**
 * Сид MVP-карт. Запускается через `npx prisma db seed`.
 *
 * 16 карт: 14 юнитов и 2 спелла. Цифры синхронизированы с frontend UNIT_STATS.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// CardType живёт в сгенерированных типах Prisma — используем строковые литералы,
// чтобы файл компилировался ещё до первого `prisma generate`.
type CardType = 'UNIT' | 'SPELL';

interface SeedCard {
  code: string;
  name: string;
  type: CardType;
  energyCost: number;
  hp?: number;
  damage?: number;
  attackSpeed?: number;
  range?: number;
  moveSpeed?: number;
  description?: string;
  icon: string;
}

const CARDS: SeedCard[] = [
  {
    code: 'warrior',
    name: 'Воин',
    type: 'UNIT',
    energyCost: 3,
    hp: 520,
    damage: 78,
    attackSpeed: 1.05,
    range: 1,
    moveSpeed: 1.0,
    description: 'Надёжный боец ближнего боя.',
    icon: '⚔️',
  },
  {
    code: 'archer',
    name: 'Стрелок',
    type: 'UNIT',
    energyCost: 3,
    hp: 250,
    damage: 60,
    attackSpeed: 1.0,
    range: 5,
    moveSpeed: 1.0,
    description: 'Бьёт издалека, но хрупкий.',
    icon: '🏹',
  },
  {
    code: 'tank',
    name: 'Танк',
    type: 'UNIT',
    energyCost: 5,
    hp: 1450,
    damage: 105,
    attackSpeed: 1.6,
    range: 1,
    moveSpeed: 0.5,
    description: 'Много здоровья, медленно идёт.',
    icon: '🛡️',
  },
  {
    code: 'assassin',
    name: 'Быстрый убийца',
    type: 'UNIT',
    energyCost: 2,
    hp: 220,
    damage: 88,
    attackSpeed: 0.75,
    range: 1,
    moveSpeed: 1.8,
    description: 'Стремительная атака, мало HP.',
    icon: '🗡️',
  },
  {
    code: 'squad',
    name: 'Группа солдат',
    type: 'UNIT',
    energyCost: 3,
    hp: 560,
    damage: 62,
    attackSpeed: 1.1,
    range: 1,
    moveSpeed: 1.2,
    description: 'Три бойца в одной карте: давят числом, но боятся взрывов.',
    icon: '👥',
  },
  {
    code: 'mage',
    name: 'Маг',
    type: 'UNIT',
    energyCost: 4,
    hp: 360,
    damage: 112,
    attackSpeed: 1.4,
    range: 4,
    moveSpeed: 0.9,
    description: 'Сильный AoE-урон с дистанции.',
    icon: '🪄',
  },
  {
    code: 'lancer',
    name: 'Копейщик',
    type: 'UNIT',
    energyCost: 3,
    hp: 460,
    damage: 95,
    attackSpeed: 1.15,
    range: 1.5,
    moveSpeed: 1.1,
    description: 'Ближний боец с увеличенной дистанцией удара.',
    icon: '🔱',
  },
  {
    code: 'guardian',
    name: 'Страж',
    type: 'UNIT',
    energyCost: 4,
    hp: 900,
    damage: 70,
    attackSpeed: 1.3,
    range: 1,
    moveSpeed: 0.7,
    description: 'Средний танк: держит линию дешевле тяжёлого Танка.',
    icon: '🛡️',
  },
  {
    code: 'bombardier',
    name: 'Бомбардир',
    type: 'UNIT',
    energyCost: 4,
    hp: 320,
    damage: 150,
    attackSpeed: 1.8,
    range: 3.4,
    moveSpeed: 0.75,
    description: 'Дальний взрывной урон, слаб против быстрых юнитов рядом.',
    icon: '💣',
  },
  {
    code: 'frost_witch',
    name: 'Ледяная ведьма',
    type: 'UNIT',
    energyCost: 4,
    hp: 330,
    damage: 70,
    attackSpeed: 1.25,
    range: 3.6,
    moveSpeed: 0.9,
    description: 'Стабильный дальний магический урон по любым целям.',
    icon: '❄️',
  },
  {
    code: 'stormcaller',
    name: 'Громовержец',
    type: 'UNIT',
    energyCost: 5,
    hp: 420,
    damage: 145,
    attackSpeed: 1.7,
    range: 4.1,
    moveSpeed: 0.8,
    description: 'Дорогой дальний юнит с сильным одиночным ударом.',
    icon: '⚡',
  },
  {
    code: 'drone',
    name: 'Дрон',
    type: 'UNIT',
    energyCost: 2,
    hp: 170,
    damage: 45,
    attackSpeed: 0.9,
    range: 2.6,
    moveSpeed: 1.6,
    description: 'Быстрый дешёвый стрелок для давления и добивания.',
    icon: '🛸',
  },
  {
    code: 'berserker',
    name: 'Берсерк',
    type: 'UNIT',
    energyCost: 3,
    hp: 420,
    damage: 65,
    attackSpeed: 0.65,
    range: 1,
    moveSpeed: 1.5,
    description: 'Очень быстрые атаки, но без запаса здоровья танка.',
    icon: '🪓',
  },
  {
    code: 'priest',
    name: 'Жрец',
    type: 'UNIT',
    energyCost: 3,
    hp: 300,
    damage: 50,
    attackSpeed: 1.2,
    range: 3,
    moveSpeed: 0.9,
    description: 'Дешёвый дальний юнит поддержки с мягким световым ударом.',
    icon: '🔔',
  },
  {
    code: 'fireball',
    name: 'Огненный удар',
    type: 'SPELL',
    energyCost: 4,
    damage: 250,
    range: 2, // радиус
    description: 'Наносит урон в области 2 клетки.',
    icon: '🔥',
  },
  {
    code: 'heal',
    name: 'Лечение',
    type: 'SPELL',
    energyCost: 2,
    damage: 250, // используется как сила лечения для type=SPELL+code=heal
    range: 2,
    description: 'Лечит союзников в области 2 клетки на 250 HP.',
    icon: '✨',
  },
];

async function main() {
  for (const card of CARDS) {
    await prisma.card.upsert({
      where: { code: card.code },
      create: card,
      update: card,
    });
  }
  // eslint-disable-next-line no-console
  console.log(`Seeded ${CARDS.length} cards`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
