import { Module } from '@nestjs/common';
import { MembershipsController } from './memberships.controller';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [AuthModule], controllers: [MembershipsController] })
export class MembershipsModule {}
