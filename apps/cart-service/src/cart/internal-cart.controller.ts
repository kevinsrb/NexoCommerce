import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { InternalCartServiceGuard } from '../common/internal-cart-service.guard';
import { ClaimCartDto, FinishCartClaimDto, ReadCartDto } from './cart.dto';
import { CartService } from './cart.service';

@Controller('internal/v1/cart')
@UseGuards(InternalCartServiceGuard)
export class InternalCartController {
  constructor(private readonly cart: CartService) {}

  @Post('read')
  @HttpCode(200)
  read(@Body() body: ReadCartDto) { return this.cart.readCheckout(body.principalId); }

  @Post('checkout-claims')
  @HttpCode(200)
  claim(@Body() body: ClaimCartDto) {
    return this.cart.claimCheckout(body.principalId, body.attemptId, body.expectedVersion);
  }

  @Post('checkout-claims/complete')
  @HttpCode(200)
  complete(@Body() body: FinishCartClaimDto) {
    return this.cart.completeCheckout(body.principalId, body.attemptId, body.version);
  }

  @Post('checkout-claims/release')
  @HttpCode(200)
  release(@Body() body: FinishCartClaimDto) {
    return this.cart.releaseCheckout(body.principalId, body.attemptId, body.version);
  }
}
