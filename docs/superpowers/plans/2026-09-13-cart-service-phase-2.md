# Cart Service Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an authenticated Redis Cart Service, expose it only through the API Gateway, validate current variant data through Catalog, and add the minimal storefront Cart experience.

**Architecture:** Cart is a NestJS/Express internal service on port 3004. It validates Auth access JWTs locally, persists only temporary cart state through a small Redis repository, and invokes Catalog's private batch variant lookup with correlated HTTP requests. The existing Gateway proxy becomes the sole public Cart entry point; web calls it using only `NEXT_PUBLIC_API_GATEWAY_URL`.

**Tech Stack:** TypeScript, NestJS 11 / Express, `redis`, Passport JWT, `decimal.js`, Zod shared config, Jest, Supertest, Next.js and React.

**Spec:** `docs/superpowers/specs/2026-09-13-cart-service-phase-2-design.md`

## Global Constraints

- Do not add RabbitMQ, Kafka, Orders, inventory reservation, payments, notifications, Kubernetes, Terraform, service discovery, or Cart PostgreSQL persistence.
- Cart storage is Redis `cart:{userId}` with a 30-day (`2592000` seconds) TTL renewed only by mutations.
- The first current Catalog variant establishes Cart currency; a different subsequent currency is `409 CART_CURRENCY_MISMATCH`; an empty Cart has no currency.
- Catalog is the current source of product state, stock, price, and currency; Cart must not import Catalog persistence code or query `catalog_db`.
- Browser code can use only `NEXT_PUBLIC_API_GATEWAY_URL`; Cart and Catalog service URLs remain server-only environment variables.
- Preserve the existing `{ statusCode, code, message, requestId }` public error envelope and propagate valid `x-request-id` Gateway → Cart → Catalog.

---

