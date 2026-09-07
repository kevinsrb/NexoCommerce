import { Controller, Get } from '@nestjs/common';
import { type HealthResponse } from '@nexo/contracts';

@Controller('api/health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return { status: 'ok', service: 'api-gateway' };
  }
}
