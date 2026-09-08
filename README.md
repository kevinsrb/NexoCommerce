# Nexo Commerce

Nexo Commerce is a TypeScript monorepo for an evolving commerce platform. Phase 1 establishes a locally runnable foundation: a Next.js storefront shell, a NestJS API gateway, independent Auth and Catalog services, and local PostgreSQL/Redis infrastructure.

## Architecture

```mermaid
flowchart LR
  Browser[Browser] --> Web[apps/web\nNext.js]
  Browser --> Gateway[apps/api-gateway\nNestJS + Express]
  Browser --> Auth[apps/auth-service\nNestJS + Express]
  Browser --> Catalog[apps/catalog-service\nNestJS + Express]

  Gateway --> Shared[packages/contracts\npackages/config\npackages/logger]
  Auth --> Shared
  Catalog --> Shared
  Auth --> AuthDB[(auth_db)]
  Catalog --> CatalogDB[(catalog_db)]
  Postgres[(PostgreSQL 16)] --> AuthDB
  Postgres --> CatalogDB
  Redis[(Redis 7)]
```

The gateway currently exposes only its own health and Swagger endpoints; it does **not** proxy Auth or Catalog yet. The storefront is a local-data shell and does not make Catalog calls. This separation is deliberate while gateway routing and browser-facing integration are still being designed.

## Stack

- pnpm workspaces and Turborepo
- TypeScript (strict), ESLint, Prettier, Jest, and Supertest
- Next.js App Router, React, and Tailwind CSS
- NestJS on the Express adapter, Swagger, Helmet, and Pino
- Prisma with PostgreSQL 16; Redis 7 is provisioned for later use
- Docker Compose for local infrastructure

## Repository layout

```text
NexoCommerce/
├── apps/
│   ├── api-gateway/       # /api/health and /api/docs; no proxy in Phase 1
│   ├── auth-service/      # Auth API and private Prisma schema/migrations
│   ├── catalog-service/   # Catalog API and private Prisma schema/migrations
│   └── web/               # Next.js storefront shell
├── packages/
│   ├── config/            # Zod runtime environment parsers
│   ├── contracts/         # Shared API-only TypeScript contracts
│   ├── eslint-config/     # Shared lint configuration
│   ├── logger/            # Pino logger helpers
│   ├── testing/           # Test helpers
│   └── typescript-config/ # Shared strict TypeScript configurations
├── infra/docker/postgres/ # Database bootstrap SQL
├── docs/architecture/     # Architecture notes
├── docs/adr/              # Architecture decision records
├── docker-compose.yml
├── pnpm-workspace.yaml
└── turbo.json
```

## Local setup

Install a current Node.js release with Corepack/pnpm available, Docker Desktop (or another Docker engine with Compose), and Git. From the repository root in PowerShell:

```powershell
pnpm install
Copy-Item .env.example .env
Copy-Item apps\api-gateway\.env.example apps\api-gateway\.env
Copy-Item apps\auth-service\.env.example apps\auth-service\.env
Copy-Item apps\catalog-service\.env.example apps\catalog-service\.env
Copy-Item apps\web\.env.example apps\web\.env
pnpm db:up
pnpm auth:prisma:generate
pnpm catalog:prisma:generate
pnpm auth:prisma:migrate
pnpm catalog:prisma:migrate
pnpm --filter @nexo/web dev
```

`pnpm db:up` starts PostgreSQL and Redis using the root `.env`. On a new Compose volume, PostgreSQL's init script creates `auth_db` and `catalog_db`; migrations then create the service-owned tables. Do not start the applications against an un-migrated database if you intend to use database-backed routes. Start the remaining backends in separate terminals:

```powershell
# API gateway: the current bootstrap reads process environment, not apps/api-gateway/.env.
# Use 3003 while the storefront uses its default port 3000.
$env:PORT = '3003'
pnpm --filter @nexo/api-gateway start:dev

# These applications load the .env in their own app directory through dotenv/config.
pnpm --filter @nexo/auth-service dev
pnpm --filter @nexo/catalog-service dev
```

