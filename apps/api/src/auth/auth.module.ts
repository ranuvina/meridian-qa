import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtGuard } from './jwt.guard';
import { RolesGuard } from './roles.guard';

@Module({
  providers: [AuthService, JwtGuard, RolesGuard],
  controllers: [AuthController],
  exports: [JwtGuard, RolesGuard],
})
export class AuthModule {}
