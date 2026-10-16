import { Body, Controller, Delete, Get, Inject, Patch, Post, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { type CheckoutRequest } from '@nexo/contracts';
import { type Request, type Response } from 'express';

import { GATEWAY_ENVIRONMENT, type GatewayEnvironment } from '../environment';
import { InternalServiceProxy, type InternalService } from './internal-service-proxy.service';

@Controller()
export class InternalServiceProxyController {
  constructor(
    private readonly proxy: InternalServiceProxy,
    @Inject(GATEWAY_ENVIRONMENT) private readonly environment: GatewayEnvironment,
  ) {}

  @Post('auth/register')
  @ApiTags('Auth')
  @ApiOperation({ summary: 'Register through the Auth Service' })
  register(@Req() request: Request, @Res() response: Response) {
    return this.forward(request, response, 'auth');
  }

  @Post('auth/login')
  @ApiTags('Auth')
  @ApiOperation({ summary: 'Log in through the Auth Service' })
  login(@Req() request: Request, @Res() response: Response) {
    return this.forward(request, response, 'auth');
  }

  @Post('auth/refresh')
  @ApiTags('Auth')
  @ApiOperation({ summary: 'Refresh a session through the Auth Service' })
  refresh(@Req() request: Request, @Res() response: Response) {
    return this.forward(request, response, 'auth');
  }

  @Get('auth/me')
  @ApiTags('Auth')
  @ApiOperation({ summary: 'Read the authenticated identity through the Auth Service' })
  me(@Req() request: Request, @Res() response: Response) {
    return this.forward(request, response, 'auth');
  }

  @Get('products')
  @ApiTags('Catalog')
  @ApiOperation({ summary: 'List products through the Catalog Service' })
  listProducts(@Req() request: Request, @Res() response: Response) {
    return this.forward(request, response, 'catalog');
  }

  @Get('products/:slug')
  @ApiTags('Catalog')
  @ApiOperation({ summary: 'Read a product through the Catalog Service' })
  getProduct(@Req() request: Request, @Res() response: Response) {
    return this.forward(request, response, 'catalog');
  }

  @Post('products')
  @ApiTags('Catalog')
  @ApiOperation({ summary: 'Create a product through the Catalog Service' })
  createProduct(@Req() request: Request, @Res() response: Response) {
    return this.forward(request, response, 'catalog');
  }

  @Patch('products/:id')
  @ApiTags('Catalog')
  @ApiOperation({ summary: 'Update a product through the Catalog Service' })
  updateProduct(@Req() request: Request, @Res() response: Response) {
    return this.forward(request, response, 'catalog');
  }

  @Get('categories')
  @ApiTags('Catalog')
  @ApiOperation({ summary: 'List categories through the Catalog Service' })
  listCategories(@Req() request: Request, @Res() response: Response) {
    return this.forward(request, response, 'catalog');
  }

  @Post('categories')
  @ApiTags('Catalog')
  @ApiOperation({ summary: 'Create a category through the Catalog Service' })
  createCategory(@Req() request: Request, @Res() response: Response) {
    return this.forward(request, response, 'catalog');
  }

  @Get('cart')
  @ApiTags('Cart')
  @ApiOperation({ summary: 'Read the authenticated cart through the Cart Service' })
  getCart(@Req() request: Request, @Res() response: Response) {
    return this.forward(request, response, 'cart');
  }

  @Post('cart/items')
  @ApiTags('Cart')
  @ApiOperation({ summary: 'Add an item to the authenticated cart through the Cart Service' })
  addCartItem(@Req() request: Request, @Res() response: Response) {
    return this.forward(request, response, 'cart');
  }

  @Patch('cart/items/:variantId')
  @ApiTags('Cart')
  @ApiOperation({ summary: 'Update an authenticated cart item through the Cart Service' })
  updateCartItem(@Req() request: Request, @Res() response: Response) {
    return this.forward(request, response, 'cart');
  }

  @Delete('cart/items/:variantId')
  @ApiTags('Cart')
  @ApiOperation({ summary: 'Remove an item from the authenticated cart through the Cart Service' })
  removeCartItem(@Req() request: Request, @Res() response: Response) {
    return this.forward(request, response, 'cart');
  }

  @Delete('cart')
  @ApiTags('Cart')
  @ApiOperation({ summary: 'Clear the authenticated cart through the Cart Service' })
  clearCart(@Req() request: Request, @Res() response: Response) {
    return this.forward(request, response, 'cart');
  }

  @Post('checkout')
  @ApiTags('Checkout')
  @ApiOperation({ summary: 'Checkout through the Orders Service' })
  @ApiBearerAuth()
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Stable checkout retry key' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['expectedPrices'],
      properties: {
        expectedPrices: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['variantId', 'price_decimal', 'currency'],
            properties: {
              variantId: { type: 'string', format: 'uuid' },
              price_decimal: { type: 'string' },
              currency: { type: 'string', pattern: '^[A-Z]{3}$' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Checkout published as a pending order' })
  @ApiResponse({ status: 200, description: 'Current state of an idempotent replay' })
  @ApiResponse({ status: 202, description: 'Checkout recovery is in progress' })
  @ApiResponse({ status: 400, description: 'Invalid checkout request' })
  @ApiResponse({ status: 401, description: 'Access token is missing or invalid' })
  @ApiResponse({ status: 409, description: 'Checkout, price, stock, or reservation conflict' })
  @ApiResponse({ status: 422, description: 'Cart or variant cannot be checked out' })
  @ApiResponse({ status: 503, description: 'Orders or an internal dependency is unavailable' })
  checkout(
    @Body() body: CheckoutRequest,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    if (!this.environment.CHECKOUT_ENABLED)
      throw new ServiceUnavailableException('Checkout temporarily unavailable');
    return this.forward(request, response, 'orders', body);
  }

  private forward(request: Request, response: Response, service: InternalService, body?: unknown) {
    return this.proxy.forward(request, response, service, body);
  }
}
