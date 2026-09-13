import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { CART_ENVIRONMENT, type CartEnvironment } from '../common/environment';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@Inject(CART_ENVIRONMENT) environment: CartEnvironment) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: environment.JWT_ACCESS_SECRET,
      algorithms: ['HS256'],
      ignoreExpiration: false,
    });
  }

  validate(payload: { sub?: unknown; type?: unknown; exp?: unknown }): { id: string } {
    if (
      payload.type !== 'access' ||
      typeof payload.sub !== 'string' ||
      typeof payload.exp !== 'number' ||
      !Number.isFinite(payload.exp) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.sub)
    ) {
      throw new UnauthorizedException('Invalid access token');
    }
    return { id: payload.sub };
  }
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
