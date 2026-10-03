import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadEnvironment, parseEnvironment } from '../src/common/environment';

describe('API gateway environment', () => {
  it('defaults its listener to port 3003 without changing the shared base default', () => {
    expect(
      parseEnvironment({
        AUTH_SERVICE_URL: 'http://auth.internal.test',
        CATALOG_SERVICE_URL: 'http://catalog.internal.test',
        CART_SERVICE_URL: 'http://cart.internal.test',
        ORDERS_SERVICE_URL: 'http://orders.internal.test',
      }),
    ).toEqual({
      NODE_ENV: 'development',
      PORT: 3003,
      AUTH_SERVICE_URL: 'http://auth.internal.test',
      CATALOG_SERVICE_URL: 'http://catalog.internal.test',
      CART_SERVICE_URL: 'http://cart.internal.test',
      ORDERS_SERVICE_URL: 'http://orders.internal.test',
    });
  });

  it('accepts HTTP(S) service origins with an optional port and trailing slash', () => {
    expect(
      parseEnvironment({
        AUTH_SERVICE_URL: 'https://auth.internal.test:8443/',
        CATALOG_SERVICE_URL: 'http://catalog.internal.test:3002',
        CART_SERVICE_URL: 'https://cart.internal.test/',
        ORDERS_SERVICE_URL: 'http://orders.internal.test',
      }),
    ).toEqual(expect.objectContaining({
      AUTH_SERVICE_URL: 'https://auth.internal.test:8443/',
      CATALOG_SERVICE_URL: 'http://catalog.internal.test:3002',
      CART_SERVICE_URL: 'https://cart.internal.test/',
      ORDERS_SERVICE_URL: 'http://orders.internal.test',
    }));
  });

  it.each([
    ['AUTH_SERVICE_URL', 'ftp://auth.internal.test'],
    ['CATALOG_SERVICE_URL', 'http://catalog.internal.test/internal'],
    ['CART_SERVICE_URL', 'https://customer:secret@cart.internal.test'],
    ['AUTH_SERVICE_URL', 'https://auth.internal.test?token=secret'],
    ['CART_SERVICE_URL', 'https://cart.internal.test#fragment'],
    ['ORDERS_SERVICE_URL', 'http://orders.internal.test/private'],
  ])('rejects a non-origin internal service target: %s=%s', (key, value) => {
    expect(() => parseEnvironment({
      AUTH_SERVICE_URL: 'http://auth.internal.test',
      CATALOG_SERVICE_URL: 'http://catalog.internal.test',
      CART_SERVICE_URL: 'http://cart.internal.test',
      ORDERS_SERVICE_URL: 'http://orders.internal.test',
      [key]: value,
    })).toThrow();
  });

  it('loads a gateway app-local dotenv file into the runtime environment', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nexo-gateway-environment-'));
    const environment: Record<string, string> = {};
    const environmentFile = join(directory, '.env');

    try {
      writeFileSync(
        environmentFile,
        'NODE_ENV=test\nPORT=43123\nAUTH_SERVICE_URL=http://auth.internal.test\nCATALOG_SERVICE_URL=http://catalog.internal.test\nCART_SERVICE_URL=http://cart.internal.test\nORDERS_SERVICE_URL=http://orders.internal.test\n',
      );

      expect(loadEnvironment(environment, environmentFile)).toEqual({
        NODE_ENV: 'test',
        PORT: 43123,
        AUTH_SERVICE_URL: 'http://auth.internal.test',
        CATALOG_SERVICE_URL: 'http://catalog.internal.test',
        CART_SERVICE_URL: 'http://cart.internal.test',
        ORDERS_SERVICE_URL: 'http://orders.internal.test',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('preserves supplied shell values while loading unset dotenv keys', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nexo-gateway-environment-'));
      const environment: Record<string, string> = {
        NODE_ENV: 'production',
        PORT: '43124',
        AUTH_SERVICE_URL: 'http://shell-auth.internal.test',
        CATALOG_SERVICE_URL: 'http://shell-catalog.internal.test',
        CART_SERVICE_URL: 'http://shell-cart.internal.test',
        ORDERS_SERVICE_URL: 'http://shell-orders.internal.test',
      };
    const environmentFile = join(directory, '.env');

    try {
      writeFileSync(
        environmentFile,
        'NODE_ENV=test\nPORT=43123\nAUTH_SERVICE_URL=http://auth.internal.test\nCATALOG_SERVICE_URL=http://catalog.internal.test\nCART_SERVICE_URL=http://cart.internal.test\nORDERS_SERVICE_URL=http://orders.internal.test\nGATEWAY_LABEL=local\n',
      );

      expect(loadEnvironment(environment, environmentFile)).toEqual({
        NODE_ENV: 'production',
        PORT: 43124,
        AUTH_SERVICE_URL: 'http://shell-auth.internal.test',
        CATALOG_SERVICE_URL: 'http://shell-catalog.internal.test',
        CART_SERVICE_URL: 'http://shell-cart.internal.test',
        ORDERS_SERVICE_URL: 'http://shell-orders.internal.test',
      });
      expect(environment.GATEWAY_LABEL).toBe('local');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
