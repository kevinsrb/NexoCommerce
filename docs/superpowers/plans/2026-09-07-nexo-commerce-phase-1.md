# Nexo Commerce Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable Nexo Commerce monorepo phase: storefront shell, gateway, Auth, Catalog, local infrastructure, quality checks, and documentation.

**Architecture:** pnpm/Turbo orchestrates independent Next.js and NestJS/Express applications. Shared source packages limit reuse to contracts, config validation, logging, lint/TS presets, and test helpers. Auth and Catalog retain separate Prisma schemas and databases while a Compose PostgreSQL server provisions both.

**Tech Stack:** pnpm workspaces, Turborepo, Next.js App Router, Tailwind CSS, NestJS/Express, Prisma/PostgreSQL, Pino, Zod, Jest, Supertest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-07-nexo-commerce-phase-1-design.md`

## Global Constraints

- Use NestJS with `@nestjs/platform-express` and `NestFactory.create(AppModule)`; do not install Fastify.
- Keep TypeScript strict and avoid `any`; use DTOs, Nest DI, guards, pipes, interceptors, and filters where appropriate.
- Do not implement carts, orders, payments, notifications, RabbitMQ, Kubernetes, Terraform, dynamic gateway proxying, or shared persistence.
- Keep Prisma schemas, generated clients, migrations, and repositories private to each owning backend service.
- All public backend errors use `{ statusCode, code, message, requestId }`; production responses never disclose stack traces.

---

### Task 1: Create workspace, tooling, and local infrastructure

**Files:**
- Create: root workspace manifests, `turbo.json`, `.gitignore`, `.env.example`, `docker-compose.yml`, `infra/docker/postgres/init-databases.sql`
- Create: `packages/contracts`, `packages/config`, `packages/logger`, `packages/eslint-config`, `packages/typescript-config`, and `packages/testing`

**Interfaces:**
- Produces workspace imports `@nexo/contracts`, `@nexo/config`, `@nexo/logger`, and `@nexo/testing`.
- Produces root commands `dev`, `build`, `lint`, `test`, `typecheck`, `db:up`, `db:down`, and service-scoped Prisma commands.

- [ ] **Step 1: Write a failing workspace smoke test**

Create `packages/contracts/src/contracts.spec.ts` that imports `ApiError` and asserts a typed error can be constructed.

- [ ] **Step 2: Run the test to verify the missing package fails**

Run: `pnpm --filter @nexo/contracts test`

Expected: failure because the package and test runner do not exist.

- [ ] **Step 3: Implement the minimal workspace and shared packages**

Define root scripts and Turbo pipeline, strict shared TS configuration, reusable ESLint/Prettier configuration, `ApiError`/health contract types, Zod configuration parsers, Pino logger helpers, and Jest test utilities. Add Compose PostgreSQL and Redis with persistent volumes, health checks, and SQL initialization for `auth_db`/`catalog_db`.

- [ ] **Step 4: Run workspace checks**

Run: `pnpm --filter @nexo/contracts test && docker compose config`

Expected: contracts test passes and Compose configuration prints without errors.

### Task 2: Build the shared NestJS HTTP foundation and API gateway

**Files:**
- Create: `apps/api-gateway/src/main.ts`, `app.module.ts`, `health/*`, `common/http/*`, and `test/*`
- Create: `apps/api-gateway/package.json`, TypeScript/Jest configuration, and `.env.example`

**Interfaces:**
- Consumes `@nexo/config`, `@nexo/contracts`, and `@nexo/logger`.
- Produces `GET /api/health` and Swagger UI at `/api/docs`.

- [ ] **Step 1: Write the failing HTTP boundary tests**

Create Supertest cases asserting `GET /api/health` returns `{ status: 'ok', service: 'api-gateway' }`, carries an `x-request-id` response header, and malformed payloads receive the standard error shape.

- [ ] **Step 2: Run gateway tests to verify failure**

Run: `pnpm --filter @nexo/api-gateway test`

Expected: failure because the gateway module is absent.

- [ ] **Step 3: Implement the Express Nest bootstrap and HTTP cross-cutting concerns**

Bootstrap with `NestFactory.create(AppModule)`, configure Helmet/CORS/Swagger/global `ValidationPipe`, request-id middleware, Pino request logging interceptor, and the exception filter. Register the prefixed health controller and keep an empty integration boundary module rather than a proxy engine.

- [ ] **Step 4: Run the focused gateway checks**

Run: `pnpm --filter @nexo/api-gateway test && pnpm --filter @nexo/api-gateway typecheck`

Expected: all gateway tests and strict compilation pass.

### Task 3: Implement Auth ownership, endpoints, and tests

**Files:**
- Create: `apps/auth-service/prisma/schema.prisma`, `src/prisma/*`, `src/auth/*`, `src/common/*`, `src/health/*`, `test/*`, package/tooling files, and `.env.example`

**Interfaces:**
- Consumes Auth environment parser and local `PrismaService`.
- Produces `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`, and `GET /health`.
- Produces access/refresh token response `{ accessToken, refreshToken, user }`, with public user fields only.

- [ ] **Step 1: Write failing Auth service and endpoint tests**

Use mocked Prisma methods in a Nest testing module to assert registration hashes passwords and returns a safe user, existing email throws conflict, login emits tokens for a verified password, and an invalid password throws unauthorized.

- [ ] **Step 2: Run Auth tests to verify failure**

Run: `pnpm --filter @nexo/auth-service test`

Expected: failure because Auth service/module does not exist.

- [ ] **Step 3: Implement the local Auth module**

Add Prisma schema/migration scaffold, DTOs, `AuthService`, controller, JWT strategy/guard, Argon2 hashing, refresh-token hashing and rotation, request validation, and the conventional Express Nest bootstrap. Wire global error/request logging behavior locally so Auth remains independently runnable.

- [ ] **Step 4: Run Auth checks**

Run: `pnpm --filter @nexo/auth-service test && pnpm --filter @nexo/auth-service typecheck && pnpm auth:prisma:generate`

Expected: four required Auth scenarios pass, strict typechecking passes, and Prisma client generation completes.

### Task 4: Implement Catalog ownership, public/admin endpoints, and tests

**Files:**
- Create: `apps/catalog-service/prisma/schema.prisma`, `src/prisma/*`, `src/catalog/*`, `src/common/*`, `src/health/*`, `test/*`, package/tooling files, and `.env.example`

**Interfaces:**
- Consumes Catalog environment parser and a local `PrismaService`.
- Produces public `GET /products`, `GET /products/:slug`, `GET /categories`, `/health`, plus temporary unauthenticated `POST /products`, `PATCH /products/:id`, and `POST /categories` administration endpoints.

- [ ] **Step 1: Write failing Catalog service and endpoint tests**

Use a mocked local Prisma dependency to assert product creation, slug detail retrieval, and list retrieval return the expected public product shape.

- [ ] **Step 2: Run Catalog tests to verify failure**

Run: `pnpm --filter @nexo/catalog-service test`

Expected: failure because Catalog service/module does not exist.

- [ ] **Step 3: Implement the local Catalog module**

Add independent Prisma schema/migration scaffold; category/product/variant DTOs; local Prisma repository service; public and temporary-admin controllers; Nest/Express security/validation/error/logging bootstrap; and health response.

- [ ] **Step 4: Run Catalog checks**

Run: `pnpm --filter @nexo/catalog-service test && pnpm --filter @nexo/catalog-service typecheck && pnpm catalog:prisma:generate`

Expected: three required Catalog scenarios pass, strict typechecking passes, and Prisma client generation completes.

### Task 5: Build the Phase 1 web shell

**Files:**
- Create: `apps/web/app/*`, `apps/web/components/*`, `apps/web/package.json`, Next/Tailwind configuration, and `.env.example`

**Interfaces:**
- Produces a responsive App Router page with navbar, hero, product presentation, loading, empty, and error UI states.

- [ ] **Step 1: Write a failing component render test**

Create a React test that renders the home page and asserts the navigation label, hero heading, and product-state headings are visible.

- [ ] **Step 2: Run the web test to verify failure**

Run: `pnpm --filter @nexo/web test`

Expected: failure because the web application is absent.

- [ ] **Step 3: Implement the minimal dark storefront**

Configure Next.js App Router, strict TypeScript and Tailwind. Build focused navbar, hero, product grid, and product-state components; use local data only and preserve an integration seam for a future catalog client.

- [ ] **Step 4: Run web checks**

Run: `pnpm --filter @nexo/web test && pnpm --filter @nexo/web build && pnpm --filter @nexo/web typecheck`

Expected: the page test, production build, and strict typechecking pass.

### Task 6: Write project documentation and validate the assembled monorepo

**Files:**
- Create: `README.md`, `docs/architecture/phase-1.md`, `docs/adr/001-monorepo.md`, `docs/adr/002-database-per-service.md`, and `docs/adr/003-nestjs-express.md`

**Interfaces:**
- Documents local setup, required environment variables, operating commands, decisions, scope boundary, and Phase 2–9 roadmap.

- [ ] **Step 1: Add a documentation accuracy test**

Create a lightweight test or script that checks the README contains every documented root command and each ADR title.

- [ ] **Step 2: Run it to verify missing documentation fails**

Run: `pnpm test -- --runInBand`

Expected: documentation assertion fails until the required files and command references exist.

- [ ] **Step 3: Implement documentation**

Write the professional README with Mermaid architecture diagram, stack, tree, commands, environment variables, setup, services, technical decisions, scope limits, and full roadmap. Record the requested monorepo, database-per-service, and NestJS+Express ADR context/decision/consequences.

- [ ] **Step 4: Run final verification**

Run: `pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test && docker compose config`

Expected: every command completes successfully. Then attempt `docker compose up -d` when Docker is available and inspect service health.
