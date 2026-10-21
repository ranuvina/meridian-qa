import { Body, Controller, Get, Post, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';
import { MeterService } from './meter.service';

@Controller('gw')
@UseGuards(RateLimitGuard)
export class GatewayController {
  constructor(private readonly meter: MeterService) {}

  @Get('ping')
  async ping(@Req() req: any) {
    const started = Date.now();
    if (req.apiKey.suspended) throw new ForbiddenException('Tenant suspended');
    const result = { pong: true, tenant: req.apiKey.tenantId, at: new Date().toISOString() };
    await this.meter.record(req.apiKey, 'GET /gw/ping', 200, Date.now() - started);
    return result;
  }

  @Post('echo')
  async echo(@Req() req: any, @Body() body: any) {
    const started = Date.now();
    if (req.apiKey.suspended) throw new ForbiddenException('Tenant suspended');
    await this.meter.record(req.apiKey, 'POST /gw/echo', 200, Date.now() - started);
    return { echo: body ?? null };
  }

  @Post('transform')
  async transform(@Req() req: any, @Body() body: { text?: string; op?: string }) {
    const started = Date.now();
    if (req.apiKey.suspended) throw new ForbiddenException('Tenant suspended');
    const text = body?.text ?? '';
    const op = body?.op ?? 'upper';
    const out =
      op === 'upper' ? text.toUpperCase()
      : op === 'lower' ? text.toLowerCase()
      : op === 'reverse' ? [...text].reverse().join('')
      : text;
    await this.meter.record(req.apiKey, 'POST /gw/transform', 200, Date.now() - started);
    return { result: out, op };
  }
}
