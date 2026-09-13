import { Module } from '@nestjs/common';

import { GATEWAY_ENVIRONMENT, loadEnvironment } from '../environment';
import { InternalServiceProxyController } from './internal-service-proxy.controller';
import { InternalServiceProxy } from './internal-service-proxy.service';

@Module({
  controllers: [InternalServiceProxyController],
  providers: [
    {
      provide: GATEWAY_ENVIRONMENT,
      useFactory: () => loadEnvironment(),
    },
    InternalServiceProxy,
  ],
})
export class IntegrationBoundaryModule {}
