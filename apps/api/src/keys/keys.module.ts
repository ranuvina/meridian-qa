import { Module } from '@nestjs/common';
import { KeysController } from './keys.controller';
import { AuthModule } from '../auth/auth.module';
import { GatewayModule } from '../gateway/gateway.module';

@Module({ imports: [AuthModule, GatewayModule], controllers: [KeysController] })
export class KeysModule {}
