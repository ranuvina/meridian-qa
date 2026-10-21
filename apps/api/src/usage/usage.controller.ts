import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Actor, RequestActor } from '../common/decorators';
import { UsageService } from './usage.service';

function defaultRange(from?: string, to?: string) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 30 * 86400_000);
  return { from: start.toISOString(), to: end.toISOString() };
}

@Controller('usage')
@UseGuards(JwtGuard, RolesGuard)
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get('summary')
  summary(@Actor() actor: RequestActor, @Query('from') from?: string, @Query('to') to?: string) {
    const range = defaultRange(from, to);
    return this.usage.summary(actor.tenantId, range.from, range.to);
  }

  @Get('daily')
  daily(@Actor() actor: RequestActor, @Query('from') from?: string, @Query('to') to?: string) {
    const range = defaultRange(from, to);
    return this.usage.daily(actor.tenantId, range.from, range.to);
  }

  @Get('export')
  async export(
    @Res() res: Response,
    @Query('keyId') keyId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const range = defaultRange(from, to);
    const rows = await this.usage.exportRows(keyId ?? null, range.from, range.to);
    const csv = this.usage.toCsv(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="usage.csv"');
    res.send(csv);
  }
}
