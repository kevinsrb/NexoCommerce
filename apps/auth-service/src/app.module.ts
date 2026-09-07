import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { EnvironmentModule } from './common/environment';
import { HealthController } from './health/health.controller';

@Module({ imports: [EnvironmentModule, AuthModule], controllers: [HealthController] })
export class AppModule {}
