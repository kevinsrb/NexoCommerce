import { Controller, Get, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type Request, type Response } from 'express';

import { InternalServiceProxy, type InternalService } from './internal-service-proxy.service';

@Controller()
export class InternalServiceProxyController {
  constructor(private readonly proxy: InternalServiceProxy) {}

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

  private forward(request: Request, response: Response, service: InternalService) {
    return this.proxy.forward(request, response, service);
  }
}
