import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { type Request, type Response } from 'express';

import {
  GATEWAY_ENVIRONMENT,
  type GatewayEnvironment,
} from '../environment';
import { getRequestId } from './request-id.types';

export type InternalService = 'auth' | 'catalog' | 'cart' | 'orders';

const forwardedHeaders = ['accept', 'authorization', 'content-type', 'idempotency-key'] as const;

@Injectable()
export class InternalServiceProxy {
  constructor(
    @Inject(GATEWAY_ENVIRONMENT) private readonly environment: GatewayEnvironment,
  ) {}

  async forward(
    request: Request,
    response: Response,
    service: InternalService,
    body: unknown = request.body,
  ): Promise<void> {
    try {
      const upstream = await this.requestUpstream(request, service, body);
      const contentType = upstream.headers.get('content-type');
      const responseBody = Buffer.from(await upstream.arrayBuffer());
      if (this.isJsonContentType(contentType)) JSON.parse(responseBody.toString('utf8'));
      if (contentType) response.setHeader('content-type', contentType);

      response.status(upstream.status).send(responseBody);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException('Internal service unavailable');
    }
  }

  private async requestUpstream(
    request: Request,
    service: InternalService,
    body: unknown,
  ): Promise<globalThis.Response> {
    const headers = new Headers();
    for (const header of forwardedHeaders) {
      const value = request.header(header);
      if (value) headers.set(header, value);
    }
    headers.set('x-request-id', getRequestId(request) ?? 'unknown');

    const hasBody = !['GET', 'HEAD'].includes(request.method) && request.body !== undefined;
    return fetch(this.targetUrl(request, service), {
      method: request.method,
      headers,
      ...(hasBody ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(5_000),
    });
  }

  private targetUrl(request: Request, service: InternalService): URL {
    const serviceUrl = {
      auth: this.environment.AUTH_SERVICE_URL,
      catalog: this.environment.CATALOG_SERVICE_URL,
      cart: this.environment.CART_SERVICE_URL,
      orders: this.environment.ORDERS_SERVICE_URL,
    }[service];
    const originalUrl = request.originalUrl;
    if (!originalUrl.startsWith('/') || originalUrl.startsWith('//') || originalUrl.includes('\\')) {
      throw new BadRequestException('Invalid request target');
    }
    const internalPath = service === 'orders'
      ? originalUrl.replace(/^\/api\/checkout(?=\?|$)/, '/internal/v1/checkouts')
      : originalUrl.replace(/^\/api(?=\/|$)/, '');
    if (!internalPath.startsWith('/') || internalPath.startsWith('//')) {
      throw new BadRequestException('Invalid request target');
    }
    return new URL(internalPath, serviceUrl);
  }

  private isJsonContentType(contentType: string | null): boolean {
    return contentType?.split(';', 1)[0].trim().toLowerCase() === 'application/json';
  }
}
