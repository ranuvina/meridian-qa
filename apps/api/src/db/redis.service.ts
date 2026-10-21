import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

  async onModuleDestroy() {
    this.client.disconnect();
  }
}
