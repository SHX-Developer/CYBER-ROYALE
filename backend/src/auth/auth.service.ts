import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { InitDataError, verifyInitData } from './telegram';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  async loginWithTelegram(initData: string) {
    const botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    const devAutoLogin = this.config.get<string>('DEV_AUTO_LOGIN') === '1';

    // Локальная разработка вне Telegram: позволяем подняться без initData,
    // если явно включён DEV_AUTO_LOGIN. Создаём/находим dev-юзера.
    if (devAutoLogin && !initData) {
      const user = await this.users.upsertFromTelegram({
        id: 1,
        username: 'dev',
        first_name: 'Dev',
      });
      this.logger.warn('DEV_AUTO_LOGIN: используется фиктивный пользователь');
      return { user };
    }

    try {
      const verified = verifyInitData(initData, botToken ?? '');
      const user = await this.users.upsertFromTelegram(verified.user);
      return { user };
    } catch (err) {
      const msg = err instanceof InitDataError ? err.message : 'auth failed';
      this.logger.warn(`Telegram auth rejected: ${msg}`);
      throw new UnauthorizedException(msg);
    }
  }
}
