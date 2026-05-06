import { Controller, Get, Param } from '@nestjs/common';
import { DecksService } from './decks.service';

@Controller('decks')
export class DecksController {
  constructor(private readonly decks: DecksService) {}

  @Get('user/:userId')
  findForUser(@Param('userId') userId: string) {
    return this.decks.findForUser(userId);
  }
}
