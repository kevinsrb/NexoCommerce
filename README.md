# Nexo Commerce

Nexo Commerce is a TypeScript monorepo for an evolving commerce platform. Phase 3 adds durable, idempotent checkout orchestration and Catalog-owned inventory reservations to the Phase 1/2 Gateway, Catalog, and Redis Cart foundation.

## Architecture

```mermaid
flowchart LR
  Client[Browser / apps/web frontend\nNext.js] -->|public API| Gateway[apps/api-gateway\nNestJS + Express]
  Gateway -->|internal service calls| Auth[apps/auth-service\nNestJS + Express]
  Gateway -->|internal service calls| Catalog[apps/catalog-service\nNestJS + Express]
  Gateway -->|internal service calls| Cart[apps/cart-service\nNestJS + Express]
  Gateway -->|internal service calls| Orders[apps/orders-service\nNestJS + Express]
  Cart -->|principal-scoped Cart state| Redis[(Redis 7)]
  Cart -->|internal batch lookup| Catalog
  Orders -->|private Cart claims| Cart
  Orders -->|private inventory reservations| Catalog

  Gateway --> Shared[packages/contracts\npackages/config\npackages/logger]
  Auth --> Shared
  Catalog --> Shared

  subgraph Postgres[PostgreSQL 16 container]
    AuthDB[(auth_db)]
    CatalogDB[(catalog_db)]
    OrderDB[(order_db)]
  end

  Auth --> AuthDB
  Catalog --> CatalogDB
  Orders --> OrderDB
```

Browser-facing application traffic goes only to the API Gateway, which is the entry point for Auth, Catalog, Cart, and Orders. The Gateway forwards the existing Auth, Product, Category, Cart, and Checkout HTTP routes to their owning services using internal REST URLs. Auth, Catalog, Cart, and Orders are not browser API entry points; their direct local ports exist for service development and diagnostics only.

## Stack

- pnpm workspaces and Turborepo
- TypeScript (strict), ESLint, Prettier, Jest, and Supertest
- Next.js App Router, React, and Tailwind CSS
- NestJS on the Express adapter, Swagger, Helmet, and Pino
- Prisma with PostgreSQL 16 and Redis 7 for temporary Cart state
- Docker Compose for local infrastructure

## Repository layout

```text
NexoCommerce/
├── apps/
│   ├── api-gateway/       # public /api boundary, health/docs, Auth/Catalog/Cart proxy routes
│   ├── auth-service/      # Auth API and private Prisma schema/migrations
│   ├── catalog-service/   # Catalog API and private Prisma schema/migrations
│   ├── cart-service/      # authenticated Redis-backed temporary cart
│   ├── orders-service/    # durable checkout attempts and order snapshots
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

Install a current Node.js release with Corepack/pnpm available, Docker Desktop (or another Docker engine with Compose), and Git. Open the repository root in PowerShell.

For the normal day-to-day workflow, run one command:

```powershell
pnpm local:up
```

It creates only missing `.env` files from their examples, installs dependencies only when `node_modules/.pnpm` is absent, checks local application ports, starts PostgreSQL and Redis through Docker Compose, waits for their health checks, confirms the Prisma migration status, then starts Web, Gateway, Auth, Catalog, Cart, and Orders through Turbo with hot reload. It never overwrites an existing `.env`, changes a port, or runs a migration automatically. Press `Ctrl+C` to stop every local application process; Docker infrastructure remains running until you run `pnpm local:down`.

On a new clone or after pulling a new committed Prisma migration, prepare the databases explicitly once before `local:up`:

```powershell
pnpm local:prepare
pnpm local:up
```

`local:prepare` starts healthy Docker infrastructure, generates the three Prisma clients, and uses `prisma migrate deploy` to apply only committed forward migrations. It does not reset or delete databases. The legacy Cart Redis migration is deliberately separate because it transforms existing Phase 2 data; stop Cart writes first, then run it only when upgrading such a dataset:

```powershell
pnpm --filter @nexo/cart-service migrate:keys
```

`pnpm local:infra` starts only PostgreSQL and Redis. If a configured application port is already occupied, `local:up` stops before launching applications. If a Compose port conflicts, Docker reports it; update the relevant values yourself in the root `.env` and the matching service `.env` (for example, set both `REDIS_PORT` and Cart `REDIS_URL` to `16379`). The scripts validate that local Redis/PostgreSQL URLs match the configured Compose ports rather than changing either file automatically.

After startup, the local addresses are:

- Storefront: `http://localhost:3000`
- API gateway health: `http://localhost:3003/api/health`
- API gateway Swagger UI: `http://localhost:3003/api/docs`
- Auth health (direct local diagnostic only; not a browser API entry point): `http://localhost:3001/health`
- Catalog health (direct local diagnostic only; not a browser API entry point): `http://localhost:3002/health`
- Cart health (direct local diagnostic only; not a browser API entry point): `http://localhost:3004/health`
- Orders health (direct local diagnostic only; not a browser API entry point): `http://localhost:3005/health`

