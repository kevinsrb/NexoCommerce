import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard, JwtStrategy } from './jwt.strategy';

@Module({
  imports: [PassportModule],
  providers: [JwtStrategy, JwtAuthGuard],
  exports: [JwtAuthGuard],
})
export class AuthModule {}
