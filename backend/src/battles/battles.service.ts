import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type BattleOutcome = 'won' | 'lost' | 'draw';

export interface ReportBattleInput {
  userId: string;
  outcome: BattleOutcome;
  destroyedTowers: number;
  lostTowers: number;
  duration: number; // секунды
  rewardCoins: number;
  rewardXp: number;
}

@Injectable()
export class BattlesService {
  constructor(private readonly prisma: PrismaService) {}

  startVsBot(userId: string, deckId: string) {
    return this.prisma.battle.create({
      data: {
        mode: 'BOT',
        userId,
        deckId,
        status: 'IN_PROGRESS',
      },
    });
  }

  findOne(id: string) {
    return this.prisma.battle.findUnique({ where: { id } });
  }

  /**
   * Этап 27: фронт после конца боя присылает результат.
   * Создаём запись Battle и инкрементим стату игрока.
   */
  async reportBattle(input: ReportBattleInput) {
    const status =
      input.outcome === 'won' ? 'WIN' : input.outcome === 'lost' ? 'LOSS' : 'DRAW';

    // Проверяем, что юзер существует — иначе update упадёт.
    const exists = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!exists) throw new NotFoundException(`User ${input.userId} not found`);

    // Каст в any — у Prisma client'a новые поля появятся только после
    // `prisma migrate dev` + `prisma generate`. На сервере это делает
    // Dockerfile/docker-entrypoint, локально — `npm run prisma:migrate`.
    const battle = await this.prisma.battle.create({
      data: {
        mode: 'BOT',
        status,
        userId: input.userId,
        duration: input.duration,
        destroyedTowers: input.destroyedTowers,
        lostTowers: input.lostTowers,
        rewardCoins: input.rewardCoins,
        rewardXp: input.rewardXp,
        endedAt: new Date(),
      } as never,
    });

    const winInc = status === 'WIN' ? 1 : 0;
    const lossInc = status === 'LOSS' ? 1 : 0;

    const user = await this.prisma.user.update({
      where: { id: input.userId },
      data: {
        coins: { increment: input.rewardCoins },
        xp: { increment: input.rewardXp },
        wins: { increment: winInc },
        losses: { increment: lossInc },
        battlesCount: { increment: 1 },
      } as never,
    });

    return { battle, user };
  }
}
