import { Module } from '@nestjs/common';

import { IntegrationBoundaryModule } from './common/http/integration-boundary.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [HealthModule, IntegrationBoundaryModule],
})
export class AppModule {}
