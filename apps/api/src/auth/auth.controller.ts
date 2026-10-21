import { Body, Controller, Get, Post, UseGuards, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtGuard } from './jwt.guard';
import { Actor, RequestActor } from '../common/decorators';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() body: { email?: string; password?: string }) {
    if (!body?.email || !body?.password) throw new BadRequestException('email and password required');
    return this.auth.login(body.email, body.password);
  }

  @Post('refresh')
  refresh(@Body() body: { refreshToken?: string }) {
    if (!body?.refreshToken) throw new BadRequestException('refreshToken required');
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  logout(@Body() body: { refreshToken?: string }) {
    if (!body?.refreshToken) throw new BadRequestException('refreshToken required');
    return this.auth.logout(body.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtGuard)
  me(@Actor() actor: RequestActor) {
    return this.auth.me(actor.userId);
  }
}
