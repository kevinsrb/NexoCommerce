import { Module } from '@nestjs/common';
import { CatalogModule } from './catalog/catalog.module';
import { EnvironmentModule } from './common/environment';
import { HealthController } from './health/health.controller';

@Module({ imports: [EnvironmentModule, CatalogModule], controllers: [HealthController] })
export class AppModule {}