The health endpoints are liveness checks and intentionally do not query PostgreSQL. A successful health response is not evidence that migrations have been applied or that a live database operation has succeeded.

## Environment variables

Copy each example file rather than committing a real `.env` file. The validation in `@nexo/config` rejects malformed values; Auth also rejects identical access/refresh secrets and invalid JWT TTLs.

| Location | Variables | Purpose/default |
| --- | --- | --- |
| `.env` | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `REDIS_PORT` | Compose credentials and host ports. Defaults in `.env.example`: `nexo`, `nexo_local_password`, `5432`, `6379`. The service URLs/tokens in that example are shared local values, not Compose configuration. |
| `apps/api-gateway/.env` | `NODE_ENV`, `PORT`, `AUTH_SERVICE_URL`, `CATALOG_SERVICE_URL`, `CART_SERVICE_URL`, `ORDERS_SERVICE_URL`, `CHECKOUT_ENABLED` | Gateway runtime; `PORT=3003`. The service URLs are required internal REST origins (the local examples use ports 3001/3002/3004/3005). `CHECKOUT_ENABLED` defaults to `false`; set it explicitly to `true` only after the Catalog, Orders, and Cart migrations/health checks are complete. `NODE_ENV` accepts `development`, `test`, or `production`. |
| `apps/auth-service/.env` | `NODE_ENV`, `PORT`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CATALOG_ADMIN_SECRET`, `JWT_ACCESS_TTL_SECONDS`, `JWT_REFRESH_TTL_SECONDS` | Auth runtime; `PORT=3001`, PostgreSQL `auth_db`, TTL defaults of 900/604800 seconds, and a separate secret for the signed Catalog ADMIN proof. JWT secrets must be at least 32 characters and different. |
| `apps/catalog-service/.env` | `NODE_ENV`, `PORT`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `CATALOG_INTERNAL_TOKEN`, `CATALOG_ADMIN_SECRET` | Catalog runtime; `PORT=3002`, PostgreSQL `catalog_db`, Auth-compatible access secret, Orders/Cart-to-Catalog service credential, and the Auth-only ADMIN proof secret. |
| `apps/cart-service/.env` | `NODE_ENV`, `PORT`, `REDIS_URL`, `CATALOG_SERVICE_URL`, `JWT_ACCESS_SECRET`, `CATALOG_INTERNAL_TOKEN`, `CART_INTERNAL_SERVICE_TOKEN` | Cart runtime; `PORT=3004`, Redis, Catalog's internal origin, Auth-compatible access secret, Catalog credential, and the distinct Orders-to-Cart credential. Cart has no PostgreSQL database. |
| `apps/orders-service/.env` | `NODE_ENV`, `PORT`, `DATABASE_URL`, `CART_SERVICE_URL`, `CATALOG_SERVICE_URL`, `JWT_ACCESS_SECRET`, `CART_INTERNAL_SERVICE_TOKEN`, `CATALOG_INTERNAL_TOKEN` | Orders runtime; `PORT=3005`, PostgreSQL `order_db`, internal Cart/Catalog origins, local Auth-compatible JWT secret, and distinct private service credentials. |
| `apps/web/.env` | `NEXT_PUBLIC_API_GATEWAY_URL` | Required public browser API origin; the local example is `http://localhost:3003/api`. The storefront uses it for Catalog data and does not know a Catalog Service URL. |

Normal Gateway starts load the `.env` in its application directory with `dotenv`; Auth, Catalog, Cart, and Orders use `dotenv/config` for the same app-local behavior. Prisma operations need `DATABASE_URL` too. The root alias commands below run Prisma from the relevant service and read that service’s `.env`; use the explicit environment setup only when validating a schema directly from the root:

```powershell
# Auth schema validation from the repository root (does not contact PostgreSQL)
$env:DATABASE_URL = 'postgresql://nexo:nexo_local_password@localhost:5432/auth_db?schema=public'
pnpm --filter @nexo/auth-service exec prisma validate --schema prisma/schema.prisma
Remove-Item Env:DATABASE_URL

# Catalog schema validation from the repository root (does not contact PostgreSQL)
$env:DATABASE_URL = 'postgresql://nexo:nexo_local_password@localhost:5432/catalog_db'
pnpm --filter @nexo/catalog-service exec prisma validate --schema prisma/schema.prisma
Remove-Item Env:DATABASE_URL

# Orders schema validation from the repository root (does not contact PostgreSQL)
$env:DATABASE_URL = 'postgresql://nexo:nexo_local_password@localhost:5432/order_db'
pnpm --filter @nexo/orders-service exec prisma validate --schema prisma/schema.prisma
Remove-Item Env:DATABASE_URL
```

Run `pnpm auth:prisma:migrate`, `pnpm catalog:prisma:migrate`, and `pnpm orders:prisma:migrate` only after PostgreSQL is running, against their intended local service databases. They use committed migrations and do contact the database.

## Commands

Run these root commands from the repository root:

| Command | Meaning |
| --- | --- |
| `pnpm dev` | Run all workspace development scripts through Turbo: Web 3000, Gateway 3003, Auth 3001, Catalog 3002, Cart 3004, and Orders 3005 with copied app-local environment files. |
| `pnpm local:up` | Daily full-stack entry point: create missing config, install only missing dependencies, start/health-check Compose infrastructure, confirm migration status, and run all apps with hot reload. It never deploys migrations. |
| `pnpm local:prepare` | Explicit one-time/per-migration preparation: start infrastructure, generate Prisma clients, and deploy committed forward migrations without resetting data. |
| `pnpm local:infra` | Create missing local configuration (and restore missing workspace dependencies if needed), then start only PostgreSQL and Redis through Compose. |
| `pnpm local:down` | Stop and remove only this project's Compose containers; named volumes remain. |
| `pnpm dev:web`, `pnpm dev:gateway`, `pnpm dev:auth`, `pnpm dev:catalog`, `pnpm dev:cart`, `pnpm dev:orders` | Start just one selected application with hot reload. Run `pnpm local:infra` first when its dependencies are needed. |
| `pnpm test:local` | Test the local-environment orchestration safeguards. |
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
| `pnpm orders:prisma:generate` | Generate the Orders service Prisma client. |
| `pnpm orders:prisma:migrate` | Apply committed Orders migrations to the configured `order_db`. |
| `pnpm --filter @nexo/cart-service migrate:keys` | Atomically migrate valid legacy Phase 2 Redis Cart keys; run with Cart writes stopped. |

Useful individual commands:

```powershell
pnpm --filter @nexo/web dev
pnpm --filter @nexo/api-gateway start:dev
pnpm --filter @nexo/auth-service dev
pnpm --filter @nexo/catalog-service dev
pnpm --filter @nexo/cart-service dev
pnpm --filter @nexo/orders-service dev

pnpm --filter @nexo/web build
pnpm --filter @nexo/api-gateway test
pnpm --filter @nexo/auth-service typecheck
pnpm --filter @nexo/catalog-service lint
```

## Services and boundaries

| Service | Owns | Routes |
| --- | --- | --- |
| API gateway | Public HTTP entry point; no service persistence | `GET /api/health`, Swagger at `/api/docs`, Auth/Catalog/Cart routes, and `POST /api/checkout` |
| Auth service | `auth_db`, `User`, and `RefreshToken` data | Internal target for Gateway: `GET /health`, `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me` |
| Catalog service | `catalog_db`, products, variants, inventory, and stock reservations | Internal target for Gateway: product/category routes; private Cart/Orders variant and reservation APIs |
| Cart service | Redis `cart:data:{principalId}`, durable `cart:version:{principalId}`, and checkout claims | Direct diagnostics: `GET /health`; Gateway-proxied Cart routes and Orders-only claim operations |
| Orders service | `order_db`, checkout attempts, immutable order/line snapshots, and recovery progress | Direct diagnostics: `GET /health`; Gateway target only at `POST /internal/v1/checkouts` |
| Web | Storefront presentation and public Gateway client | Product states from `GET /api/products`; Gateway-backed cart and checkout at `/cart` |

