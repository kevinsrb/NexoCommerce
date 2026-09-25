import 'reflect-metadata';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { AuthService } from '../src/auth/auth.service';
import { AUTH_ENVIRONMENT, parseEnvironment } from '../src/common/environment';
import { PrismaService } from '../src/prisma/prisma.service';

const environment = parseEnvironment({
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/auth_db',
  JWT_ACCESS_SECRET: 'access-secret-for-tests-at-least-32-characters',
    JWT_REFRESH_SECRET: 'refresh-secret-for-tests-at-least-32-characters',
  CATALOG_ADMIN_SECRET: 'catalog-admin-secret-for-tests-at-least-32',
});

describe('AuthService security', () => {
  const user = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    role: 'CUSTOMER',
    passwordHash: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const prisma = {
    user: { findUnique: jest.fn(), create: jest.fn() },
    refreshToken: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: AuthService;
  const jwt = new JwtService();

  beforeEach(async () => {
    jest.resetAllMocks();
    user.passwordHash = await argon2.hash('correct horse battery staple');
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async ({ data }) => ({ ...user, ...data }));
    prisma.refreshToken.create.mockImplementation(async ({ data }) => data);
    prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: AUTH_ENVIRONMENT, useValue: environment },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('registers with an Argon2 password hash and returns only public user fields', async () => {
    const result = await service.register({
      email: 'Ada@Example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      password: 'correct horse battery staple',
    });
    const stored = prisma.user.create.mock.calls[0]?.[0].data;
    expect(stored.email).toBe('ada@example.com');
    expect(stored.role).toBe('CUSTOMER');
    expect(await argon2.verify(stored.passwordHash, 'correct horse battery staple')).toBe(true);
    expect(result.user).toEqual({
      id: user.id,
      email: user.email,
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: 'CUSTOMER',
      createdAt: user.createdAt,
    });
    const claims = jwt.verify(result.accessToken, { secret: environment.JWT_ACCESS_SECRET });
    expect(claims.sub).toBe(user.id);
    expect(claims.role).toBe('CUSTOMER');
    const refresh = prisma.refreshToken.create.mock.calls[0]?.[0].data;
    expect(refresh.tokenHash).not.toBe(result.refreshToken);
    expect(await argon2.verify(refresh.tokenHash, result.refreshToken)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('Hash');
  });

  it('rejects an existing email without creating another user or token', async () => {
    prisma.user.findUnique.mockResolvedValue(user);
    await expect(
      service.register({
        email: user.email,
        firstName: 'Ada',
        lastName: 'Lovelace',
        password: 'correct horse battery staple',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('logs in with a verified password and independently signed tokens', async () => {
    prisma.user.findUnique.mockResolvedValue(user);
    const result = await service.login({
      email: user.email,
      password: 'correct horse battery staple',
    });
    expect(jwt.verify(result.accessToken, { secret: environment.JWT_ACCESS_SECRET }).sub).toBe(
      user.id,
    );
    expect(jwt.verify(result.refreshToken, { secret: environment.JWT_REFRESH_SECRET }).sub).toBe(
      user.id,
    );
    expect(() =>
      jwt.verify(result.refreshToken, { secret: environment.JWT_ACCESS_SECRET }),
    ).toThrow();
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it.each(['wrong password', ''])('rejects invalid credentials (%s)', async (password) => {
    prisma.user.findUnique.mockResolvedValue(user);
    await expect(service.login({ email: user.email, password })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('rejects a nonexistent user', async () => {
    await expect(service.login({ email: user.email, password: 'unknown' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rotates the refresh token by atomically revoking the source before storing its replacement', async () => {
    prisma.user.findUnique.mockResolvedValue(user);
    const first = await service.login({
      email: user.email,
      password: 'correct horse battery staple',
    });
    const stored = prisma.refreshToken.create.mock.calls[0]?.[0].data;
    prisma.refreshToken.findUnique.mockResolvedValue({ ...stored, revokedAt: null, user });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    const second = await service.refresh({ refreshToken: first.refreshToken });
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.$transaction).toHaveBeenCalled();
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.refresh({ refreshToken: first.refreshToken })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(2);
  });

  it('rejects expired, revoked, or mismatched refresh records', async () => {
    prisma.user.findUnique.mockResolvedValue(user);
    const first = await service.login({
      email: user.email,
      password: 'correct horse battery staple',
    });
    const stored = prisma.refreshToken.create.mock.calls[0]?.[0].data;
    for (const override of [
      { revokedAt: new Date() },
      { expiresAt: new Date(0) },
      { tokenHash: await argon2.hash('different-token') },
    ]) {
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...stored,
        revokedAt: null,
        user,
        ...override,
      });
      await expect(service.refresh({ refreshToken: first.refreshToken })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });
});
