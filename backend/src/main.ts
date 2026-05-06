import { NestFactory } from '@nestjs/core';
import type { Server } from 'node:http';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const port = Number(process.env.PORT ?? 3000);

  // Явно слушать на IPv4 0.0.0.0 — иначе Node по умолчанию вешается на ::
  // (IPv6 all) и в docker-сети первый SYN от nginx иногда улетает мимо,
  // отсюда «connect refused» в логах nginx.
  await app.listen(port, '0.0.0.0');

  // Выравниваем keepalive с nginx (60s) — backend держит дольше, никогда
  // не закрывает первым. Без этого nginx бы пытался переиспользовать
  // уже закрытое соединение. headersTimeout строго больше keepAliveTimeout.
  const server = app.getHttpServer() as Server;
  server.keepAliveTimeout = 75_000;
  server.headersTimeout = 76_000;

  // eslint-disable-next-line no-console
  console.log(`[CYBER ROYALE] backend on http://0.0.0.0:${port}`);
}
bootstrap();
