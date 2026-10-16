import { constants } from 'node:fs';
import { access, copyFile, readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usesWindowsCommandShell = process.platform === 'win32';

const environmentFiles = [
  { example: '.env.example', target: '.env' },
  { example: 'apps/api-gateway/.env.example', target: 'apps/api-gateway/.env' },
  { example: 'apps/auth-service/.env.example', target: 'apps/auth-service/.env' },
  { example: 'apps/catalog-service/.env.example', target: 'apps/catalog-service/.env' },
  { example: 'apps/cart-service/.env.example', target: 'apps/cart-service/.env' },
  { example: 'apps/orders-service/.env.example', target: 'apps/orders-service/.env' },
  { example: 'apps/web/.env.example', target: 'apps/web/.env' },
];

const applicationPortFiles = [
  { name: 'Web', file: 'apps/web/.env', fallback: 3000 },
  { name: 'API Gateway', file: 'apps/api-gateway/.env', fallback: 3003 },
  { name: 'Auth Service', file: 'apps/auth-service/.env', fallback: 3001 },
  { name: 'Catalog Service', file: 'apps/catalog-service/.env', fallback: 3002 },
  { name: 'Cart Service', file: 'apps/cart-service/.env', fallback: 3004 },
  { name: 'Orders Service', file: 'apps/orders-service/.env', fallback: 3005 },
];

const migrationStatusCommands = [
  [
    '--filter',
    '@nexo/auth-service',
    'exec',
    'prisma',
    'migrate',
    'status',
    '--schema',
    'prisma/schema.prisma',
  ],
  [
    '--filter',
    '@nexo/catalog-service',
    'exec',
    'prisma',
    'migrate',
    'status',
    '--schema',
    'prisma/schema.prisma',
  ],
  [
    '--filter',
    '@nexo/orders-service',
    'exec',
    'prisma',
    'migrate',
    'status',
    '--schema',
    'prisma/schema.prisma',
  ],
];

export async function dependenciesAreInstalled(root) {
  return exists(path.join(root, 'node_modules', '.pnpm'));
}

export async function ensureLocalEnvironmentFiles(root) {
  const created = [];

  for (const environmentFile of environmentFiles) {
    const source = path.join(root, environmentFile.example);
    const target = path.join(root, environmentFile.target);

    if (await exists(target)) continue;
    if (!(await exists(source))) {
      throw new Error(`Missing environment template: ${environmentFile.example}`);
    }

    await copyFile(source, target, constants.COPYFILE_EXCL);
    created.push(environmentFile.target);
  }

  return created;
}

export async function readLocalPortConfiguration(root, terminal = process.env) {
  const infrastructure = await readEnvironmentFile(path.join(root, '.env'));
  const applications = await Promise.all(
    applicationPortFiles.map(async ({ name, file, fallback }) => {
      const environment = await readEnvironmentFile(path.join(root, file));
      return { name, port: parsePort(readSetting(environment, terminal, 'PORT'), fallback, file) };
    }),
  );

  return [
    ...applications,
    {
      name: 'PostgreSQL',
      port: parsePort(readSetting(infrastructure, terminal, 'POSTGRES_PORT'), 5432, '.env'),
    },
    {
      name: 'Redis',
      port: parsePort(readSetting(infrastructure, terminal, 'REDIS_PORT'), 6379, '.env'),
    },
  ];
}

export async function assertLocalInfrastructureConfiguration(root, terminal = process.env) {
  const infrastructure = await readEnvironmentFile(path.join(root, '.env'));
  const postgresPort = parsePort(
    readSetting(infrastructure, terminal, 'POSTGRES_PORT'),
    5432,
    '.env',
  );
  const redisPort = parsePort(readSetting(infrastructure, terminal, 'REDIS_PORT'), 6379, '.env');

  await assertLocalUrlMatchesPort(
    root,
    terminal,
    'Cart Service',
    'apps/cart-service/.env',
    'REDIS_URL',
    redisPort,
    6379,
  );
  await assertLocalUrlMatchesPort(
    root,
    terminal,
    'Auth Service',
    'apps/auth-service/.env',
    'DATABASE_URL',
    postgresPort,
    5432,
  );
  await assertLocalUrlMatchesPort(
    root,
    terminal,
    'Catalog Service',
    'apps/catalog-service/.env',
    'DATABASE_URL',
    postgresPort,
    5432,
  );
  await assertLocalUrlMatchesPort(
    root,
    terminal,
    'Orders Service',
    'apps/orders-service/.env',
    'DATABASE_URL',
    postgresPort,
    5432,
  );
}

export async function assertPortsAreAvailable(ports) {
  for (const { name, port } of ports) {
    await assertPortIsAvailable(name, port);
  }
}

export function isExpectedDevelopmentExit({ code, signal, stopRequested }) {
  return stopRequested || code === 0 || signal === 'SIGINT' || signal === 'SIGTERM';
}

async function runCommand(command, args, { cwd = projectRoot } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawnLocalCommand(command, args, {
      cwd,
      stdio: 'inherit',
    });

    child.once('error', (error) =>
      reject(new Error(`Could not start ${command}: ${error.message}`, { cause: error })),
    );
    child.once('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') return resolve();
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? signal}`));
    });
  });
}

async function startDevelopmentProcesses() {
  await new Promise((resolve, reject) => {
    const child = spawnLocalCommand('pnpm', ['dev'], {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    let stopRequested = false;
    const forwardSignal = (signal) => {
      stopRequested = true;
      if (child.exitCode === null) child.kill(signal);
    };

    process.once('SIGINT', forwardSignal);
    process.once('SIGTERM', forwardSignal);
    child.once('error', (error) =>
      reject(new Error(`Could not start pnpm dev: ${error.message}`, { cause: error })),
    );
    child.once('exit', (code, signal) => {
      process.removeListener('SIGINT', forwardSignal);
      process.removeListener('SIGTERM', forwardSignal);

      if (isExpectedDevelopmentExit({ code, signal, stopRequested })) return resolve();
      reject(new Error(`pnpm dev exited with code ${code ?? signal}`));
    });
  });
}

async function ensureDependencies(root) {
  if (await dependenciesAreInstalled(root)) return;

  console.log('Installing workspace dependencies because node_modules is missing...');
  await runCommand('pnpm', ['install'], { cwd: root });
}

async function startInfrastructure() {
  try {
    await runCommand('docker', ['compose', 'up', '-d', '--wait', '--wait-timeout', '60']);
  } catch (error) {
    throw new Error(
      'Docker could not start local infrastructure. Ensure the POSTGRES_PORT and REDIS_PORT values in .env are available, then retry.',
      {
        cause: error,
      },
    );
  }
}

async function assertMigrationsAreReady() {
  try {
    for (const args of migrationStatusCommands) {
      await runCommand('pnpm', args);
    }
  } catch (error) {
    throw new Error(
      'Database migrations are not ready. Run "pnpm local:prepare" once before "pnpm local:up".',
      {
        cause: error,
      },
    );
  }
}

async function prepareDatabase() {
  await runCommand('pnpm', ['auth:prisma:generate']);
  await runCommand('pnpm', ['catalog:prisma:generate']);
  await runCommand('pnpm', ['orders:prisma:generate']);
  await runCommand('pnpm', ['auth:prisma:migrate']);
  await runCommand('pnpm', ['catalog:prisma:migrate']);
  await runCommand('pnpm', ['orders:prisma:migrate']);
}

async function bootstrap() {
  const created = await ensureLocalEnvironmentFiles(projectRoot);
  if (created.length > 0) console.log(`Created missing local configuration: ${created.join(', ')}`);
  await ensureDependencies(projectRoot);
}

async function up() {
  await bootstrap();
  await assertLocalInfrastructureConfiguration(projectRoot);
  const ports = await readLocalPortConfiguration(projectRoot);
  await assertPortsAreAvailable(
    ports.filter(({ name }) => name !== 'PostgreSQL' && name !== 'Redis'),
  );
  await startInfrastructure();
  await assertMigrationsAreReady();
  console.log('Infrastructure and migrations are ready. Starting local development processes...');
  await startDevelopmentProcesses();
}

async function infra() {
  await bootstrap();
  await startInfrastructure();
  console.log('Infrastructure is ready.');
}

async function prepare() {
  await bootstrap();
  await assertLocalInfrastructureConfiguration(projectRoot);
  await startInfrastructure();
  await prepareDatabase();
  console.log('Database preparation completed. You can now run "pnpm local:up".');
}

async function down() {
  await runCommand('docker', ['compose', 'down']);
}

async function main() {
  const command = process.argv[2] ?? 'help';

  if (command === 'up') return up();
  if (command === 'infra') return infra();
  if (command === 'prepare') return prepare();
  if (command === 'down') return down();

  console.log('Usage: node scripts/local-environment.mjs <up|infra|prepare|down>');
  process.exitCode = command === 'help' ? 0 : 1;
}

function parsePort(value, fallback, file) {
  const port = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PORT value in ${file}: ${value}`);
  }

  return port;
}

