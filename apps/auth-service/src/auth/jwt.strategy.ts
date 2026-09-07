import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AUTH_ENVIRONMENT, type AuthEnvironment } from '../common/environment';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@Inject(AUTH_ENVIRONMENT) environment: AuthEnvironment) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: environment.JWT_ACCESS_SECRET,
      algorithms: ['HS256'],
      ignoreExpiration: false,
    });
  }
  validate(payload: { sub?: unknown; type?: unknown }): { id: string } {
    if (
      payload.type !== 'access' ||
      typeof payload.sub !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(payload.sub)
    ) {
      throw new UnauthorizedException('Invalid access token');
    }
    return { id: payload.sub };
  }
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
