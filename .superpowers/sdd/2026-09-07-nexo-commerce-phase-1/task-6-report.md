# Task 6 report — documentation and assembled-monorepo verification

## Files added

- `README.md`
- `docs/architecture/phase-1.md`
- `docs/adr/001-monorepo.md`
- `docs/adr/002-database-per-service.md`
- `docs/adr/003-nestjs-express.md`

The root README covers the Phase 1 architecture (including Mermaid), stack, final workspace layout, services/routes, setup, environment variables, root and filtered package commands, technical decisions, scope limits, and the Phase 1–9 roadmap. The architecture note records the local operational sequence, service/data boundaries, Express safeguards, strict runtime configuration, logical `auth_db`/`catalog_db` ownership, and temporary unauthenticated Catalog writes. Each ADR has Context, Decision, and Consequences sections.

## Documentation cross-check method

The task brief's suggested source-text documentation test was deliberately not created, per the controller ruling: it would be a brittle text-change detector and is outside the requested product documentation.

Instead, the documentation was manually cross-checked after writing against:

- root `package.json`, each application `package.json`, `pnpm-workspace.yaml`, and `turbo.json` for every command and filtered package name;
- root and application `.env.example` files plus `packages/config/src/index.ts` and the Auth/Catalog environment modules for all variable names, defaults, and validation constraints;
- backend `main.ts`, controllers, HTTP middleware/filter modules, and `app.module.ts` files for Express, ports, routes, Swagger, request IDs, CORS, Helmet, validation, logging, and public error behavior;
- both Prisma schemas, migrations locations, and `infra/docker/postgres/init-databases.sql` for database ownership; and
- `docker-compose.yml` for local infrastructure, image versions, ports, volumes, initialization, and health checks.

This pass also identified two material runtime facts that the docs now state explicitly: the Gateway bootstrap reads shell environment rather than its app-local `.env`, and the current Web/Gateway defaults both use port 3000. The working concurrent local sequence runs the Gateway with `PORT=3003`; the root `pnpm dev` command is documented as unavailable for an all-services launch until that port collision is changed.

## Validation evidence

All commands below were executed from the repository root on 2026-09-08.

| Command | Result |
| --- | --- |
| `pnpm install` | Exit 0. `Scope: all 11 workspace projects`; `Already up to date`; pnpm 11.1.2. |
| `pnpm build` | Exit 0. Turbo reported `8 successful, 8 total`; Prisma generated both service clients and Next.js production build completed. |
| `pnpm lint` | Exit 0. Turbo reported `8 successful, 8 total`. |
| `pnpm typecheck` | Exit 0. Turbo reported `11 successful, 11 total`. |
| `pnpm test` | Exit 0. Turbo reported `8 successful, 8 total`; Jest reported 9 suites / 71 tests passing across Contracts, Web, Gateway, Auth, and Catalog. |
| `docker compose config` | Exit 0. Rendered the PostgreSQL 16 and Redis 7 services, persistent volumes, init SQL mount, and health checks. |
| Auth direct schema validation | Exit 0: `pnpm --filter @nexo/auth-service exec prisma validate --schema prisma/schema.prisma` with explicit `DATABASE_URL`; Prisma reported the schema valid. |
| Catalog direct schema validation | Exit 0: `pnpm --filter @nexo/catalog-service exec prisma validate --schema prisma/schema.prisma` with explicit `DATABASE_URL`; Prisma reported the schema valid. |
| `git diff --check` | Exit 0; no whitespace errors. |

## Docker startup result and limitations

`docker compose up -d` was attempted. Docker Engine was reachable, but the command exited 1 because host port 6379 was already allocated:

```text
Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint nexocommerce-redis-1 (...): Bind for 0.0.0.0:6379 failed: port is already allocated
```

`docker compose ps -a` immediately after showed both Nexo containers in `Created` state, not running/healthy. The host's `prueba-redis` container was already using `0.0.0.0:6379->6379/tcp`. The attempted Nexo containers and network were then cleaned up with `docker compose down`; named volumes were retained, matching the repository's `pnpm db:down` behavior.

Consequently, no live PostgreSQL migration, database-backed route, or health check was claimed or performed. The documented application health routes are correctly described as liveness-only rather than evidence of database availability or migrated schema state.

## Self-review

- Confirmed all five required documentation files exist and ADR titles match their numbered decisions.
- Confirmed no source code, dependency manifests, test files, or generated documentation test were added.
- Confirmed documented direct Prisma validation commands work exactly with explicit shell `DATABASE_URL` values.
- Confirmed docs distinguish normal Auth/Catalog service startup from direct root-level Prisma validation, and distinguish logical local database isolation from physical production isolation.
- Confirmed Phase 1 safeguards and exclusions, including temporary unauthenticated Catalog write endpoints, are explicit.

## Fix round 1 — root development launch

### Root cause and failing evidence

