import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { BattlesService, type BattleOutcome } from './battles.service';

interface ReportBattleDto {
  userId: string;
  outcome: BattleOutcome;
  destroyedTowers: number;
  lostTowers: number;
  duration: number;
  rewardCoins: number;
  rewardXp: number;
}

@Controller('battles')
export class BattlesController {
  constructor(private readonly battles: BattlesService) {}

  @Post('vs-bot')
  startVsBot(@Body() body: { userId: string; deckId: string }) {
    return this.battles.startVsBot(body.userId, body.deckId);
  }

  /** Этап 27: отчёт о результате боя из клиента. */
  @Post('report')
  report(@Body() body: ReportBattleDto) {
    return this.battles.reportBattle(body);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.battles.findOne(id);
  }
}