The root `pnpm dev` command is available through Turbo, but it starts both the web app and API gateway with their current default port of `3000`; do not use it for an all-services local launch until one port is changed. The individual commands above work with the checked-in default configuration.

After startup, the local addresses are:

- Storefront: `http://localhost:3000`
- API gateway health (with the setup override): `http://localhost:3003/api/health`
- API gateway Swagger UI (with the setup override): `http://localhost:3003/api/docs`
- Auth health: `http://localhost:3001/health`
- Catalog health: `http://localhost:3002/health`

The health endpoints are liveness checks and intentionally do not query PostgreSQL. A successful health response is not evidence that migrations have been applied or that a live database operation has succeeded.

## Environment variables

Copy each example file rather than committing a real `.env` file. The validation in `@nexo/config` rejects malformed values; Auth also rejects identical access/refresh secrets and invalid JWT TTLs.

| Location | Variables | Purpose/default |
| --- | --- | --- |
| `.env` | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `REDIS_PORT` | Compose credentials and host ports. Defaults in `.env.example`: `nexo`, `nexo_local_password`, `5432`, `6379`. |
| `apps/api-gateway/.env` | `NODE_ENV`, `PORT` | Documents the intended Gateway values (`PORT=3000`; `NODE_ENV` accepts `development`, `test`, or `production`). The current Gateway bootstrap does not load this file; set process environment variables in the shell when overriding its defaults. |
| `apps/auth-service/.env` | `NODE_ENV`, `PORT`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL_SECONDS`, `JWT_REFRESH_TTL_SECONDS` | Auth runtime; `PORT=3001`, PostgreSQL `auth_db`, and TTL defaults of 900/604800 seconds. JWT secrets must be at least 32 characters and different. |
| `apps/catalog-service/.env` | `NODE_ENV`, `PORT`, `DATABASE_URL` | Catalog runtime; `PORT=3002` and PostgreSQL `catalog_db`. |
| `apps/web/.env` | `NEXT_PUBLIC_CATALOG_API_URL` | Reserved browser-safe configuration. The current storefront does not consume it; the example value is `http://localhost:3001`. |

Normal Auth and Catalog service starts load the `.env` in their own application directory through `dotenv/config`. Prisma operations need `DATABASE_URL` too. The root alias commands below run Prisma from the relevant service and read that service’s `.env`; use the explicit environment setup only when validating a schema directly from the root:

```powershell
# Auth schema validation from the repository root (does not contact PostgreSQL)
$env:DATABASE_URL = 'postgresql://nexo:nexo_local_password@localhost:5432/auth_db?schema=public'
pnpm --filter @nexo/auth-service exec prisma validate --schema prisma/schema.prisma
Remove-Item Env:DATABASE_URL

# Catalog schema validation from the repository root (does not contact PostgreSQL)
$env:DATABASE_URL = 'postgresql://nexo:nexo_local_password@localhost:5432/catalog_db'
pnpm --filter @nexo/catalog-service exec prisma validate --schema prisma/schema.prisma
Remove-Item Env:DATABASE_URL
```

Run `pnpm auth:prisma:migrate` and `pnpm catalog:prisma:migrate` only after PostgreSQL is running, against the intended local service database. They use committed migrations and do contact the database.

## Commands

Run these root commands from the repository root:

| Command | Meaning |
| --- | --- |
| `pnpm dev` | Run all workspace development scripts through Turbo. With the checked-in defaults, Web and Gateway both bind port 3000, so use the individual start commands (and a Gateway `PORT` override) for a concurrent local launch. |
| `pnpm build` | Build all workspace packages/apps through Turbo. |
| `pnpm lint` | Lint all workspace packages/apps through Turbo. |
| `pnpm test` | Run all workspace test suites through Turbo. |
| `pnpm typecheck` | Strict type-check all workspace packages/apps through Turbo. |
| `pnpm db:up` | Start PostgreSQL and Redis in the background with Compose. |
| `pnpm db:down` | Stop and remove the Compose containers (named volumes remain). |
| `pnpm auth:prisma:generate` | Generate the Auth service Prisma client. |
| `pnpm auth:prisma:migrate` | Apply committed Auth migrations to the configured `auth_db`. |
| `pnpm catalog:prisma:generate` | Generate the Catalog service Prisma client. |
| `pnpm catalog:prisma:migrate` | Apply committed Catalog migrations to the configured `catalog_db`. |

