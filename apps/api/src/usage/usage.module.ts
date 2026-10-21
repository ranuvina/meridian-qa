import { Module } from '@nestjs/common';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [AuthModule], controllers: [UsageController], providers: [UsageService] })
export class UsageModule {}
