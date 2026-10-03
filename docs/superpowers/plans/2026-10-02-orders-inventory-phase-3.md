# Orders & Inventory — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated, idempotent checkout that creates `PENDING` orders from the principal's Cart while Catalog atomically reserves inventory without overselling.

**Architecture:** Browser traffic remains `Next.js → API Gateway`; Gateway forwards checkout only to the internal Orders service. Orders owns durable idempotency, immutable snapshots, and recovery progress; Cart owns principal-scoped Redis claims and Catalog alone owns stock, reservation, publication, expiry, and admin stock protections. The Catalog row-locked `publish-order` transition is the checkout publication linearization point; neither RabbitMQ, payment capture, nor order confirmation is added.

**Tech Stack:** NestJS 11, TypeScript, Prisma/PostgreSQL 16, Redis 7 Lua scripts, Next.js, Jest/Supertest, Decimal.js, pnpm/Turbo.

**Spec:** `docs/superpowers/specs/2026-10-01-orders-inventory-phase-3-design.md`

## Global Constraints

- Keep the Gateway as the only public API; Orders, Cart private endpoints, and Catalog reservation endpoints are internal-only.
- Public checkout is `POST /api/checkout`; its body contains exactly one expected decimal price/currency per current Cart variant; require `Authorization` and `Idempotency-Key`.
- Preserve and propagate `x-request-id`; never log JWTs or complete cart contents.
- Preserve the existing HS256 access-JWT contract (`sub`, `type: access`, valid `exp`); do not add issuer/audience or Gateway-signed identity.
- Configure all service URLs and tokens through validated environment variables; do not hardcode hosts or ports. Orders uses port `3005` and `order_db`.
- Cart currency remains single-currency; price arithmetic uses exact decimal strings, never JavaScript `Number`; Phase 3 adds no taxes, discounts, or shipping.
- Catalog is the sole stock/reservation authority: `onHand >= reserved >= 0`, `available = onHand - reserved`; existing `stock` migrates to `onHand`, with `reserved = 0`.
- Reservation lifetime is exactly 15 minutes from Catalog UTC `reservedAt`; clients never set expiry.
- Successful checkout creates a visible `PENDING` order only after Catalog publication. Phase 3 has no `PENDING → CONFIRMED` transition, RabbitMQ, payments, notifications, or inventory reservation beyond Catalog reservations.
- Do not merge or push this branch automatically. Run `build`, `lint`, `typecheck`, all tests, and the real Docker E2E when the environment permits.

## Review Focus

- A Cart payload that expires and is later recreated must never reuse a version; Task 2 adds the counter-survival/race test.
- Two different checkout keys for one Cart version must not reserve or publish twice; Tasks 2–4 add concurrent claim and attempt tests.
- Expiry racing publication must have exactly one Catalog row-lock ordering (`PUBLISHED` or `RESERVATION_EXPIRED`); Task 3 adds the integration test.
- A replay after expiry must return the same order snapshot with current `EXPIRED`, not cached `PENDING`; Task 4 adds the replay test.
- A price change between Catalog read and reserve must make no reservation or order; Tasks 3, 4, and 6 add the contract, service, and browser reconfirmation tests.

---

## File structure

- `packages/config/src/index.ts` validates Orders/Gateway/Cart environment additions.
- `packages/contracts/src/index.ts` exposes checkout, reservation, and current-order response shapes shared by services and Web.
- `apps/cart-service/src/cart/*` owns versioned Redis data/claim scripts and private service-token checkout operations.
- `apps/catalog-service/prisma/*` and `src/catalog/*` own stock migration, reservation rows, publication/expiry, and guarded administration.
- `apps/orders-service/*` is the new service: Prisma schema, JWT boundary, clients, durable checkout/recovery, API, and tests.
- `apps/api-gateway/src/common/http/*` adds the Orders upstream and public Swagger route.
- `apps/web/lib/checkout.ts` and Cart UI use only `NEXT_PUBLIC_API_GATEWAY_URL` and implement expected-price checkout/reconfirmation.
- `docs/architecture/phase-3.md`, service READMEs, `.env.example` files, root Prisma scripts, and `README.md` document the working topology and local runbook.

### Task 1: Shared contracts, validated configuration, and Orders service shell

