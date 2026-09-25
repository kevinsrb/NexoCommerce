import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminGuard } from './admin.guard';

@Module({
  imports: [JwtModule.register({})],
  providers: [AdminGuard],
  exports: [AdminGuard, JwtModule],
})
export class AuthModule {}
