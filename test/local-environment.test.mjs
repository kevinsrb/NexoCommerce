import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertLocalInfrastructureConfiguration,
  assertPortsAreAvailable,
  dependenciesAreInstalled,
  ensureLocalEnvironmentFiles,
  isExpectedDevelopmentExit,
  readLocalPortConfiguration,
} from '../scripts/local-environment.mjs';

const environmentPairs = [
  ['.env.example', '.env'],
  ['apps/api-gateway/.env.example', 'apps/api-gateway/.env'],
  ['apps/auth-service/.env.example', 'apps/auth-service/.env'],
  ['apps/catalog-service/.env.example', 'apps/catalog-service/.env'],
  ['apps/cart-service/.env.example', 'apps/cart-service/.env'],
  ['apps/orders-service/.env.example', 'apps/orders-service/.env'],
  ['apps/web/.env.example', 'apps/web/.env'],
];

async function withWorkspace(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nexo-local-environment-'));

  try {
    await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function createExamples(root) {
  await Promise.all(
    environmentPairs.map(async ([example]) => {
      const target = path.join(root, example);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `SOURCE=${example}\n`, 'utf8');
    }),
  );
}

test('creates only missing local environment files and preserves local values', async () => {
  await withWorkspace(async (root) => {
    await createExamples(root);
    const existingCartEnvironment = path.join(root, 'apps/cart-service/.env');
    await writeFile(existingCartEnvironment, 'REDIS_URL=redis://localhost:16379\n', 'utf8');

    const created = await ensureLocalEnvironmentFiles(root);

    assert.equal(created.length, 6);
    assert.equal(
      await readFile(existingCartEnvironment, 'utf8'),
      'REDIS_URL=redis://localhost:16379\n',
    );
    assert.equal(
      await readFile(path.join(root, 'apps/orders-service/.env'), 'utf8'),
      'SOURCE=apps/orders-service/.env.example\n',
    );
  });
});

test('recognizes an installed pnpm workspace from its local store', async () => {
  await withWorkspace(async (root) => {
    assert.equal(await dependenciesAreInstalled(root), false);
    await mkdir(path.join(root, 'node_modules/.pnpm'), { recursive: true });
    assert.equal(await dependenciesAreInstalled(root), true);
  });
});

test('reads configured application and infrastructure ports without changing them', async () => {
  await withWorkspace(async (root) => {
    await writeFile(path.join(root, '.env'), 'POSTGRES_PORT=55432\nREDIS_PORT=16379\n', 'utf8');

    for (const [directory, port] of [
      ['apps/api-gateway', 3103],
      ['apps/auth-service', 3101],
      ['apps/catalog-service', 3102],
      ['apps/cart-service', 3104],
      ['apps/orders-service', 3105],
    ]) {
      await mkdir(path.join(root, directory), { recursive: true });
      await writeFile(path.join(root, directory, '.env'), `PORT=${port}\n`, 'utf8');
    }

    const ports = await readLocalPortConfiguration(root);

    assert.deepEqual(ports, [
      { name: 'Web', port: 3000 },
      { name: 'API Gateway', port: 3103 },
      { name: 'Auth Service', port: 3101 },
      { name: 'Catalog Service', port: 3102 },
      { name: 'Cart Service', port: 3104 },
      { name: 'Orders Service', port: 3105 },
      { name: 'PostgreSQL', port: 55432 },
      { name: 'Redis', port: 16379 },
    ]);
  });
});

test('rejects a local Cart Redis URL that does not match the configured Compose port', async () => {
  await withWorkspace(async (root) => {
    await writeFile(path.join(root, '.env'), 'REDIS_PORT=16379\n', 'utf8');
    await mkdir(path.join(root, 'apps/cart-service'), { recursive: true });
    await writeFile(
      path.join(root, 'apps/cart-service/.env'),
      'REDIS_URL=redis://localhost:6379\n',
      'utf8',
    );

    await assert.rejects(
      () => assertLocalInfrastructureConfiguration(root),
      /Cart Service REDIS_URL.*16379/,
    );
  });
});

test('honors explicit terminal port overrides without rewriting local configuration', async () => {
  await withWorkspace(async (root) => {
    await writeFile(path.join(root, '.env'), 'REDIS_PORT=6379\n', 'utf8');
    await mkdir(path.join(root, 'apps/cart-service'), { recursive: true });
    await writeFile(
      path.join(root, 'apps/cart-service/.env'),
      'REDIS_URL=redis://localhost:6379\n',
      'utf8',
    );

    const terminal = {
      REDIS_PORT: '16379',
      REDIS_URL: 'redis://localhost:16379',
    };
    const ports = await readLocalPortConfiguration(root, terminal);

    assert.equal(ports.at(-1)?.port, 16379);
    await assert.doesNotReject(() => assertLocalInfrastructureConfiguration(root, terminal));
    assert.equal(await readFile(path.join(root, '.env'), 'utf8'), 'REDIS_PORT=6379\n');
  });
});

test('rejects an occupied application port before starting development processes', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    await assert.rejects(
      () => assertPortsAreAvailable([{ name: 'Cart Service', port }]),
      new RegExp(`Cart Service.*${port}`),
    );
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('treats a nonzero Turbo exit after Ctrl+C as an expected development shutdown', () => {
  assert.equal(isExpectedDevelopmentExit({ code: 1, signal: null, stopRequested: true }), true);
  assert.equal(isExpectedDevelopmentExit({ code: 1, signal: null, stopRequested: false }), false);
});
