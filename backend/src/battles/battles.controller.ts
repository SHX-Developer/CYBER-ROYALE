import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { BattlesService } from './battles.service';

@Controller('battles')
export class BattlesController {
  constructor(private readonly battles: BattlesService) {}

  // На MVP: создание боя против бота.
  @Post('vs-bot')
  startVsBot(@Body() body: { userId: string; deckId: string }) {
    return this.battles.startVsBot(body.userId, body.deckId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.battles.findOne(id);
  }
}
