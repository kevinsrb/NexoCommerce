import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { type Request } from 'express';
import { CATALOG_ENVIRONMENT, type CatalogEnvironment } from './environment';

@Injectable()
export class CatalogInternalGuard implements CanActivate {
  constructor(@Inject(CATALOG_ENVIRONMENT) private readonly environment: CatalogEnvironment) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const received = request.header('x-internal-service-token');
    const expected = Buffer.from(this.environment.CATALOG_INTERNAL_TOKEN);
    const actual = received === undefined ? Buffer.alloc(0) : Buffer.from(received);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new UnauthorizedException('Internal service authentication required');
    }
    return true;
  }
}
