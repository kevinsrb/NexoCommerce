# Phase 1 final integration fix report

Date: 2026-09-09. Branch: `phase-1`. Starting commit: `8ffb520bc7f7722deb6926efbb443b73b1692918`.

## Scope and result

Read the complete binding design and implementation plan before changes:

- `docs/superpowers/specs/2026-09-07-nexo-commerce-phase-1-design.md`
- `docs/superpowers/plans/2026-09-07-nexo-commerce-phase-1.md`

Completed one final integration fix wave covering all five supplied findings, plus the coordinator-authorized correction to gateway query logging. No subagents were dispatched. All production HTTP and CSS behavior fixes have observed RED/GREEN regression evidence. Dependency/configuration changes were verified through resolved dependencies, the actual Turbo graph, a clean-output runtime smoke, and the complete workspace checks.

## 1. Dependency security

The original manifest/lockfile resolved Next and its ESLint plugin at 15.2.2 and React/React DOM at 19.0.0. Those versions failed the supplied security requirement.

The originally recommended May baseline (15.5.18) was superseded by newer official guidance during this wave. The [official August 25 security release](https://nextjs.org/blog/august-2026-security-release) identifies 15.5.24 as the patched Maintenance LTS release addressing newer critical vulnerabilities. The coordinator explicitly approved this revised target. React's [updated RSC security advisory](https://react.dev/blog/2025/12/11/denial-of-service-and-source-code-exposure-in-react-server-components) also explains why early 19.2 patch releases are insufficient.

Changed `apps/web/package.json` and regenerated `pnpm-lock.yaml` using `pnpm install`:

| Package | Before | After |
| --- | --- | --- |
| next | 15.2.2 | 15.5.24 |
| @next/eslint-plugin-next | 15.2.2 | 15.5.24 |
| react / react-dom | 19.0.0 | 19.2.8 |
| @types/react | 19.0.8 | 19.2.18 |
| @types/react-dom | 19.0.3 | 19.2.7 |

Registry checks (`pnpm view <package>@<version> version`) confirmed every selected release exists. `pnpm list --filter @nexo/web --depth 0` confirmed these exact installed versions. `pnpm --filter @nexo/web exec next --version` printed `Next.js v15.5.24`.

GREEN: `pnpm install` exited 0; subsequent `pnpm install --frozen-lockfile` exited 0 with `Already up to date`. Build, lint, typecheck, tests, and the actual dev storefront passed on the upgraded dependencies. Next regenerated `apps/web/next-env.d.ts` with its standard route-types reference; that generated compatibility change is retained. No Next 16 migration or application redesign was needed.

The initial installation emitted an ENOENT warning while trying to create a Windows `next.EXE` shim. The installed CLI, dev server, and production build all worked, and frozen installation completed without that warning. Existing ESLint/subdependency deprecation warnings are recorded as warnings, not new application failures.

## 2. Clean root dev setup

Changed `turbo.json` so `dev` has `dependsOn: ["^build"]` while preserving `cache: false` and `persistent: true`.

RED: inspected the actual output of `pnpm exec turbo dev --dry=json` before the change:

```text
RED: @nexo/api-gateway#dev has no prerequisite builds
RED: @nexo/auth-service#dev has no prerequisite builds
RED: @nexo/catalog-service#dev has no prerequisite builds
```

GREEN: parsed the actual dry graph and asserted each backend's dependencies contain all three shared build tasks and that its resolved dev task remains persistent and uncached:

```powershell
$ErrorActionPreference = 'Stop'
$graph = pnpm exec turbo dev --dry=json | ConvertFrom-Json
$required = @('@nexo/config#build', '@nexo/contracts#build', '@nexo/logger#build')
foreach ($task in ($graph.tasks | Where-Object { $_.taskId -match '@nexo/(api-gateway|auth-service|catalog-service)#dev' })) {
  foreach ($dependency in $required) {
    if ($task.dependencies -notcontains $dependency) { throw "Missing $dependency before $($task.taskId)" }
  }
  if ($task.resolvedTaskDefinition.cache -or -not $task.resolvedTaskDefinition.persistent) { throw 'Invalid dev flags' }
  Write-Output "GREEN $($task.taskId): $($task.dependencies -join ', '); cache=false persistent=true"
}
```

Result, exit 0:

```text
GREEN @nexo/api-gateway#dev: @nexo/config#build, @nexo/contracts#build, @nexo/logger#build; cache=false persistent=true
GREEN @nexo/auth-service#dev: @nexo/config#build, @nexo/contracts#build, @nexo/logger#build; cache=false persistent=true
GREEN @nexo/catalog-service#dev: @nexo/config#build, @nexo/contracts#build, @nexo/logger#build; cache=false persistent=true
```

An earlier graph parse overlapped dependency installation and encountered non-JSON package-manager output. The final assertion above was rerun after installation and passed; the earlier parse was not counted as successful verification.

### Bounded root dev smoke

Confirmed ports 3000/3301/3302/3303 were free. Created temporary ignored app-local `.env` files using valid development configuration: separate Auth/Catalog PostgreSQL URLs, independent sufficiently long Auth JWT secrets, and ports 3301/3302/3303. No database-backed endpoint was requested.

The ignored smoke helper `.turbo/final-integration-smoke.ps1` validated absolute source/destination paths inside this workspace and moved `packages/config/dist`, `packages/contracts/dist`, and `packages/logger/dist` to recoverable ignored backups in `.turbo/final-integration-smoke-backup`. It then launched the root command `pnpm dev --force` with a hidden window, captured logs, and polled real HTTP endpoints with a 150-second overall bound and short per-request timeouts.

Runtime output showed fresh shared `tsc` builds before backend `ts-node` dev tasks. The final HTTP evidence was:

```text
SMOKE 200 http://127.0.0.1:3302/health service=catalog-service requestId=27c3db4b-9042-471f-91ba-e5ed888e467d
SMOKE 200 http://127.0.0.1:3303/api/health service=api-gateway requestId=711f878a-d696-4ce5-8aab-666ea2ee578c
SMOKE 200 http://127.0.0.1:3303/api/docs Swagger UI
SMOKE 200 http://127.0.0.1:3301/health service=auth-service requestId=bceeaa9f-1855-41fd-a452-404fc651f37e
SMOKE 200 http://127.0.0.1:3000 storefront
SMOKE PASS in 136 seconds
```

Next reported `Ready in 34.1s`, compiled `/`, and logged `GET / 200`. The smoke stopped only its launched process tree in a `finally` block. A subsequent listener check showed none of those four ports listening. The three temporary `.env` files were deleted with `apply_patch`. Newly built shared outputs remain available, and pre-smoke outputs are recoverable from the ignored backup directory. No user configuration was overwritten.

Local full runtime logs remain at `.turbo/final-integration-dev.stdout.log` and `.turbo/final-integration-dev.stderr.log`. These and the helper/backups are ignored, not committed. The smoke validates startup and liveness, not PostgreSQL migrations or database transactions; generated Prisma clients were already available as required by the documented setup.

## 3. Swagger boundary

Changed `apps/api-gateway/src/main.ts` to call `SwaggerModule.setup('docs', app, document, { useGlobalPrefix: true })`.

The real Nest/Supertest boundary fixture in `apps/api-gateway/test/app.e2e-spec.ts` now configures Swagger using the production configuration function, then checks `/api/docs` returns HTML containing Swagger UI and `/docs` returns 404.

RED command: `pnpm --filter @nexo/api-gateway test -- app.e2e-spec`.

```text
hosts Swagger under the public API prefix
expected 200 "OK", got 404 "Not Found"
```

GREEN command: `pnpm --filter @nexo/api-gateway test`. All 9 gateway tests passed, including real `/api/docs` 200 and `/docs` 404 responses. The root dev smoke independently returned Swagger UI at `/api/docs`.

## 4. Safe oversized-body errors

Ported Catalog's narrow body-parser recognition to Auth and Gateway: an object must have `type: 'entity.too.large'` and `status` or `statusCode` equal to 413. The public response uses status 413, `PAYLOAD_TOO_LARGE`, the fixed safe message `Payload too large`, and the response request ID. Generic unknown exceptions continue through their existing handling.

Files: `apps/auth-service/src/common/http.ts` and `apps/api-gateway/src/common/http/http-exception.filter.ts`.

Added actual HTTP regressions in both services' `test/app.e2e-spec.ts`. Each sends a roughly 120 KB JSON body through the real body parser. The exact body assertion permits only `{ statusCode, code, message, requestId }`, ensuring no parser details, raw body, or stack leak; the request ID must be a UUID and match the response header.

RED commands:

```text
pnpm --filter @nexo/api-gateway test -- app.e2e-spec
pnpm --filter @nexo/auth-service test -- app.e2e-spec

Both oversized-body cases: expected 413 "Payload Too Large", got 500 "Internal Server Error"
Gateway boundary: 2 failed, 3 passed (Swagger was the other failure)
Auth boundary: 1 failed, 8 passed
```

GREEN: the gateway suite passed 9/9 and the focused Auth boundary passed 9/9. The final complete Auth suite passed 20/20. Catalog required no change and its existing 413 regression remains passing.

## 5. Tailwind product accents

Changed `apps/web/tailwind.config.ts` to include `./lib/**/*.{ts,tsx}`. Added `apps/web/test/catalog-styles.spec.tsx`, which executes PostCSS/Tailwind with the real configuration and checks the generated utility selectors for all six product gradient colors. This checks compiler output rather than matching source text.

RED command: `pnpm --filter @nexo/web test -- catalog-styles`.

```text
builds gradient colors for every featured product
Expected value: ".from-amber-200\\/70"
Received set: generated utilities without that selector
Tests: 1 failed, 1 total
```

GREEN: the same command passed 1/1, and the final complete web suite passed 7/7. The upgraded production build completed successfully.

## Logging recommendation and no-change rulings

No global exception diagnostic logging was added. There is no defined safe redaction/diagnostic design in the supplied scope, and existing structured completion logs already record request identity, method, status, path, and duration. Expanding exception serialization would need a separate intentional design.

A source change **was warranted** for gateway completion logging: inspection found `request.originalUrl`, unlike Auth and Catalog's `request.path`. The coordinator explicitly authorized aligning the gateway with the established no-query pattern. Changed `apps/api-gateway/src/common/http/request-completion-logging.middleware.ts` to `request.path`.

Added `apps/api-gateway/test/request-logging-spec.ts`, exercising an actual HTTP request and the production middleware with a real Pino logger. Its hook observes emitted log arguments; it does not mock request parsing or the logger.

RED command: `pnpm --filter @nexo/api-gateway test -- request-logging`.

```text
Expected path: /api/health
Received path: /api/health?token=private-query-secret
Tests: 1 failed, 1 total
```

GREEN: the gateway suite passed with the exact completion record containing `/api/health`, method, status, and duration only. The fixture secret above is synthetic test data.

## Final verification

All commands below completed successfully after the dependency upgrade and production changes. Turbo reused unchanged package task results; changed application checks executed freshly.

| Command | Observed result |
| --- | --- |
| `pnpm install` | Exit 0; lockfile regenerated |
| `pnpm install --frozen-lockfile` | Exit 0; Already up to date |
| `pnpm build` | Exit 0; 8/8 tasks successful, 5 cached; Next 15.5.24 produced 4 static pages; 50.606s |
| `pnpm lint` | Exit 0; 8/8 tasks successful, 5 cached; 19.455s |
| `pnpm typecheck` | Exit 0; 11/11 tasks successful, 8 cached; 5.095s |
| `pnpm test` | Exit 0; 8/8 tasks successful, 5 cached; 31.628s |
| `docker compose config --quiet` | Exit 0 |
| `git diff --check` | Exit 0 |
| Turbo dev graph assertions | All three backend tasks have all three dependency builds; dev remains uncached/persistent |
| `pnpm dev --force` smoke | All five HTTP checks passed in 136s from absent shared dist outputs |

Test totals: Gateway 9, Auth 20, Catalog 42, Web 7, Contracts 1: **79 tests across 12 suites**.

The Next build/dev commands emit an environment-specific workspace-root warning because `C:\Users\kevin\package-lock.json` exists above the repository. Both commands completed; the unrelated parent lockfile was not changed. No database runtime or migration claim is made by this smoke. No task remains blocked.

## Exact committed files

- `.superpowers/sdd/2026-09-07-nexo-commerce-phase-1/final-review-fix-report.md`
- `apps/api-gateway/src/common/http/http-exception.filter.ts`
- `apps/api-gateway/src/common/http/request-completion-logging.middleware.ts`
- `apps/api-gateway/src/main.ts`
- `apps/api-gateway/test/app.e2e-spec.ts`
- `apps/api-gateway/test/request-logging-spec.ts`
- `apps/auth-service/src/common/http.ts`
- `apps/auth-service/test/app.e2e-spec.ts`
- `apps/web/next-env.d.ts`
- `apps/web/package.json`
- `apps/web/tailwind.config.ts`
- `apps/web/test/catalog-styles.spec.tsx`
- `pnpm-lock.yaml`
- `turbo.json`