**Files:**
- Create: `apps/orders-service/{package.json,.env.example,jest.config.cjs,tsconfig.json,tsconfig.test.json}`
- Create: `apps/orders-service/src/{main.ts,app.module.ts,common/environment.ts,common/http.ts,health/health.controller.ts,prisma/prisma.service.ts}`
- Create: `apps/orders-service/prisma/schema.prisma`
- Modify: `packages/config/src/index.ts`, `packages/contracts/src/index.ts`, `.env.example`, `infra/docker/postgres/init-databases.sql`, `package.json`
- Test: `packages/config/src/*.spec.ts`, `apps/orders-service/test/{environment-spec.ts,app.e2e-spec.ts}`, `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Produces `parseOrdersEnvironment`, `OrdersEnvironment`, `CheckoutResponse`, `CheckoutPriceExpectation`, `OrderState`, and a bootable Orders `/health` endpoint.
- Consumes the existing config schemas, HTTP exception/filter conventions, logger, and generated Prisma client pattern.

- [ ] **Step 1: Write failing environment, contract, and health tests**

Assert `ORDERS_SERVICE_URL`, `CART_SERVICE_URL`, `CATALOG_SERVICE_URL`, `JWT_ACCESS_SECRET`, `CART_INTERNAL_SERVICE_TOKEN`, and `CATALOG_INTERNAL_TOKEN` are required/valid; assert a distinct 32+ character token policy; assert Orders `/health` returns the normal correlated service response. Assert checkout contracts use decimal strings and `PENDING | EXPIRED` only as public lifecycle values.

- [ ] **Step 2: Run the focused tests to verify failure**

Run: `pnpm --filter @nexo/orders-service test -- environment-spec app.e2e-spec` and `pnpm --filter @nexo/contracts test -- contracts.spec`

Expected: FAIL because Orders/config/contracts do not exist.

- [ ] **Step 3: Implement the minimal service shell and configuration**

Add `order_db` creation, root `orders:prisma:generate`/`orders:prisma:migrate` scripts, port `3005`, and typed environment parsing. Mirror Catalog's HTTP middleware/filter, health, Prisma lifecycle, package scripts, and test configuration; add contracts without browser-internal URLs.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm --filter @nexo/orders-service test -- environment-spec app.e2e-spec && pnpm --filter @nexo/orders-service typecheck && pnpm --filter @nexo/contracts test -- contracts.spec`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/config packages/contracts apps/orders-service .env.example infra/docker/postgres/init-databases.sql package.json
git commit -m "feat: scaffold orders service"
```

### Task 2: Cart persistent versions and private checkout claims

**Files:**
- Modify: `apps/cart-service/src/common/environment.ts`, `apps/cart-service/src/cart/{cart.repository.ts,cart.service.ts,cart.controller.ts,cart.dto.ts,cart.module.ts}`
- Create: `apps/cart-service/src/common/internal-cart-service.guard.ts`
- Modify: `apps/cart-service/test/{cart.repository-spec.ts,cart.service-spec.ts,app.e2e-spec.ts,cart-harness.ts,environment-spec.ts}` and `apps/cart-service/.env.example`

**Interfaces:**
- Produces private `POST /internal/v1/cart/read`, `/checkout-claims`, `/checkout-claims/complete`, and `/checkout-claims/release`, authenticated by `CART_INTERNAL_SERVICE_TOKEN` and carrying `{principalId, attemptId, version}`.
- Produces a `CartCheckoutSnapshot { version: number; lines: Array<{variantId: string; quantity: number}> }` and errors `CART_NOT_FOUND`, `CART_VERSION_CHANGED`, `CART_CHECKOUT_IN_PROGRESS`.
- Consumes only service identity for private calls; public routes remain JWT-only.

- [ ] **Step 1: Write failing Cart repository/service tests**

Test the three-key Lua behavior: `cart:data:{principal}`, persistent no-TTL `cart:version:{principal}`, and no-TTL `cart:claim:{principal}`. Cover payload expiry/recreation, two competing attempt IDs, same-attempt idempotency, edit rejection while claimed, complete/release binding checks, and `x-request-id`/invalid service-token rejection.

- [ ] **Step 2: Run focused Cart tests to verify failure**

Run: `pnpm --filter @nexo/cart-service test -- cart.repository-spec cart.service-spec app.e2e-spec environment-spec`

Expected: FAIL because the current single-key repository has no version/claim operations.

- [ ] **Step 3: Implement version and claim operations**

Replace the single-key mutation model with atomic Lua scripts over the data/version/claim keys. Seed/initialize a monotonic counter safely, preserve it across payload TTL expiry, persist active claims until terminal completion/release, and make every public mutation claim-aware. Add narrowly scoped private controller/service methods guarded by the Cart internal token; do not accept that token on public routes.

- [ ] **Step 4: Run focused Cart tests**

Run: `pnpm --filter @nexo/cart-service test -- cart.repository-spec cart.service-spec app.e2e-spec environment-spec && pnpm --filter @nexo/cart-service typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cart-service packages/config packages/contracts
git commit -m "feat(cart): add durable checkout claims"
```

### Task 3: Catalog available stock, reservations, publication, and expiry

**Files:**
- Create: `apps/catalog-service/prisma/migrations/<timestamp>_phase_3_inventory/migration.sql`, `apps/catalog-service/src/catalog/{reservation.service.ts,reservation.dto.ts,reservation-expiry.worker.ts}`
- Modify: `apps/catalog-service/prisma/schema.prisma`, `src/catalog/{catalog.controller.ts,catalog.dto.ts,catalog.service.ts,catalog.module.ts}`, `src/common/environment.ts`, `src/common/internal-service.guard.ts`, `.env.example`
- Modify: `apps/catalog-service/test/{app.e2e-spec.ts,environment-spec.ts}`

**Interfaces:**
- Produces authenticated internal variant lookup, `POST /internal/v1/reservations`, `POST /internal/v1/reservations/by-attempt/:attemptId/publish-order`, status lookup, and idempotent release.
- Produces `available`, canonical decimal prices, `reservedAt`, `expiresAt`, `publicationRevision`, and `RESERVATION_EXPIRED`/`CHECKOUT_PRICE_CHANGED` outcomes.
- Consumes `CATALOG_INTERNAL_TOKEN`, stable Orders `attemptId`, and `x-request-id`.

- [ ] **Step 1: Write failing reservation and admin-protection tests**

Cover the `onHand/reserved/available` migration projection; all-or-nothing concurrent reserve; stable attempt retry/mismatched-line conflict; price recheck in the reserve transaction; expiry/release exactly once; row-lock race yielding only `PUBLISHED` or `RESERVATION_EXPIRED`; status/revision recovery; and rejection of stock reduction, deletion, or variant replacement that violates a nonterminal reservation.

- [ ] **Step 2: Run focused Catalog tests to verify failure**

Run: `pnpm --filter @nexo/catalog-service test -- app.e2e-spec environment-spec`

Expected: FAIL because Catalog exposes only `stock` and batch lookup.

- [ ] **Step 3: Implement the Prisma migration and Catalog reservation boundary**

Migrate existing `stock` to `onHand` and initialize `reserved=0`; add durable reservation rows with exact decimal snapshots, publication metadata, and state. Use one PostgreSQL transaction/row-lock boundary for reserve, publish, release, expiry, and protected admin writes. `publish-order` transitions `ACTIVE → PUBLISHED` only before Catalog UTC expiry; the expiry worker locks the same row and emits/persists the authoritative later `PUBLISHED → EXPIRED` outcome. Keep all endpoints internal-token guarded and return only available stock to consumers.

- [ ] **Step 4: Run focused Catalog tests and Prisma generation**

Run: `pnpm --filter @nexo/catalog-service prisma:generate && pnpm --filter @nexo/catalog-service test -- app.e2e-spec environment-spec && pnpm --filter @nexo/catalog-service typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/catalog-service packages/contracts packages/config
git commit -m "feat(catalog): add inventory reservations"
```

### Task 4: Durable Orders checkout, recovery, and current-state replay

**Files:**
- Create: `apps/orders-service/src/{auth/jwt.strategy.ts,auth/auth.module.ts,checkout/{checkout.controller.ts,checkout.dto.ts,checkout.service.ts,checkout.repository.ts,checkout.module.ts,checkout-recovery.worker.ts},cart/cart.client.ts,catalog/catalog.client.ts,common/checkout-domain.exception.ts}`
- Create: `apps/orders-service/prisma/migrations/<timestamp>_checkout/migration.sql`
- Modify: `apps/orders-service/src/app.module.ts`, `apps/orders-service/prisma/schema.prisma`, `packages/contracts/src/index.ts`
- Create: `apps/orders-service/test/{checkout.service-spec.ts,checkout.repository-spec.ts,checkout.controller.e2e-spec.ts,checkout-harness.ts,jwt.strategy-spec.ts}`

**Interfaces:**
- Produces `POST /internal/v1/checkouts`, which verifies the current access JWT, requires `Idempotency-Key`, and returns `201 PENDING`, `200 PENDING|EXPIRED`, or `202 CHECKOUT_PROCESSING` for the same key.
- Consumes Cart private snapshot/claim/complete/release and Catalog reserve/publish/status/release interfaces from Tasks 2–3.
- Persists `checkout_attempts`, invisible `RECORDING` orders, immutable `order_lines`, and recovery metadata; no RabbitMQ producer/consumer.

- [ ] **Step 1: Write failing Orders domain and HTTP tests**

Test JWT spoofing rejection; request-hash reuse; duplicate-key concurrency; two keys racing one cart version; exact totals/currency; Cart and Catalog header propagation; failures that release claims only when safe; reserve/publish crash recovery; publication revision persistence; replay after expiry returning the same ID/snapshot with current `EXPIRED`; and no Phase 3 `CONFIRMED` transition.

- [ ] **Step 2: Run focused Orders tests to verify failure**

Run: `pnpm --filter @nexo/orders-service test -- checkout.service-spec checkout.repository-spec checkout.controller.e2e-spec jwt.strategy-spec`

Expected: FAIL because checkout modules do not exist.

- [ ] **Step 3: Implement the minimal saga and recovery worker**

Claim `(principalId, idempotencyKey)` before side effects; persist the stable request hash, Cart version, and `RECORDING` order. Reserve with exact expected prices, call Catalog `publish-order`, persist its revision, then make the order visible as `PENDING`; reconcile Catalog status before every replay. A lightweight internal worker scans durable nonterminal attempts and resumes only the same IDs. It must never create a new reservation/order for a retry, expose `RECORDING`, or mutate Catalog stock directly.

- [ ] **Step 4: Run focused Orders tests and Prisma generation**

Run: `pnpm --filter @nexo/orders-service prisma:generate && pnpm --filter @nexo/orders-service test -- checkout.service-spec checkout.repository-spec checkout.controller.e2e-spec jwt.strategy-spec && pnpm --filter @nexo/orders-service typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/orders-service packages/contracts
git commit -m "feat(orders): add idempotent checkout"
```

### Task 5: Gateway checkout route and Swagger contract

**Files:**
- Modify: `apps/api-gateway/src/common/{environment.ts,http/internal-service-proxy.service.ts,http/internal-service-proxy.controller.ts}`, `apps/api-gateway/.env.example`
- Modify: `packages/config/src/index.ts`, `apps/api-gateway/test/{environment-spec.ts,service-proxy.e2e-spec.ts,app.e2e-spec.ts}`

**Interfaces:**
- Produces public `POST /api/checkout` forwarded only to Orders `/internal/v1/checkouts`.
- Consumes `ORDERS_SERVICE_URL`; forwards `Authorization`, `Idempotency-Key`, JSON body, and generated/validated `x-request-id`.

- [ ] **Step 1: Write failing Gateway proxy tests**

Extend the upstream test server with Orders assertions for path, body, authorization, idempotency key, request ID, 201/200/202 forwarding, Swagger operation, and safe 503 on Orders timeout/unavailability.

- [ ] **Step 2: Run focused Gateway tests to verify failure**

Run: `pnpm --filter @nexo/api-gateway test -- service-proxy.e2e-spec environment-spec`

Expected: FAIL because `orders` is not a proxy target and `Idempotency-Key` is not forwarded.

- [ ] **Step 3: Implement the smallest proxy extension**

Add `orders` to the environment/type/target selection, forward `idempotency-key`, and expose only the typed `/api/checkout` controller route with Swagger status/error documentation. Preserve all existing Auth/Catalog/Cart paths and generic upstream safety behavior.

- [ ] **Step 4: Run focused Gateway tests and typecheck**

Run: `pnpm --filter @nexo/api-gateway test -- service-proxy.e2e-spec environment-spec && pnpm --filter @nexo/api-gateway typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api-gateway packages/config
git commit -m "feat(gateway): route checkout to orders"
```

### Task 6: Web checkout and price-reconfirmation UX

**Files:**
- Create: `apps/web/lib/checkout.ts`, `apps/web/test/checkout-client.spec.tsx`
- Modify: `apps/web/lib/cart.ts`, `apps/web/components/{cart-provider.tsx,cart-page.tsx}`, `apps/web/test/{cart-client.spec.tsx,cart-page.spec.tsx}`

**Interfaces:**
- Produces `checkout(expectedPrices): Promise<CheckoutResponse>` using only `publicGatewayUrl()` and a per-submit UUID `Idempotency-Key`.
- Consumes Cart item prices/currency and Gateway response codes `CHECKOUT_PRICE_CHANGED`, `EXPIRED`, and `CHECKOUT_PROCESSING`.

- [ ] **Step 1: Write failing browser tests**

Assert checkout fetches only `${NEXT_PUBLIC_API_GATEWAY_URL}/checkout`, sends each displayed `variantId/price/currency` once with auth/idempotency headers, disables duplicate submissions, renders `PENDING` with expiry, and refreshes/requires confirmation when `CHECKOUT_PRICE_CHANGED` returns canonical prices.

- [ ] **Step 2: Run focused Web tests to verify failure**

Run: `pnpm --filter @nexo/web test -- checkout-client.spec.tsx cart-page.spec.tsx cart-client.spec.tsx`

Expected: FAIL because the browser has no checkout client/UI.

- [ ] **Step 3: Implement the minimal Cart checkout control**

Derive expected prices from the currently rendered available Cart lines, call only the public Gateway URL, show pending/expiry or current expired status, and retain clear actionable price-reconfirmation state. Do not expose an internal service URL or add payment/confirmation UI.

- [ ] **Step 4: Run focused Web tests and typecheck**

Run: `pnpm --filter @nexo/web test -- checkout-client.spec.tsx cart-page.spec.tsx cart-client.spec.tsx && pnpm --filter @nexo/web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web packages/contracts
git commit -m "feat(web): add checkout flow"
```

### Task 7: Documentation, migration runbook, full verification, and E2E

**Files:**
- Create: `docs/architecture/phase-3.md`
- Modify: `README.md`, `docs/agents/status.md`, `apps/{api-gateway,cart-service,catalog-service,orders-service}/README.md`, all relevant `.env.example` files
- Test: root Turbo suite and a real Docker-backed checkout scenario documented in `README.md`

**Interfaces:**
- Produces an operator/developer runbook for `order_db`, Prisma migration order, five service ports, 15-minute reservation behavior, rollback/kill switch, and the Phase 3 limits.

- [ ] **Step 1: Write documentation checks and an executable E2E checklist**

Document commands that seed Catalog stock, create/login a customer, add Cart items, checkout via Gateway, replay the key, exercise price/stock failure, and observe expiry/recovery. State expected request IDs and current lifecycle responses.

- [ ] **Step 2: Update docs and Swagger references from the implemented contracts**

Describe `Web → Gateway → Orders → Cart/Catalog`, private service tokens, public API boundaries, database ownership, exact expiry/publish semantics, and explicit exclusions (RabbitMQ, payment, notifications, confirmation). Update the agent status only after verification evidence exists.

- [ ] **Step 3: Run all automated checks**

Run: `pnpm build && pnpm lint && pnpm typecheck && pnpm test`

Expected: all commands PASS; record the final test count/output in the completion note.

- [ ] **Step 4: Run Docker-backed E2E when Docker Desktop is available**

Run the documented migration/startup commands, then the real Gateway checkout flow and its idempotency/price/stock cases. If Docker is unavailable, record that limitation without claiming E2E passed.

- [ ] **Step 5: Commit**

```bash
git add README.md docs apps/*/.env.example apps/*/README.md package.json infra/docker/postgres/init-databases.sql
git commit -m "docs: document Phase 3 checkout"
```

## Self-review

- **Spec coverage:** Tasks 2–4 cover Cart claim durability, Catalog-owned inventory/reservations/publication, Orders state/recovery/idempotency, and no-oversell. Task 5 covers the public Gateway contract; Task 6 covers the Browser-only Gateway path and reconfirmation; Task 7 covers docs, migration, Swagger, full verification, and E2E.
- **Step scan:** Each task starts with a named failure condition, then focused execution, minimal implementation, verification, and a scoped commit.
- **Type consistency:** `CheckoutPriceExpectation`, `CheckoutResponse`, `CartCheckoutSnapshot`, stable `attemptId`, `orderId`, and `publicationRevision` are introduced before their consuming tasks.
- **Review focus:** Every listed risk is pinned to Tasks 2–4 or 6 with explicit test assertions.
- **Proportion:** The plan specifies interfaces, failure modes, and boundaries without prescribing implementation bodies or introducing Phase 4+ infrastructure.
