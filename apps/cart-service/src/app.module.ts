import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { EnvironmentModule } from './common/environment';
import { HealthController } from './health/health.controller';

@Module({ imports: [EnvironmentModule, AuthModule, CartModule], controllers: [HealthController] })
export class AppModule {}
