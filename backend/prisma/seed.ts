/**
 * Сид MVP-карт. Запускается через `npx prisma db seed`.
 *
 * 8 карт: 6 юнитов и 2 спелла. Цифры — стартовые ориентиры,
 * балансится на следующих этапах.
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
    hp: 600,
    damage: 80,
    attackSpeed: 1.2,
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
    hp: 1500,
    damage: 100,
    attackSpeed: 1.5,
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
    hp: 200,
    damage: 90,
    attackSpeed: 0.8,
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
    hp: 150, // на одного бойца, отряд из 4
    damage: 30,
    attackSpeed: 1.1,
    range: 1,
    moveSpeed: 1.2,
    description: 'Отряд из 4 бойцов.',
    icon: '👥',
  },
  {
    code: 'mage',
    name: 'Маг',
    type: 'UNIT',
    energyCost: 4,
    hp: 350,
    damage: 120,
    attackSpeed: 1.4,
    range: 4,
    moveSpeed: 0.9,
    description: 'Сильный AoE-урон с дистанции.',
    icon: '🪄',
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
