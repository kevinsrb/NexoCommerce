import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { type Request } from 'express';
import { CATALOG_ENVIRONMENT, type CatalogEnvironment } from '../common/environment';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type AccessClaims = { sub?: unknown; type?: unknown; role?: unknown; adminProof?: unknown };

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @Inject(CATALOG_ENVIRONMENT) private readonly environment: CatalogEnvironment,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new UnauthorizedException('Authentication required');

    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(token, {
        secret: this.environment.JWT_ACCESS_SECRET,
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }

    if (
      claims.type !== 'access' ||
      typeof claims.sub !== 'string' ||
      !UUID_V4.test(claims.sub) ||
      (claims.role !== 'CUSTOMER' && claims.role !== 'ADMIN')
    ) {
      throw new UnauthorizedException('Invalid access token');
    }
    if (claims.role !== 'ADMIN') throw new ForbiddenException('Admin role required');
    const expectedProof = createHmac('sha256', this.environment.CATALOG_ADMIN_SECRET)
      .update(`${claims.sub}:ADMIN`)
      .digest('base64url');
    const actualProof = typeof claims.adminProof === 'string' ? Buffer.from(claims.adminProof) : Buffer.alloc(0);
    if (
      actualProof.length !== Buffer.byteLength(expectedProof) ||
      !timingSafeEqual(actualProof, Buffer.from(expectedProof))
    ) {
      throw new UnauthorizedException('Invalid access token');
    }

    return true;
  }
}
