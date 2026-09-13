import { Module } from '@nestjs/common';
import { createLogger } from '@nexo/logger';
import { createClient } from 'redis';
import { CART_ENVIRONMENT, type CartEnvironment } from '../common/environment';
import { CartRepository, type CartRedisClient } from './cart.repository';

export const CART_REDIS_CLIENT = Symbol('CART_REDIS_CLIENT');
const logger = createLogger('cart-service');

export const createCartRedisClient = (url: string): CartRedisClient => {
  const client = createClient({ url });
  client.on('error', () => logger.error({ event: 'redis_error' }, 'Redis client error'));
  return client as CartRedisClient;
};

@Module({
  providers: [
    {
      provide: CART_REDIS_CLIENT,
      inject: [CART_ENVIRONMENT],
      useFactory: (environment: CartEnvironment) => createCartRedisClient(environment.REDIS_URL),
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
