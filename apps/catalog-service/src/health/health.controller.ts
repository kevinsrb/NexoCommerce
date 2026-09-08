import { Controller, Get } from '@nestjs/common';
import { type HealthResponse } from '@nexo/contracts';

@Controller('health')
export class HealthController {
  @Get()
  health(): HealthResponse {
    return { status: 'ok', service: 'catalog-service' };
  }
}