async function readEnvironmentFile(file) {
  if (!(await exists(file))) return {};

  const content = await readFile(file, 'utf8');
  return Object.fromEntries(
    content.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || line.trimStart().startsWith('#')) return [];
      const [, key, rawValue] = match;
      const value = rawValue.replace(/^(['"])(.*)\1$/, '$2');
      return [[key, value]];
    }),
  );
}

async function assertPortIsAvailable(name, port) {
  await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', (error) => {
      if ('code' in error && error.code === 'EADDRINUSE') {
        reject(new Error(`${name} cannot start because port ${port} is already in use.`));
        return;
      }

      reject(
        new Error(`Could not validate port ${port} for ${name}: ${error.message}`, {
          cause: error,
        }),
      );
    });
    listener.listen(port, '127.0.0.1', () => {
      listener.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

async function assertLocalUrlMatchesPort(
  root,
  terminal,
  serviceName,
  environmentFile,
  variableName,
  expectedPort,
  defaultPort,
) {
  const environment = await readEnvironmentFile(path.join(root, environmentFile));
  const value = readSetting(environment, terminal, variableName);
  if (!value) return;

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${serviceName} ${variableName} is not a valid URL in ${environmentFile}.`);
  }

  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) return;
  const configuredPort = Number(url.port || defaultPort);
  if (configuredPort !== expectedPort) {
    throw new Error(
      `${serviceName} ${variableName} uses local port ${configuredPort}, but it must match the Compose port ${expectedPort}. Update ${environmentFile} manually and retry.`,
    );
  }
}

function readSetting(environment, terminal, name) {
  return terminal[name] ?? environment[name];
}

function spawnLocalCommand(command, args, options) {
  if (!usesWindowsCommandShell) return spawn(command, args, options);

  return spawn(
    process.env.ComSpec ?? 'cmd.exe',
    ['/d', '/s', '/c', [command, ...args].join(' ')],
    options,
  );
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
