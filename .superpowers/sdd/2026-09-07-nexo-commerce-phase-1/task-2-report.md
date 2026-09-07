# Task 2 Report — NestJS + Express API Gateway

## Status

Implemented the independently runnable `@nexo/api-gateway` as a NestJS application using
`NestFactory.create(AppModule)` and `@nestjs/platform-express` only. The gateway exposes
`GET /api/health` and Swagger UI at `/api/docs`, with no proxy behavior.

## Changed files

- `apps/api-gateway/.env.example`
- `apps/api-gateway/jest.config.cjs`
- `apps/api-gateway/package.json`
- `apps/api-gateway/tsconfig.json`
- `apps/api-gateway/tsconfig.test.json`
- `apps/api-gateway/src/app.module.ts`
- `apps/api-gateway/src/main.ts`
- `apps/api-gateway/src/health/health.controller.ts`
- `apps/api-gateway/src/health/health.module.ts`
- `apps/api-gateway/src/common/http/http-exception.filter.ts`
- `apps/api-gateway/src/common/http/integration-boundary.module.ts`
- `apps/api-gateway/src/common/http/request-id.middleware.ts`
- `apps/api-gateway/src/common/http/request-id.types.ts`
- `apps/api-gateway/src/common/http/request-logging.interceptor.ts`
- `apps/api-gateway/test/app.e2e-spec.ts`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`

`pnpm-workspace.yaml` sets `@scarf/scarf` to `allowBuilds: false`. pnpm 11 required this
explicit decision after dependency installation; the package is not needed at runtime.

## Implementation notes

- Uses Helmet, permissive CORS, a global `ValidationPipe` with `whitelist`, `transform`, and
  `forbidNonWhitelisted`, a global HTTP exception filter, request-ID middleware, and a Pino
  request logging interceptor.
- A valid UUID `x-request-id` is reused; otherwise a UUID is generated and returned in the
  response header. The global error shape is `{ statusCode, code, message, requestId }` and
  does not expose a stack trace.
- `IntegrationBoundaryModule` is deliberately empty: it preserves a future integration seam
  without adding proxy routes or a proxy engine.

## Malformed-payload boundary decision

The narrowest testable boundary is malformed JSON submitted to the already-existing
`/api/health` path. The test sends invalid JSON to `POST /api/health`; this exercises Express's
JSON parser and Nest's global exception filter without introducing a test-only DTO, controller,
or public mutation endpoint. It verifies the public standard error shape at the HTTP boundary.

## TDD evidence

### RED

Command:

```powershell
pnpm --filter @nexo/api-gateway test
```

Observed expected failure before gateway production code existed:

```text
TS2307: Cannot find module '../src/app.module'
TS2307: Cannot find module '../src/main'
```

The test imported the intended Nest application boundary, so the failure was caused by the
missing gateway module rather than a false-positive assertion.

### GREEN

After the minimal Nest/Express foundation was implemented:

```text
PASS test/app.e2e-spec.ts
Tests: 2 passed, 2 total
```

The two Supertest cases use a real Nest Express application and cover the health response plus
request-ID header and malformed JSON error shape.

## Fresh verification

All commands completed successfully after final formatting:

```powershell
pnpm --filter @nexo/api-gateway build
pnpm --filter @nexo/api-gateway lint
pnpm --filter @nexo/api-gateway test
pnpm --filter @nexo/api-gateway typecheck
```

Results:

- Build: exit code 0 (`tsc -p tsconfig.json`)
- Lint: exit code 0 (`eslint src test`)
- Tests: exit code 0; 1 suite and 2 tests passed
- Typecheck: exit code 0 (`tsc -p tsconfig.json --noEmit`)

## Self-review

- Confirmed `@nestjs/platform-express` is the only Nest HTTP adapter declared; Fastify is not
  installed or referenced.
- Confirmed `main.ts` creates the app with `NestFactory.create(AppModule)` and does not start
  during test imports (`require.main === module`).
- Confirmed both required public routes are configured (`/api/health`, `/api/docs`) and no
  proxy, cart, order, payment, notification, persistence, or queue behavior was added.
- Confirmed `git diff --check` reported no whitespace errors.

## Concerns

- The gateway intentionally has no upstream proxy behavior in Phase 1. Its empty integration
  boundary module is the only future-routing seam.
- The malformed-payload test validates raw JSON parser failures only; DTO validation will be
  covered by the services that later own mutation endpoints.

---

## Fix round 1 — HTTP middleware order, completion logging, and prefixing

### Changes

- Request-ID middleware now runs before completion logging, Helmet, and CORS. This guarantees
  that CORS's automatic preflight response receives an `x-request-id` header.
- Replaced route-scoped interceptor logging with Express response-completion logging. The
  middleware subscribes to `response.finish`, so it records the final status and duration for
  CORS preflights, parser failures, unmatched routes, and ordinary Nest controller responses.
  Each Pino entry includes the logger base `service`, child `requestId`, `method`, `path`, final
  `statusCode`, and numeric `duration` in milliseconds.
- Added `app.setGlobalPrefix('api')`, changed the health controller to the prefix-relative
  `health` path, and changed Swagger setup to `docs`; the resulting public paths remain
  `/api/health` and `/api/docs`.

### TDD evidence

The new behavior was tested at the real HTTP boundary before changing production code.

```powershell
pnpm --filter @nexo/api-gateway test
```

RED result with the prior CORS-before-request-ID ordering:

```text
API gateway HTTP boundary › adds a request ID to CORS preflight responses
Matcher error: received value must be a string
Received has value: undefined
```

The regression test sends an actual CORS `OPTIONS /api/health` request with `Origin` and
`Access-Control-Request-Method`, receives the CORS-generated `204`, and asserts a UUID-valued
`x-request-id` response header. Removing or moving the request-ID middleware after CORS makes
this test fail.

GREEN result after the ordering fix:

```text
PASS test/app.e2e-spec.ts
Tests: 3 passed, 3 total
```

The same real test run emitted completion records with final `200`, `204`, and malformed-payload
`400` statuses, each with a numeric `duration`; no mock-only logger assertion was introduced.

### Fix-round verification

All checks passed after formatting:

```powershell
pnpm --filter @nexo/api-gateway build
pnpm --filter @nexo/api-gateway lint
pnpm --filter @nexo/api-gateway test
pnpm --filter @nexo/api-gateway typecheck
git diff --check
```

Results: build, lint, and typecheck exited 0; Jest passed 1 suite / 3 tests; `git diff --check`
reported no whitespace errors.
