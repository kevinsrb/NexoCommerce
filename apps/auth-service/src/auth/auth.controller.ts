import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { type Request } from 'express';
import { LoginDto, RefreshDto, RegisterDto } from './auth.dto';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt.strategy';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('register')
  register(@Body() input: RegisterDto) {
    return this.auth.register(input);
  }
  @Post('login')
  @HttpCode(200)
  login(@Body() input: LoginDto) {
    return this.auth.login(input);
  }
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() input: RefreshDto) {
    return this.auth.refresh(input);
  }
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() request: Request & { user: { id: string } }) {
    return this.auth.me(request.user.id);
  }
}