Useful individual commands:

```powershell
pnpm --filter @nexo/web dev
$env:PORT = '3003'; pnpm --filter @nexo/api-gateway start:dev
pnpm --filter @nexo/auth-service dev
pnpm --filter @nexo/catalog-service dev

pnpm --filter @nexo/web build
pnpm --filter @nexo/api-gateway test
pnpm --filter @nexo/auth-service typecheck
pnpm --filter @nexo/catalog-service lint
```

## Services and boundaries

| Service | Owns | Phase 1 routes |
| --- | --- | --- |
| API gateway | HTTP boundary only; no service persistence | `GET /api/health`, Swagger at `/api/docs` |
| Auth service | `auth_db`, `User`, and `RefreshToken` data | `GET /health`, `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me` |
| Catalog service | `catalog_db`, `Category`, `Product`, and `ProductVariant` data | `GET /health`, `GET /products`, `GET /products/:slug`, `GET /categories`, `POST /categories`, `POST /products`, `PATCH /products/:id` |
| Web | Presentation-only storefront with local featured-product data | Home page; loading, empty, error, and ready presentation states |

All backends use NestJS with Express. They apply Helmet, permissive CORS without credentials, global DTO validation (`whitelist`, transformation, and rejection of unknown properties), request IDs, structured completion logging, and public error envelopes shaped as `{ statusCode, code, message, requestId }`. Runtime errors do not expose database details or stack traces. Auth hashes passwords and refresh tokens with Argon2; its access and refresh JWTs use separate secrets.

Catalog's `POST /categories`, `POST /products`, and `PATCH /products/:id` are intentionally **unauthenticated temporary administration endpoints** in Phase 1. They must receive authorization before public production administration is enabled.

## Technical decisions

- [ADR 001: pnpm/Turborepo monorepo](docs/adr/001-monorepo.md)
- [ADR 002: logical database per service](docs/adr/002-database-per-service.md)
- [ADR 003: NestJS with Express](docs/adr/003-nestjs-express.md)
- [Phase 1 architecture](docs/architecture/phase-1.md)

## Phase 1 limits

Phase 1 intentionally excludes cart, orders, checkout/payments, notifications/messaging, dynamic gateway proxying, service-to-service authorization, catalog data in the storefront, Redis consumption, Kubernetes, Terraform, and production deployment. PostgreSQL database separation is logical: both databases run in the same local Compose PostgreSQL instance for development, while schemas, migrations, generated clients, and persistence code remain private to their owner services.

## Roadmap

1. **Phase 1 — Foundation:** this monorepo, local infrastructure, independent Auth/Catalog ownership, gateway health/docs, and a static storefront shell.
2. **Phase 2 — Service integration:** define gateway routing and make browser-facing Catalog reads use the chosen boundary.
3. **Phase 3 — Storefront data:** replace local featured-product fixtures with catalog-backed browsing and resilient client states.
4. **Phase 4 — Authorization:** introduce authenticated, role-controlled catalog administration and service-boundary authorization.
5. **Phase 5 — Cart and checkout:** model cart ownership and the checkout flow.
6. **Phase 6 — Orders and payments:** add order lifecycle and payment-provider integration.
7. **Phase 7 — Asynchronous capabilities:** add notifications, background work, and the needed messaging/Redis use cases.
8. **Phase 8 — Operations:** add observability, deployment automation, Kubernetes/Terraform where justified, and production hardening.
9. **Phase 9 — Scale and resilience:** evolve performance, reliability, security review, and multi-service operational practices from production evidence.

See [docs/architecture/phase-1.md](docs/architecture/phase-1.md) for the detailed Phase 1 boundary.
