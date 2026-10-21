import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';
import { RedisService } from './redis.service';
import { AuditService } from '../audit/audit.service';

@Global()
@Module({
  providers: [DbService, RedisService, AuditService],
  exports: [DbService, RedisService, AuditService],
})
export class DbModule {}
