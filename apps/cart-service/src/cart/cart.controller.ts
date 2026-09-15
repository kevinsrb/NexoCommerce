import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { type Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { AddCartItemDto, UpdateCartItemDto } from './cart.dto';
import { CartService } from './cart.service';

type CartRequest = Request & { user: { id: string }; requestId: string };

@Controller('cart')
@UseGuards(JwtAuthGuard)
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  get(@Req() request: CartRequest) {
    return this.cart.getCart(request.user.id, request.requestId);
  }

  @Post('items')
  add(@Req() request: CartRequest, @Body() dto: AddCartItemDto) {
    return this.cart.addItem(request.user.id, dto.variantId, dto.quantity, request.requestId);
  }

  @Patch('items/:variantId')
  update(
    @Req() request: CartRequest,
    @Param('variantId', new ParseUUIDPipe({ version: '4' })) variantId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cart.updateItem(request.user.id, variantId, dto.quantity, request.requestId);
  }

  @Delete('items/:variantId')
  @HttpCode(204)
  remove(
    @Req() request: CartRequest,
    @Param('variantId', new ParseUUIDPipe({ version: '4' })) variantId: string,
  ) {
    return this.cart.removeItem(request.user.id, variantId);
  }

  @Delete()
  @HttpCode(204)
  clear(@Req() request: CartRequest) {
    return this.cart.clearCart(request.user.id);
  }
}
