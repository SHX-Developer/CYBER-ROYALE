import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
}
