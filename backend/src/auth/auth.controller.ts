import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

interface TelegramLoginDto {
  initData: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Принимает initData из window.Telegram.WebApp.initData,
   * валидирует HMAC-подпись, апсертит юзера, возвращает профиль.
   */
  @Post('telegram')
  telegramLogin(@Body() body: TelegramLoginDto) {
    return this.auth.loginWithTelegram(body?.initData ?? '');
  }
}