All backends use NestJS with Express. They apply Helmet, global DTO validation (`whitelist`, transformation, and rejection of unknown properties), request IDs, structured completion logging, and public error envelopes shaped as `{ statusCode, code, message, requestId }`. The Gateway alone enables browser CORS and forwards the request ID, `Authorization`, `Accept`, `Content-Type`, method, query string, and JSON body to its internal targets. An unavailable internal service becomes a Gateway `503 SERVICE_UNAVAILABLE` envelope without target details. Runtime errors do not expose database details or stack traces. Auth hashes passwords and refresh tokens with Argon2; its access and refresh JWTs use separate secrets.

Cart validates Auth access JWTs locally, stores a principal-scoped Cart with a non-reusable version and active checkout claim in Redis, and batch-validates current variant state through Catalog. Cart-to-Catalog calls send the configured service credential and preserve the Gateway request ID. Catalog administration additionally requires an Auth-issued ADMIN proof signed with the separate `CATALOG_ADMIN_SECRET`, which Cart never receives. A Cart has one currency and uses current Catalog prices. A live checkout claim prevents Cart edits; Orders alone can complete or release it using `CART_INTERNAL_SERVICE_TOKEN`.

Catalog's `POST /categories`, `POST /products`, `PATCH /products/:id`, and `PATCH /variants/:variantId/stock` require an Auth-issued ADMIN JWT through the Gateway. Public Catalog GET routes remain unauthenticated. Catalog alone owns available inventory (`onHand - reserved`) and atomically creates, publishes, releases, and expires reservations. Orders owns idempotency and snapshots but does not mutate Catalog stock.

For checkout, the browser submits the displayed decimal prices to `POST /api/checkout` with a JWT and `Idempotency-Key`. Gateway validates/generates `x-request-id`, forwards it with the JWT/key to `POST /internal/v1/checkouts` in Orders, and Orders propagates the same request ID to Cart and Catalog. A first accepted publication returns `201 PENDING`; same-key replay returns `200` with the order's current `PENDING` or `EXPIRED` state; uncertain recovery returns `202 CHECKOUT_PROCESSING`. Price, Cart-version, stock, or reservation conflicts are explicit 409/422 responses. See [Phase 3 architecture and E2E runbook](docs/architecture/phase-3.md).

## Technical decisions

- [ADR 001: pnpm/Turborepo monorepo](docs/adr/001-monorepo.md)
- [ADR 002: logical database per service](docs/adr/002-database-per-service.md)
- [ADR 003: NestJS with Express](docs/adr/003-nestjs-express.md)
- [Phase 1 architecture](docs/architecture/phase-1.md)
- [Phase 2 architecture](docs/architecture/phase-2.md)
- [Phase 3 architecture and runbook](docs/architecture/phase-3.md)

## Phase 3 limits

Phase 3 intentionally excludes payment authorization/capture, tax, discounts, shipping, fulfillment, returns, public order-management APIs, inventory receiving, notifications, message brokers, and cross-service distributed transactions. Checkout does not confirm an order: its visible state is `PENDING` until its Catalog reservation expires. PostgreSQL separation remains logical: `auth_db`, `catalog_db`, and `order_db` share one local PostgreSQL 16 container, while schemas, migrations, generated clients, and persistence code remain private to their owners.

## Roadmap

1. **Phase 1 — Foundation and integration:** this monorepo, local infrastructure, independent Auth/Catalog ownership, the Gateway public boundary, and catalog-backed storefront browsing.
2. **Phase 2 — Cart:** authenticated Redis-backed cart, Gateway-only access, and current Catalog validation.
3. **Phase 3 — Checkout and inventory reservations:** durable idempotent checkout, Cart claims, and Catalog-owned 15-minute reservations.
4. **Phase 4 — Events:** consider asynchronous integration only when a concrete need is approved.
5. **Phase 5 — Payments:** add payment-provider integration and any future confirmation transition.
6. **Phase 6 — Operations:** add observability, deployment automation, Kubernetes/Terraform where justified, and production hardening.
7. **Phase 7 — Scale and resilience:** evolve performance, reliability, security review, and multi-service operational practices from production evidence.

See the [Phase 1](docs/architecture/phase-1.md), [Phase 2](docs/architecture/phase-2.md), and [Phase 3](docs/architecture/phase-3.md) architecture notes for detailed boundaries.