### Task 1: Add the private Catalog variant lookup and shared response contracts

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/catalog-service/src/catalog/catalog.dto.ts`
- Modify: `apps/catalog-service/src/catalog/catalog.controller.ts`
- Modify: `apps/catalog-service/src/catalog/catalog.service.ts`
- Modify: `apps/catalog-service/test/app.e2e-spec.ts`
- Test: `apps/catalog-service/test/app.e2e-spec.ts`

**Interfaces:**
- Produces `InternalCatalogVariant`, `CartItemResponse`, and `CartResponse` shared API-only types.
- Produces `POST /internal/variants/batch` accepting `{ ids: string[] }` and returning `InternalCatalogVariant[]`.

- [ ] **Step 1: Write failing Catalog HTTP tests** for a batch containing active, inactive-product, inactive-variant, and unknown UUIDs. Assert exact projection and that `findMany` has `where: { id: { in: ids } }` with the product relation; assert bad, duplicate/oversized, or non-array payloads produce 400 before Prisma.
- [ ] **Step 2: Run the focused Catalog suite** with `pnpm --filter @nexo/catalog-service test -- app.e2e-spec.ts` and confirm the new route is absent.
- [ ] **Step 3: Define the narrow DTO and projection.** Add `BatchVariantsDto` with `@IsArray`, nonempty/bounded UUID validation and a `CatalogService.getInternalVariants(ids)` method. Map Prisma decimals with `toFixed(2)` and expose no SKU, timestamps, category, or Prisma-only fields.
- [ ] **Step 4: Add `@Post('internal/variants/batch')`** to Catalog's controller. It must be an internal service endpoint, not an addition to public product routes or Swagger.
- [ ] **Step 5: Re-run focused tests and contracts tests** with `pnpm --filter @nexo/catalog-service test -- app.e2e-spec.ts` and `pnpm --filter @nexo/contracts test`.
- [ ] **Step 6: Commit** with `feat(catalog): add internal variant batch lookup`.

### Task 2: Scaffold Cart Service with validated configuration, JWT boundary, Redis lifecycle, and tests

**Files:**
- Create: `apps/cart-service/package.json`, `tsconfig.json`, `tsconfig.test.json`, `jest.config.cjs`, `eslint.config.mjs`, `.env.example`, `README.md`
- Create: `apps/cart-service/src/main.ts`, `src/app.module.ts`, `src/common/environment.ts`, `src/common/http.ts`, `src/common/cart-domain.exception.ts`, `src/health/health.controller.ts`
- Create: `apps/cart-service/src/auth/jwt.strategy.ts`, `src/auth/auth.module.ts`
- Create: `apps/cart-service/src/cart/cart.repository.ts`, `src/cart/cart.module.ts`
- Test: `apps/cart-service/test/environment-spec.ts`, `test/app.e2e-spec.ts`, `test/cart.repository-spec.ts`
- Modify: `packages/config/src/index.ts`, `pnpm-lock.yaml`

**Interfaces:**
- Consumes Auth's existing `{ sub: UUID, type: 'access' }` HS256 JWT contract.
- Produces `CartEnvironment` with `PORT`, `REDIS_URL`, `CATALOG_SERVICE_URL`, and `JWT_ACCESS_SECRET`; `CartRepository.getCart/saveCart/deleteCart`; protected Cart service `/health` remains public only for local diagnostics.

- [ ] **Step 1: Add failing environment and repository tests.** Validate invalid Redis/Catalog URLs, missing/short JWT secret, bad port, JSON parse failure behavior, Redis key format, `EX 2592000` on save, and idempotent delete.
- [ ] **Step 2: Add direct dependencies** to the new workspace: the matching Nest/Express, validation, logger/config/contracts, Passport JWT versions plus `redis` and `decimal.js`; then run `pnpm install` to update the lockfile.
- [ ] **Step 3: Scaffold the app following Auth/Catalog conventions.** Configure Helmet, global ValidationPipe, UUID request IDs, structured completion logging, and a Cart exception filter that preserves Cart domain codes while sanitizing unexpected failures. Use no CORS.
- [ ] **Step 4: Implement validated environment and local JWT guard.** Require `REDIS_URL`, `CATALOG_SERVICE_URL`, and an Auth-compatible access secret; accept only unexpired HS256 access JWTs with UUID `sub`/`type: access`.
- [ ] **Step 5: Implement the small Redis repository.** Serialize `{ currency, items, updatedAt }`, use `set(key, value, { EX: 2_592_000 })`, return an empty Cart for no key, and delete the key for clears/final item deletion. Connect during startup and quit on shutdown.
- [ ] **Step 6: Re-run focused Cart scaffolding tests** with `pnpm --filter @nexo/cart-service test -- environment-spec.ts cart.repository-spec.ts app.e2e-spec.ts`.
- [ ] **Step 7: Commit** with `feat(cart): scaffold Redis-backed cart service`.

### Task 3: Implement Catalog client and Cart mutation/read domain behavior with TDD

**Files:**
- Create: `apps/cart-service/src/catalog/catalog.client.ts`
- Create: `apps/cart-service/src/cart/cart.dto.ts`, `src/cart/cart.service.ts`, `src/cart/cart.controller.ts`
- Modify: `apps/cart-service/src/cart/cart.module.ts`, `src/common/cart-domain.exception.ts`, `src/common/http.ts`
- Test: `apps/cart-service/test/app.e2e-spec.ts`, `test/cart.service-spec.ts`

**Interfaces:**
- Consumes `CartRepository`, `InternalCatalogVariant[]`, an authenticated `request.user.id`, and controller request ID.
- Produces `GET /cart`, `POST /cart/items`, `PATCH /cart/items/:variantId`, `DELETE /cart/items/:variantId`, and `DELETE /cart`; all require access JWTs.

- [ ] **Step 1: Write failing service/HTTP tests** for empty Cart; add; repeated add accumulation; invalid quantity; unknown/inactive product/inactive variant; insufficient stock; update/missing item; delete/clear idempotence; exact TTL renewal; Catalog timeout/body failure; decimal subtotal/total; and current Catalog price response.
- [ ] **Step 2: Add the single-currency cases before implementation.** Test first variant persists `currency`, a different-current-currency addition returns unchanged Cart plus `409 CART_CURRENCY_MISMATCH`, clearing/final deletion removes currency, and a new first variant after empty can choose another currency.
- [ ] **Step 3: Implement `CatalogClient.getVariants(ids, requestId)`.** POST JSON to `${CATALOG_SERVICE_URL}/internal/variants/batch`, send `x-request-id`, use a five-second AbortSignal, parse only a valid array, and map rejected connection, timeout, upstream 5xx, malformed JSON, or body interruption to `CATALOG_UNAVAILABLE`.
- [ ] **Step 4: Implement minimal Cart methods.** Read stored state, batch lookup existing/requested variants, enforce active/stock/currency constraints, mutate only after validation, and call repository save/delete exactly once. Do not reserve or decrement stock.
- [ ] **Step 5: Build `CartResponse` with `decimal.js`.** Preserve Catalog decimal strings, compute `price × quantity` and total without `number`, set `itemCount` as the sum of quantities, and return current per-item availability.
- [ ] **Step 6: Re-run Cart tests** with `pnpm --filter @nexo/cart-service test`; include a real Nest HTTP boundary with mocked Redis and controlled upstream server to prove JWT and request-ID behavior.
- [ ] **Step 7: Commit** with `feat(cart): validate cart variants against catalog`.

### Task 4: Route Cart solely through the existing API Gateway proxy

**Files:**
- Modify: `packages/config/src/index.ts`
- Modify: `apps/api-gateway/.env.example`, `src/common/environment.ts`
- Modify: `apps/api-gateway/src/common/http/internal-service-proxy.service.ts`, `internal-service-proxy.controller.ts`
- Modify: `apps/api-gateway/test/environment-spec.ts`, `test/service-proxy.e2e-spec.ts`, `test/app.e2e-spec.ts`

**Interfaces:**
- Consumes `CART_SERVICE_URL` and existing `InternalServiceProxy` forwarding behavior.
- Produces explicit public `/api/cart` and `/api/cart/items/:variantId` routes; Catalog `/internal/*` remains absent.

- [ ] **Step 1: Add failing Gateway tests** using a controlled Cart HTTP target. Assert method/path/query/body, `Authorization`, valid request ID, Swagger Cart paths, and safe `503 SERVICE_UNAVAILABLE` for refused, timed-out, and truncated Cart responses.
- [ ] **Step 2: Extend the existing `InternalService` union and target selection** with `cart`, taking its origin exclusively from validated `CART_SERVICE_URL`; do not create another proxy abstraction.
- [ ] **Step 3: Add only the five explicit Cart controller routes.** Map public `/api/cart...` to Cart's `/cart...` after existing `/api` removal and omit every Catalog internal route.
- [ ] **Step 4: Update Gateway env tests and Swagger assertions**, then run `pnpm --filter @nexo/api-gateway test`.
- [ ] **Step 5: Commit** with `feat(gateway): route authenticated cart traffic`.

### Task 5: Add the minimal Gateway-only storefront Cart flow

**Files:**
- Modify: `apps/web/lib/catalog.ts`, `components/product-grid.tsx`, `components/navbar.tsx`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`
- Create: `apps/web/lib/cart.ts`, `components/cart-provider.tsx`, `components/add-to-cart-button.tsx`, `components/cart-page.tsx`, `app/cart/page.tsx`
- Test: `apps/web/test/cart-client.spec.tsx`, `test/cart-page.spec.tsx`, update `test/catalog-client.spec.tsx`, `test/home.spec.tsx`

**Interfaces:**
- Consumes only `NEXT_PUBLIC_API_GATEWAY_URL` and the existing browser access-token key `nexo.access-token`.
- Produces product `variantId` data, add action, navigation quantity, and `/cart` controls backed by `/api/cart`.

- [ ] **Step 1: Write failing web tests.** Assert every Cart fetch starts with the configured Gateway URL and never contains `CART_SERVICE_URL`; test successful add updates count, Cart loading/empty/error/ready views, quantity update, item removal, clear, and missing-token 401 state.
- [ ] **Step 2: Extend the Catalog view model** with product ID and first active variant ID, preserving existing loading/empty/error behavior.
- [ ] **Step 3: Add a focused Cart HTTP client.** Use the Gateway URL helper, attach an `Authorization` bearer value from the `nexo.access-token` local-storage key only when present, use JSON bodies, and throw a typed client error from the Gateway envelope. It must never import internal URLs.
- [ ] **Step 4: Add a small client Cart provider and controls.** Load current Cart once, expose add/update/remove/clear with pending/error state, include a visually modest navigation count and an accessible `/cart` page.
- [ ] **Step 5: Re-run web tests** with `pnpm --filter @nexo/web test` and `pnpm --filter @nexo/web typecheck`.
- [ ] **Step 6: Commit** with `feat(web): add gateway-backed cart flow`.

### Task 6: Document Phase 2 and verify all boundaries end-to-end

**Files:**
- Create: `docs/architecture/phase-2.md`
- Modify: `README.md`, `.env.example`, `apps/cart-service/.env.example`, `apps/cart-service/README.md`
- Test: all changed service suites and root validation commands

**Interfaces:**
- Documents the public Gateway Cart API, Cart internal Redis shape, 30-day renewal rule, one-currency rule, current Catalog price rule, and the absence of reservation/Orders.

- [ ] **Step 1: Update Mermaid and setup documentation.** Include Browser → Web → Gateway → Cart, Cart → Redis, Cart → Catalog; document port 3004, all three internal Gateway service URLs, Cart runtime environment, no Cart PostgreSQL, no direct browser service access, and the `nexo.access-token` frontend prerequisite.
- [ ] **Step 2: Add explicit operational limitations.** Cart stock validation is advisory until future Order checkout; prices are current Catalog prices and Orders will snapshot them; inactive/unavailable Cart lines remain removable; no reservation is created.
- [ ] **Step 3: Run targeted suites** for Cart, Gateway, Catalog, and Web; then run `pnpm build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test`.
- [ ] **Step 4: Run Docker Compose validation** with `pnpm db:up`, verify Redis health, and run a manual token-backed flow through Gateway: register/login, catalog product, add, get, update, delete item, clear. Verify the same valid request ID reaches Gateway, Cart, and Catalog logs.
- [ ] **Step 5: Inspect `rg -n 'CART_SERVICE_URL|CATALOG_SERVICE_URL' apps/web`** and require no matches; run `git diff --check` and `git status --short`.
- [ ] **Step 6: Commit** with `docs: document phase 2 cart architecture`.
