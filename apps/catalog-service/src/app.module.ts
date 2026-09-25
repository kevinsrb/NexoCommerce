import { Module } from '@nestjs/common';
import { CatalogModule } from './catalog/catalog.module';
import { EnvironmentModule } from './common/environment';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';

@Module({ imports: [EnvironmentModule, AuthModule, CatalogModule], controllers: [HealthController] })
export class AppModule {}
