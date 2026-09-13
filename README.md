# Nexo Commerce

Nexo Commerce is a TypeScript monorepo for an evolving commerce platform. Phase 1 establishes a locally runnable foundation: a Next.js storefront shell, a NestJS API gateway, independent Auth and Catalog services, and local PostgreSQL/Redis infrastructure.

## Architecture

```mermaid
flowchart LR
  Client[Browser / apps/web frontend\nNext.js] -->|public API| Gateway[apps/api-gateway\nNestJS + Express]
  Gateway -->|internal service calls| Auth[apps/auth-service\nNestJS + Express]
  Gateway -->|internal service calls| Catalog[apps/catalog-service\nNestJS + Express]

  Gateway --> Shared[packages/contracts\npackages/config\npackages/logger]
  Auth --> Shared
  Catalog --> Shared

  subgraph Postgres[PostgreSQL 16 container]
    AuthDB[(auth_db)]
    CatalogDB[(catalog_db)]
  end

  Auth --> AuthDB
  Catalog --> CatalogDB
  Redis[Redis 7\nInfrastructure available, no Phase 1 consumer]
```

Browser-facing application traffic goes only to the API Gateway, which is the entry point for Auth and Catalog. The Gateway forwards the existing Auth, Product, and Category HTTP routes to their owning services using internal REST URLs. Auth and Catalog are not browser API entry points; their direct local ports exist for service development and diagnostics only.

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
│   ├── api-gateway/       # public /api boundary, health/docs, Auth/Catalog proxy routes
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
pnpm dev
```

`pnpm db:up` starts PostgreSQL and Redis using the root `.env`. On a new Compose volume, PostgreSQL's init script creates `auth_db` and `catalog_db`; migrations then create the service-owned tables. Do not start the applications against an un-migrated database if you intend to use database-backed routes. `pnpm dev` starts the storefront on 3000, API gateway on 3003, Auth on 3001, and Catalog on 3002. The backend applications load their own app-local `.env` files; the web development server uses its default port 3000.

After startup, the local addresses are:

- Storefront: `http://localhost:3000`
- API gateway health: `http://localhost:3003/api/health`
- API gateway Swagger UI: `http://localhost:3003/api/docs`
- Auth health (direct local diagnostic only; not a browser API entry point): `http://localhost:3001/health`
- Catalog health (direct local diagnostic only; not a browser API entry point): `http://localhost:3002/health`

The health endpoints are liveness checks and intentionally do not query PostgreSQL. A successful health response is not evidence that migrations have been applied or that a live database operation has succeeded.

## Environment variables

Copy each example file rather than committing a real `.env` file. The validation in `@nexo/config` rejects malformed values; Auth also rejects identical access/refresh secrets and invalid JWT TTLs.

| Location | Variables | Purpose/default |
| --- | --- | --- |
| `.env` | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `REDIS_PORT` | Compose credentials and host ports. Defaults in `.env.example`: `nexo`, `nexo_local_password`, `5432`, `6379`. |
| `apps/api-gateway/.env` | `NODE_ENV`, `PORT`, `AUTH_SERVICE_URL`, `CATALOG_SERVICE_URL` | Gateway runtime; `PORT=3003`. The service URLs are required internal REST origins (the local examples use the Auth and Catalog ports). `NODE_ENV` accepts `development`, `test`, or `production`. |
| `apps/auth-service/.env` | `NODE_ENV`, `PORT`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL_SECONDS`, `JWT_REFRESH_TTL_SECONDS` | Auth runtime; `PORT=3001`, PostgreSQL `auth_db`, and TTL defaults of 900/604800 seconds. JWT secrets must be at least 32 characters and different. |
| `apps/catalog-service/.env` | `NODE_ENV`, `PORT`, `DATABASE_URL` | Catalog runtime; `PORT=3002` and PostgreSQL `catalog_db`. |
| `apps/web/.env` | `NEXT_PUBLIC_API_GATEWAY_URL` | Required public browser API origin; the local example is `http://localhost:3003/api`. The storefront uses it for Catalog data and does not know a Catalog Service URL. |

