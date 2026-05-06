import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get()
  root() {
    return { name: 'CYBER ROYALE backend', status: 'ok' };
  }

  @Get('health')
  health() {
    return { status: 'ok', ts: new Date().toISOString() };
  }
}
