import { Module } from '@nestjs/common';
import { KeysController } from './keys.controller';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [AuthModule], controllers: [KeysController] })
export class KeysModule {}
