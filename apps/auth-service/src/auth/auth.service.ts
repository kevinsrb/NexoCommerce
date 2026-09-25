import { createHmac, randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { Prisma, type User } from '../../generated/client';
import { AUTH_ENVIRONMENT, type AuthEnvironment } from '../common/environment';
import { PrismaService } from '../prisma/prisma.service';
import { type LoginDto, type RefreshDto, type RegisterDto } from './auth.dto';

export const publicUser = (user: User) => ({
  id: user.id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  role: user.role,
  createdAt: user.createdAt,
});

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(AUTH_ENVIRONMENT) private readonly environment: AuthEnvironment,
  ) {}

  async register(input: RegisterDto) {
    const email = input.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } }))
      throw new ConflictException('Email already registered');
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          email,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          role: 'CUSTOMER',
          passwordHash,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Email already registered');
      }
      throw error;
    }
    return this.issueTokens(user, this.prisma);
  }

  async login(input: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
    });
    if (!user || !(await argon2.verify(user.passwordHash, input.password)))
      throw new UnauthorizedException('Invalid credentials');
    return this.issueTokens(user, this.prisma);
  }

  async refresh(input: RefreshDto) {
    let claims: { sub?: unknown; jti?: unknown; type?: unknown };
    try {
      claims = await this.jwt.verifyAsync(input.refreshToken, {
        secret: this.environment.JWT_REFRESH_SECRET,
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (
      claims.type !== 'refresh' ||
      typeof claims.jti !== 'string' ||
      typeof claims.sub !== 'string'
    )
      throw new UnauthorizedException('Invalid refresh token');
    const stored = await this.prisma.refreshToken.findUnique({
      where: { id: claims.jti },
      include: { user: true },
    });
    if (
      !stored ||
      stored.userId !== claims.sub ||
      stored.revokedAt ||
      stored.expiresAt <= new Date() ||
      !(await argon2.verify(stored.tokenHash, input.refreshToken))
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    // Conditional update inside the transaction allows only one concurrent rotation to succeed.
    return this.prisma.$transaction(async (transaction) => {
      const revoked = await transaction.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) throw new UnauthorizedException('Invalid refresh token');
      return this.issueTokens(stored.user, transaction);
    });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Invalid access token');
    return publicUser(user);
  }

  private async issueTokens(user: User, database: Pick<Prisma.TransactionClient, 'refreshToken'>) {
    const id = randomUUID();
    const adminProof = user.role === 'ADMIN'
      ? createHmac('sha256', this.environment.CATALOG_ADMIN_SECRET)
          .update(`${user.id}:ADMIN`)
          .digest('base64url')
      : undefined;
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        {
          sub: user.id,
          type: 'access',
          role: user.role,
          ...(adminProof === undefined ? {} : { adminProof }),
        },
        {
          secret: this.environment.JWT_ACCESS_SECRET,
          algorithm: 'HS256',
          expiresIn: this.environment.JWT_ACCESS_TTL_SECONDS,
        },
      ),
      this.jwt.signAsync(
        { sub: user.id, jti: id, type: 'refresh' },
        {
          secret: this.environment.JWT_REFRESH_SECRET,
          algorithm: 'HS256',
          expiresIn: this.environment.JWT_REFRESH_TTL_SECONDS,
        },
      ),
    ]);
    const tokenHash = await argon2.hash(refreshToken, { type: argon2.argon2id });
    await database.refreshToken.create({
      data: {
        id,
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + this.environment.JWT_REFRESH_TTL_SECONDS * 1000),
      },
    });
    return { accessToken, refreshToken, user: publicUser(user) };
  }
}
