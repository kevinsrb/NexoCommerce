import { Body, Controller, Headers, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { CheckoutDomainException } from '../common/checkout-domain.exception';
import { CheckoutDto } from './checkout.dto';
import { CheckoutService } from './checkout.service';

@Controller('internal/v1/checkouts')
@UseGuards(JwtAuthGuard)
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}
  @Post()
  async checkout(
    @Headers('idempotency-key') key: string | undefined,
    @Body() dto: CheckoutDto,
    @Req() request: Request & { user: { id: string }; requestId: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!key || !/^[\x21-\x7e]{1,200}$/.test(key))
      throw new CheckoutDomainException('INVALID_REQUEST', 'Valid Idempotency-Key required', 400);
    const result = await this.checkoutService.checkout(
      request.user.id,
      key,
      dto,
      request.requestId,
    );
    response.status(result.status);
    return result.body;
  }
}
