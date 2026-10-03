import { timingSafeEqual } from 'node:crypto';
import { BadRequestException, CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { type Request } from 'express';
import { CART_ENVIRONMENT, type CartEnvironment } from './environment';

@Injectable()
export class InternalCartServiceGuard implements CanActivate {
  constructor(@Inject(CART_ENVIRONMENT) private readonly environment: CartEnvironment) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header('x-internal-service-token') ?? '';
    const expected = this.environment.CART_INTERNAL_SERVICE_TOKEN;
    const supplied = Buffer.from(provided);
    const configured = Buffer.from(expected);
    if (supplied.length !== configured.length || !timingSafeEqual(supplied, configured)) {
      throw new UnauthorizedException();
    }
    const requestId = request.header('x-request-id');
    if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw new BadRequestException('Valid x-request-id required');
    }
    return true;
  }
}