Normal Gateway starts load the `.env` in its application directory with `dotenv`; Auth and Catalog use `dotenv/config` for the same app-local behavior. Prisma operations need `DATABASE_URL` too. The root alias commands below run Prisma from the relevant service and read that service’s `.env`; use the explicit environment setup only when validating a schema directly from the root:

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
| `pnpm dev` | Run all workspace development scripts through Turbo: Web 3000, Gateway 3003, Auth 3001, and Catalog 3002 with copied app-local environment files. |
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
pnpm --filter @nexo/api-gateway start:dev
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
| API gateway | Public HTTP entry point; no service persistence | `GET /api/health`, Swagger at `/api/docs`, `/api/auth/*`, `/api/products/*`, and `/api/categories` |
| Auth service | `auth_db`, `User`, and `RefreshToken` data | Internal target for Gateway: `GET /health`, `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me` |
| Catalog service | `catalog_db`, `Category`, `Product`, and `ProductVariant` data | Internal target for Gateway: `GET /health`, `GET /products`, `GET /products/:slug`, `GET /categories`, `POST /categories`, `POST /products`, `PATCH /products/:id` |
| Web | Storefront presentation and public Gateway client | Home page; loading, empty, error, and ready product states from `GET /api/products` |

All backends use NestJS with Express. They apply Helmet, global DTO validation (`whitelist`, transformation, and rejection of unknown properties), request IDs, structured completion logging, and public error envelopes shaped as `{ statusCode, code, message, requestId }`. The Gateway alone enables browser CORS and forwards the request ID, `Authorization`, `Accept`, `Content-Type`, method, query string, and JSON body to its internal targets. An unavailable internal service becomes a Gateway `503 SERVICE_UNAVAILABLE` envelope without target details. Runtime errors do not expose database details or stack traces. Auth hashes passwords and refresh tokens with Argon2; its access and refresh JWTs use separate secrets.

Catalog's `POST /categories`, `POST /products`, and `PATCH /products/:id` are intentionally **unauthenticated temporary administration endpoints** in Phase 1. They must receive authorization before public production administration is enabled.

## Technical decisions

- [ADR 001: pnpm/Turborepo monorepo](docs/adr/001-monorepo.md)
- [ADR 002: logical database per service](docs/adr/002-database-per-service.md)
- [ADR 003: NestJS with Express](docs/adr/003-nestjs-express.md)
- [Phase 1 architecture](docs/architecture/phase-1.md)

## Phase 1 limits

Phase 1 intentionally excludes cart, orders, checkout/payments, notifications/messaging, service-to-service authorization, Redis consumption, Kubernetes, Terraform, and production deployment. PostgreSQL database separation is logical: both databases run in the same local Compose PostgreSQL instance for development, while schemas, migrations, generated clients, and persistence code remain private to their owner services.

## Roadmap

1. **Phase 1 — Foundation and integration:** this monorepo, local infrastructure, independent Auth/Catalog ownership, the Gateway public boundary, and catalog-backed storefront browsing.
2. **Phase 2 — Authorization:** introduce authenticated, role-controlled catalog administration and service-boundary authorization.
3. **Phase 3 — Cart and checkout:** model cart ownership and the checkout flow.
4. **Phase 4 — Orders and payments:** add order lifecycle and payment-provider integration.
5. **Phase 5 — Asynchronous capabilities:** add notifications, background work, and the needed messaging/Redis use cases.
6. **Phase 6 — Operations:** add observability, deployment automation, Kubernetes/Terraform where justified, and production hardening.
7. **Phase 7 — Scale and resilience:** evolve performance, reliability, security review, and multi-service operational practices from production evidence.

See [docs/architecture/phase-1.md](docs/architecture/phase-1.md) for the detailed Phase 1 boundary.
