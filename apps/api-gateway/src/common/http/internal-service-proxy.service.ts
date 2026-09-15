import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { type Request, type Response } from 'express';

import {
  GATEWAY_ENVIRONMENT,
  type GatewayEnvironment,
} from '../environment';
import { getRequestId } from './request-id.types';

export type InternalService = 'auth' | 'catalog' | 'cart';

const forwardedHeaders = ['accept', 'authorization', 'content-type'] as const;

@Injectable()
export class InternalServiceProxy {
  constructor(
    @Inject(GATEWAY_ENVIRONMENT) private readonly environment: GatewayEnvironment,
  ) {}

  async forward(
    request: Request,
    response: Response,
    service: InternalService,
  ): Promise<void> {
    try {
      const upstream = await this.requestUpstream(request, service);
      const contentType = upstream.headers.get('content-type');
      if (contentType) response.setHeader('content-type', contentType);

      response.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      throw new ServiceUnavailableException('Internal service unavailable');
    }
  }

  private async requestUpstream(request: Request, service: InternalService): Promise<globalThis.Response> {
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
      ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
      signal: AbortSignal.timeout(5_000),
    });
  }

  private targetUrl(request: Request, service: InternalService): URL {
    const serviceUrl =
      service === 'auth'
        ? this.environment.AUTH_SERVICE_URL
        : service === 'catalog'
          ? this.environment.CATALOG_SERVICE_URL
          : this.environment.CART_SERVICE_URL;
    const internalPath = request.originalUrl.replace(/^\/api(?=\/|$)/, '');
    return new URL(internalPath, serviceUrl);
  }
}