Review found that the documented `pnpm dev` flow was not functional. The shared `parseBaseEnvironment` default remains port 3000. The Gateway called it directly, did not load its app-local `.env`, and `apps/api-gateway/.env.example` also specified 3000. A first `pnpm dev` smoke exposed a second required condition: Turbo starts scripts named `dev`, but the Gateway only had `start:dev`, so Turbo did not start the Gateway at all.

The focused test was added before the Gateway environment implementation and failed as expected:

```text
FAIL test/environment-spec.ts
TS2307: Cannot find module '../src/common/environment' or its corresponding type declarations.
```

The first root smoke had no listener-bind error; its complete Turbo task-start set was only:

```text
@nexo/web:dev: $ next dev
@nexo/auth-service:dev: $ ts-node src/main.ts
@nexo/catalog-service:dev: $ ts-node src/main.ts
```

There was no `@nexo/api-gateway:dev` task. The Web process announced `http://localhost:3000`; Auth and Catalog each logged `Nest application successfully started`. This is the direct runtime evidence for the missing Gateway `dev` script. The smoke process was stopped and its listeners were confirmed absent before the correction.

### Correction

- Added the Gateway-local environment loader at `apps/api-gateway/src/common/environment.ts`. It loads the `.env` adjacent to the application through `dotenv`, preserves shell-variable precedence, and applies an application-only default of port 3003 without changing `@nexo/config`'s shared base default of 3000.
- Updated Gateway bootstrap to use that loader, declared the existing `dotenv` runtime dependency, changed `apps/api-gateway/.env.example` to `PORT=3003`, and added the required standard `dev` script alongside `start:dev`.
- Added `apps/api-gateway/test/environment-spec.ts`. It verifies the Gateway-specific 3003 default and uses a real temporary dotenv file to verify loading into a supplied runtime environment. The test passed after the implementation (2 tests).
- Updated the README and Phase 1 architecture note to describe the normal copied-app-environment root flow and correct gateway endpoint `http://localhost:3003`.

### Runtime smoke evidence

Temporary ignored app-local `.env` files were created with the documented values solely for this smoke: Gateway 3003, Auth 3001 with valid distinct JWT secrets and PostgreSQL URL, Catalog 3002 with PostgreSQL URL, and the Web example value. No database request was made.

The corrected `pnpm dev` output included all four scripts:

```text
@nexo/web:dev: $ next dev
@nexo/api-gateway:dev: $ ts-node src/main.ts
@nexo/auth-service:dev: $ ts-node src/main.ts
@nexo/catalog-service:dev: $ ts-node src/main.ts
```

The Gateway logged the mapped `/api/health` route and `Nest application successfully started`; Auth and Catalog also logged successful Nest startup; Web reported ready at `http://localhost:3000`. A live listener assertion reported exactly:

```text
Bound listeners: 3000, 3001, 3002, 3003
```

Only the `pnpm dev` child process tree started for this smoke was interrupted. The post-stop assertion reported `Smoke-test listeners stopped.` The temporary ignored `.env` files were then removed.

### Fix-round validation

| Command | Result |
| --- | --- |
| `pnpm install` | Exit 0. Workspace lockfile was refreshed for the Gateway's declared `dotenv` dependency. |
| `pnpm --filter @nexo/api-gateway test -- environment-spec.ts` | Exit 0 after implementation; 1 suite / 2 tests passed. |
| `pnpm build` | Exit 0; Turbo: 8 successful tasks. |
| `pnpm lint` | Exit 0; Turbo: 8 successful tasks. |
| `pnpm typecheck` | Exit 0; Turbo: 11 successful tasks. |
| `pnpm test` | Exit 0; Turbo: 8 successful tasks; Gateway now has 2 suites / 5 tests, and all workspace suites passed. |

## Fix round 2 — shell environment precedence regression

The Gateway dotenv loader already used dotenv's default non-overriding behavior, so no production behavior change was required. A regression was added using a real temporary `.env` file with conflicting `NODE_ENV=test` and `PORT=43123`, alongside a supplied runtime environment with `NODE_ENV=production` and `PORT=43124`. It also supplies an unset `GATEWAY_LABEL` key from the dotenv file.

The untouched loader first passed the new behavior test. To produce an explicit RED proof, the loader was temporarily mutated to `override: true`; the focused test then failed exactly because dotenv values replaced the supplied shell values:

```text
- Expected: "NODE_ENV": "production", "PORT": 43124
+ Received: "NODE_ENV": "test", "PORT": 43123
```

The temporary mutation was restored; no production source change remains from this round. GREEN validation:

| Command | Result |
| --- | --- |
| `pnpm --filter @nexo/api-gateway test -- environment-spec.ts` | Exit 0; 1 suite / 3 tests passed, including shell precedence and unset-key loading. |
| `pnpm --filter @nexo/api-gateway test` | Exit 0; 2 suites / 6 tests passed. |
