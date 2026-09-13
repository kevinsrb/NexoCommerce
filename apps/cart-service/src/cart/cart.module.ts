import { Module } from '@nestjs/common';
import { createClient } from 'redis';
import { CART_ENVIRONMENT, type CartEnvironment } from '../common/environment';
import { CartRepository, type CartRedisClient } from './cart.repository';

export const CART_REDIS_CLIENT = Symbol('CART_REDIS_CLIENT');

@Module({
  providers: [
    {
      provide: CART_REDIS_CLIENT,
      inject: [CART_ENVIRONMENT],
      useFactory: (environment: CartEnvironment) => createClient({ url: environment.REDIS_URL }),
    },
    {
      provide: CartRepository,
      inject: [CART_REDIS_CLIENT],
      useFactory: (redis: CartRedisClient) => new CartRepository(redis),
    },
  ],
  exports: [CartRepository],
})
export class CartModule {}
