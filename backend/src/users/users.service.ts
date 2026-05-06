import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { TelegramUser } from '../auth/telegram';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findOne(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByTelegramId(telegramId: string) {
    return this.prisma.user.findUnique({ where: { telegramId } });
  }

  /**
   * Найти юзера по telegramId или создать. Также подтягивает свежие
   * username/firstName/photoUrl из Telegram при каждом логине.
   */
  upsertFromTelegram(tg: TelegramUser) {
    const telegramId = String(tg.id);
    const data = {
      username: tg.username ?? null,
      firstName: tg.first_name ?? null,
      photoUrl: tg.photo_url ?? null,
    };
    return this.prisma.user.upsert({
      where: { telegramId },
      create: { telegramId, ...data },
      update: data,
    });
  }
}
