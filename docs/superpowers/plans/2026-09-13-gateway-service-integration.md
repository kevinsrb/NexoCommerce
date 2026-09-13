# Gateway Service Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route browser-facing Auth, Product, and Category API calls through the API Gateway and load storefront products through that public Gateway URL.

**Architecture:** The Gateway parses two required internal service origins and uses one HTTP forwarding service behind explicit Nest controller routes. The web client fetches Catalog data only through a public Gateway environment variable and maps it to the existing product-state UI.

**Tech Stack:** NestJS 11 on Express, Node.js built-in `fetch`, Next.js 15, React 19, Jest, Supertest, TypeScript, Zod.

**Spec:** `docs/superpowers/specs/2026-09-13-gateway-service-integration-design.md`

## Global Constraints

- Browser-facing API traffic uses only `/api` on the API Gateway.
- `AUTH_SERVICE_URL` and `CATALOG_SERVICE_URL` are required Gateway environment variables; production code contains no service host or port literal.
- Gateway forwards `x-request-id` to internal services and returns a safe 503 envelope when an upstream is unavailable.
- Auth and Catalog keep their separate Prisma schemas and logical PostgreSQL databases.
- Do not add RabbitMQ, Cart, a shared persistence layer, or speculative proxy abstractions.
- Complete `pnpm build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` before reporting completion.

---

### Task 1: Configure and test Gateway service forwarding

**Files:**
- Create: `apps/api-gateway/src/common/http/internal-service-proxy.service.ts`
- Create: `apps/api-gateway/src/common/http/internal-service-proxy.controller.ts`
- Create: `apps/api-gateway/test/service-proxy.e2e-spec.ts`
- Modify: `packages/config/src/index.ts`
- Modify: `apps/api-gateway/src/common/environment.ts`
- Modify: `apps/api-gateway/src/common/http/integration-boundary.module.ts`
- Modify: `apps/api-gateway/src/common/http/http-exception.filter.ts`
- Modify: `apps/api-gateway/.env.example`
- Modify: `apps/api-gateway/test/app.e2e-spec.ts`
- Modify: `apps/api-gateway/test/environment-spec.ts`

**Interfaces:**
- Consumes: the existing Express request ID middleware and `{ statusCode, code, message, requestId }` public error envelope.
- Produces: `InternalServiceProxy.forward(request, response, service)` and documented `/api/auth/*`, `/api/products/*`, and `/api/categories` routes.

- [ ] **Step 1: Write failing Gateway forwarding tests**

Create controlled Auth and Catalog HTTP servers in `service-proxy.e2e-spec.ts`. Assert that `POST /api/auth/login` reaches `/auth/login`, `GET /api/products?limit=1` reaches `/products?limit=1`, a valid inbound request ID reaches the internal server unchanged, and an unavailable target returns the literal safe 503 envelope.

- [ ] **Step 2: Run the new Gateway test to verify it fails**

Run: `pnpm --filter @nexo/api-gateway test -- service-proxy.e2e-spec.ts`

Expected: the public proxy routes return 404 because they do not exist yet.

- [ ] **Step 3: Implement the minimum forwarding boundary**

Extend the configuration package with a Gateway schema requiring `AUTH_SERVICE_URL` and `CATALOG_SERVICE_URL`. Inject that parsed environment into one proxy service. Build target URLs from those values, forward the allowed headers, body, method, query string, and request ID using Node `fetch`, then pass upstream status/body/content type through Express. Convert `fetch` connection or timeout failures to `ServiceUnavailableException('Internal service unavailable')`. Add 503 to the Gateway error-code map and explicit controllers for existing Auth/Catalog routes with Swagger tags and operations.

- [ ] **Step 4: Run the Gateway tests to verify they pass**

Run: `pnpm --filter @nexo/api-gateway test`

Expected: all Gateway tests pass, including forwarding, request-ID correlation, unavailable service response, and Swagger availability.

- [ ] **Step 5: Commit the Gateway boundary**

```powershell
git add packages/config apps/api-gateway
git commit -m "feat(gateway): proxy auth and catalog routes"
```

### Task 2: Replace storefront fixtures with public Gateway data

**Files:**
- Create: `apps/web/components/product-catalog.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/lib/catalog.ts`
- Modify: `apps/web/components/product-states.tsx`
- Modify: `apps/web/.env.example`
- Modify: `apps/web/test/home.spec.tsx`
- Create: `apps/web/test/catalog-client.spec.tsx`

**Interfaces:**
- Consumes: public `GET /api/products` Catalog response through `NEXT_PUBLIC_API_GATEWAY_URL`.
- Produces: `loadCatalogProducts(): Promise<StorefrontProduct[]>` and a `ProductCatalog` component that renders the existing ready, empty, and error states.

- [ ] **Step 1: Write failing storefront boundary tests**

Mock the browser `fetch` boundary with a complete Catalog product response. Assert `loadCatalogProducts` requests the literal configured public Gateway URL plus `/products`, never a Catalog URL, and maps the first active variant price. Assert `ProductCatalog` renders ready data, empty data, and a fetch failure through the existing state cards.

- [ ] **Step 2: Run the new storefront test to verify it fails**

Run: `pnpm --filter @nexo/web test -- catalog-client.spec.tsx`

Expected: the client boundary and component imports do not exist.

- [ ] **Step 3: Implement the minimum public storefront client**

Replace fixture exports with a Gateway-only catalog client that reads `NEXT_PUBLIC_API_GATEWAY_URL` at request time and uses `fetch`. Add a small client component that loads once, selects ready/empty/error state, and passes mapped products to `ProductStates`. Render that component from the home page and change the example environment variable to the Gateway public API URL.

- [ ] **Step 4: Run the web tests to verify they pass**

Run: `pnpm --filter @nexo/web test`

Expected: all web tests pass and prove the browser-facing request target is the configured Gateway API.

- [ ] **Step 5: Commit the storefront integration**

```powershell
git add apps/web
git commit -m "feat(web): load products through api gateway"
```

### Task 3: Document the implemented boundary and verify the workspace

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/phase-1.md`

**Interfaces:**
- Consumes: the implemented routes and environment variables from Tasks 1 and 2.
- Produces: setup and architecture documentation that describes Gateway routing as active, names service URLs as internal configuration, and marks Redis as unused.

- [ ] **Step 1: Update documentation and Swagger assertions**

Replace statements that Gateway routing is deferred with the explicit live route mapping. Document required `AUTH_SERVICE_URL`, `CATALOG_SERVICE_URL`, and `NEXT_PUBLIC_API_GATEWAY_URL`, retaining PostgreSQL logical database ownership and Redis's unused Phase 1 state. Extend Gateway Swagger testing to assert Auth and Catalog proxy paths appear in the generated document.

- [ ] **Step 2: Run the complete verification suite**

Run:

```powershell
pnpm build
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

Expected: every command exits 0 and the final diff contains no whitespace errors.

- [ ] **Step 3: Commit documentation and verification results**

```powershell
git add README.md docs apps/api-gateway/test
git commit -m "docs: document gateway service integration"
```
