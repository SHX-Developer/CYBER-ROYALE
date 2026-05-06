import { NestFactory } from '@nestjs/core';
import type { Server } from 'node:http';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  // Выравниваем keepalive с nginx, который держит upstream-соединения
  // в пуле дольше, чем дефолтные 5s у Node. Иначе nginx иногда пытается
  // переиспользовать уже закрытый сокет → "connect refused" в логах.
  // headersTimeout должен быть строго больше keepAliveTimeout.
  const server = app.getHttpServer() as Server;
  server.keepAliveTimeout = 75_000;
  server.headersTimeout = 76_000;

  // eslint-disable-next-line no-console
  console.log(`[CYBER ROYALE] backend on http://localhost:${port}`);
}
bootstrap();
