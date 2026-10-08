# Task 3 report — Catalog inventory reservations

Status: COMPLETE for Task 3; ready for coordinator review. No Task 4 work performed.

Worktree: `C:\Users\kevin\orca\workspaces\NexoCommerce\phase-3-orders`

Branch: `phase-3-orders`

Base: `507dd39`

Commit: `a6d54b4d03b949ce1732790ba89384e5465fee96` — `feat(catalog): add inventory reservations`

The prior agent's uncommitted schema, migration, service projection, DTO, exception, and tests were inspected and retained/corrected. The SDD ledger was read only for its compatibility ruling and was not edited. Main was not touched; nothing was merged or pushed.

## Delivered behavior

- Migrates legacy stock to `onHand` without changing its quantity, initializes `reserved=0`, and enforces `onHand >= reserved >= 0` in PostgreSQL. Durable reservation headers, exact Decimal(18,2) line snapshots, publication metadata/revision, and one expiry event per reservation are persisted. A deletion trigger protects variants referenced by nonterminal reservations; terminal snapshots retain immutable old variant IDs after replacement.
- Public and legacy batch reads expose `available`. The legacy `stock` field remains an availability alias; no consumer receives raw `onHand`. V1 lookup returns the specified narrow variant/sellability/available/decimal price/currency projection.
- Internal-token guarded reserve, publish-order, status, release, and v1 lookup routes. Private errors use `code`, `message`, `request_id`, and optional safe details. Existing public/legacy error envelopes remain compatible. The existing constant-time internal token guard is reused unchanged; the environment now rejects reuse of the access JWT secret as the internal token.
- All-or-nothing reserve with an attempt advisory lock for first-insert concurrency, reservation row locking for retries, stable product and variant lock order, transactional sellability/currency/price/stock rechecks, and normalized exact-price request hashing. Same-attempt retries return the stored snapshot and current lifecycle; mismatches conflict. Catalog's database UTC clock records a fixed 15-minute deadline.
- Conditional publication checks the database clock in the UPDATE itself, binds one order and immutable publication revision, and never extends expiry. Publication, status, release, and expiry serialize on the same reservation row. Expiry persists its terminal state and event before publication returns `RESERVATION_EXPIRED` (the exception is thrown outside the transaction).
- Idempotent terminal release/expiry restores availability once. A bounded expiry worker starts with the service, scans up to 100 due reservations per tick, prevents overlapping local scans, retries after failures, and shuts down its timer. Status reconciliation also applies due expiry. Durable events plus status are the recovery boundary; no broker or Orders orchestration was added.
- Admin stock adjustment, product deletion, and replacement use the same inventory locks. Stock below current reserved quantity returns a conflict with authorized available/reserved details. Replacement creates new IDs; old snapshots are preserved.

## Changed files

- `.env.example`
- `apps/catalog-service/prisma/schema.prisma`
- `apps/catalog-service/prisma/migrations/20261003000000_phase_3_inventory/migration.sql`
- `apps/catalog-service/src/catalog/catalog.controller.ts`
- `apps/catalog-service/src/catalog/catalog.dto.ts`
- `apps/catalog-service/src/catalog/catalog.module.ts`
- `apps/catalog-service/src/catalog/catalog.service.ts`
- `apps/catalog-service/src/catalog/reservation.dto.ts`
- `apps/catalog-service/src/catalog/reservation.service.ts`
- `apps/catalog-service/src/catalog/reservation-expiry.worker.ts`
- `apps/catalog-service/src/common/catalog-domain.exception.ts`
- `apps/catalog-service/src/common/environment.ts`
- `apps/catalog-service/src/common/http.ts`
- `apps/catalog-service/test/app.e2e-spec.ts`
- `apps/catalog-service/test/environment-spec.ts`
- `apps/catalog-service/test/reservation-app.e2e-spec.ts`

At the initial Task 3 handoff, this report and `prisma-concurrency-repro.cjs` were local ignored artifacts under the Task 3 SDD directory. This report is tracked with fix round 1; the reproduction script remains ignored.

## Commands and evidence

Commands were run from the assigned worktree, using PowerShell, Node 22.19.0, pnpm 11.1.2, Prisma 6.19.0, and real PostgreSQL 16.14 in Docker.

1. `pnpm --filter @nexo/catalog-service test -- app.e2e-spec environment-spec`
   - Initial RED: 1 failed, 57 passed, 9 integration tests skipped without the database variable. The v1 authentication test received 404 instead of 401 because the routes did not exist.
2. `docker run --name nexo-task3-postgres -e POSTGRES_PASSWORD=task3_test_password -p 127.0.0.1:55433:5432 -d postgres:16-alpine`
   - Created the isolated test database; Docker was available on this resumed run.
3. `$env:CATALOG_TEST_DATABASE_URL='postgresql://postgres:task3_test_password@localhost:55433/postgres'; pnpm --filter @nexo/catalog-service test -- reservation-app.e2e-spec`
   - Initial integration RED: all 9 tests failed on missing reservation endpoints. The old-stock migration fixture applied successfully before the endpoint failures.
4. `pnpm --filter @nexo/catalog-service prisma:generate`
   - PASS. Generated the Prisma client for the new schema.
5. Intermediate real database checks identified and corrected explicit UUID casts in raw `IN` clauses (`uuid = text` from PostgreSQL). Existing guard tests also needed lazily constructed Supertest requests: constructing all requests before sequentially awaiting them retained a closed ephemeral listening address and caused ECONNREFUSED.
6. The four remaining concurrency failures were investigated before changing production settings. See the reproduction below. Switching the test URL from `localhost` to `127.0.0.1` made all original 67 focused checks pass without any production timeout, isolation, or pool changes.
7. `$env:CATALOG_TEST_DATABASE_URL='postgresql://postgres:task3_test_password@127.0.0.1:55433/postgres'; pnpm --filter @nexo/catalog-service exec jest --runInBand reservation-app.e2e-spec`
   - PASS: 12/12 after adding worker expiry, a deterministically gated publication/worker race, and unsellable/missing/mixed-currency coverage.
8. `pnpm --filter @nexo/catalog-service exec jest --runInBand reservation-app.e2e-spec -t 'requires a publication revision'` with the IPv4 database variable set.
   - RED: the SQL update incorrectly succeeded when publicationRevision was null. PostgreSQL CHECK accepts UNKNOWN. Added explicit `IS NOT NULL` to the publication constraint. The same regression is green in the final suite.
9. Exact brief sequence with the IPv4 integration variable set:
   `pnpm --filter @nexo/catalog-service prisma:generate && pnpm --filter @nexo/catalog-service test -- app.e2e-spec environment-spec && pnpm --filter @nexo/catalog-service typecheck`
   - PASS: generation; 3 suites, 71 tests including all 13 real PostgreSQL integration tests; typecheck exit 0.
10. `$env:DATABASE_URL='postgresql://postgres:task3_test_password@127.0.0.1:55433/postgres?schema=catalog_task3_deploy'; pnpm --filter @nexo/catalog-service prisma:migrate`
    - PASS: both initial and Phase 3 migrations applied using the actual Prisma migration deploy command in a fresh schema.
11. `pnpm --filter @nexo/catalog-service lint`
    - PASS, exit 0.
12. `pnpm --filter @nexo/catalog-service build`
    - PASS, generation plus production TypeScript compile, exit 0.
13. `$env:CATALOG_TEST_DATABASE_URL='postgresql://postgres:task3_test_password@127.0.0.1:55433/postgres'; pnpm --filter @nexo/catalog-service test`
    - Final full Catalog suite PASS: 3 suites, 71 tests, 0 skipped, 0 failed.
14. `git diff --check`
    - PASS. Git emitted only the repository's Windows LF-to-CRLF conversion notices.
15. `git status --short`
    - Clean after committing. The report/reproduction are ignored local artifacts.

## Concurrency investigation

Minimal reproduction is preserved at `.superpowers/sdd/2026-10-02-orders-inventory-phase-3/prisma-concurrency-repro.cjs`. It runs a single Prisma transaction containing `SELECT 1`, then two concurrent identical transactions, logs entry into the transaction callbacks/query events, and samples `pg_stat_activity` through a separate client. It has no Catalog code, row locks, or advisory locks.

Run: set `CATALOG_TEST_DATABASE_URL`, then `node .superpowers/sdd/2026-10-02-orders-inventory-phase-3/prisma-concurrency-repro.cjs`.

- With `localhost`, the initial connection took about 2060 ms. Parallel-A entered its callback and committed in 6 ms. Parallel-B never emitted BEGIN or entered the callback, and returned `P2028: Transaction API error: Unable to start a transaction in the given time` after about 2006 ms. PostgreSQL logs showed no deadlock/lock-timeout error. Activity samples showed idle/client-read connections, not blocked Catalog lock statements.
- Hypothesis: the IPv4-only Docker port plus localhost address resolution/connection fallback delays new connections long enough to exhaust Prisma's default two-second transaction acquisition window. This is connection establishment, before Catalog lock acquisition.
- Controlled comparison: changing only the host to `127.0.0.1` reduced the first transaction to ~32 ms; both concurrent transactions entered callbacks, emitted BEGIN/COMMIT, and completed within ~20 ms. The actual HTTP concurrency tests then passed.
- Minimal resolution: use the address on which this disposable container was explicitly published. No application timeout, isolation, pool size, or query semantics were changed to mask the failure.

The four affected behaviors were same-attempt concurrent reserve, overlapping reversed batch reserve, concurrent release, and simultaneous expired status/release/publication. All pass on the final IPv4-backed real database run.

## Self-review

- Checked lock ordering for reserve/admin versus lifecycle operations: new reserve takes products then variants in stable order; admin replacement uses the same order. Lifecycle operations take the reservation row then variants; admin protection reads reservation state without acquiring a reverse reservation lock. Same-attempt advisory locking only serializes creation/retry and is released with the transaction.
- Checked exact decimal handling: snapshot storage and comparison use Prisma Decimal; presentation uses `toFixed(2)` for the existing Decimal(18,2) schema. No monetary value is converted to Number.
- Checked rollback and expiry: all stock changes are in the same transaction as the reservation/event. Price/stock/sellability failures cannot leave partial reservations. Terminal state prevents double release, and one unique expiry event retains publicationRevision/order binding.
- Tested a real publication UPDATE held behind a database advisory gate while an expiry scan becomes due and waits on the reservation row. Publication returned PUBLISHED/revision 1; the later committed expiry retained revision 1. The expiry-first scenario returns RESERVATION_EXPIRED with no publication revision. Published retries and later status recovery keep the original snapshot/deadline.
- Confirmed all private endpoints use the existing token guard; the token does not authorize administrative stock operations. Caller-supplied expiry and malformed/duplicate lines are rejected.
- Confirmed the only business changes are in Catalog plus its example token. No Orders, Gateway, Cart, Payment, RabbitMQ, public checkout, merge, or push changes.

## Runtime limits and concerns

- No outstanding failing Catalog checks or known Task 3 correctness blocker.
- The real database tests are opt-in via `CATALOG_TEST_DATABASE_URL`; omitting it skips them. Use `127.0.0.1` for the isolated IPv4-only container on this machine. Each run creates and removes a uniquely named test schema.
- The disposable `nexo-task3-postgres` container and the migration-deploy schema remain available for coordinator/reviewer reruns. They contain only task fixtures. No existing application database was migrated.
- Expiry processing is bounded to 100 candidates per scan; status reconciliation remains authoritative even if a scan is delayed. The worker timer is disabled under NODE_ENV=test, and its production tick path is invoked explicitly in real database tests.
- Durable expiry rows/status are delivered here; actual Orders consumption/recovery and any broker transport remain outside Task 3, as required.
- Only the directly affected Catalog project's full suite/typecheck/lint/build were run. Unrelated monorepo suites were not run.

## Fix round 1/5 — internal v1 dependency outage

This round owns and completes the prior implementer's uncommitted Catalog HTTP filter and tests. No Orders, Gateway, Cart, frontend, timeout, pool, isolation, merge, or push changes.

- Root cause: the shared exception filter treated Prisma connection failures as generic 500s on the internal v1 routes. The pending fix mapped all `PrismaClientInitializationError` instances to 503; that also misclassified authentication, schema, and unclassified initialization failures. A real `127.0.0.1:1` model query yielded `PrismaClientInitializationError` without `errorCode` and with `Can't reach database server at` in its message.
- Fix: internal v1 routes return exactly `{ code: 'DEPENDENCY_UNAVAILABLE', message: 'Dependency unavailable', request_id }` with HTTP 503 for Prisma connection, timeout, and capacity codes, plus the observed code-less unreachable-host initialization form. The middleware continues to echo `x-request-id`. Other v1 errors retain their domain/validation or sanitized 500 handling; public routes retain their legacy envelope.
- RED: `pnpm --filter @nexo/catalog-service exec jest --runInBand app.e2e-spec -t 'keeps unexpected and nonavailability failures' --silent` failed 3 cases because P1000 authentication, P1012 schema, and unclassified Prisma initialization errors incorrectly returned 503.
- GREEN focused: `pnpm --filter @nexo/catalog-service exec jest --runInBand app.e2e-spec dependency-app.e2e-spec --silent` passed 2 suites, 61 tests; 13 database integration tests were skipped in that focused run because the database variable was unset.
- Real HTTP outage reproduction: `pnpm --filter @nexo/catalog-service exec jest --runInBand dependency-app.e2e-spec --silent` is included in the focused and full runs. With a real Prisma client and `DATABASE_URL=postgresql://outage:private-password@127.0.0.1:1/catalog?connect_timeout=1`, authenticated `GET /internal/v1/variants/:id` and `GET /internal/v1/reservations/by-attempt/:id` each returned HTTP 503, the exact sanitized body above, and the supplied UUID in both `request_id` and `x-request-id`. No database error detail appeared in the response.
- Full Catalog coverage: started existing isolated `nexo-task3-postgres`, set `CATALOG_TEST_DATABASE_URL=postgresql://postgres:task3_test_password@127.0.0.1:55433/postgres`, then ran `pnpm --filter @nexo/catalog-service exec jest --runInBand --silent`: 4 suites, 86 tests passed, 0 skipped. The container was stopped afterward. This includes the real PostgreSQL reservation suite, mocked HTTP code taxonomy tests, and both real refused-connection HTTP probes.
- `pnpm --filter @nexo/catalog-service lint`: pass. `pnpm --filter @nexo/catalog-service typecheck`: pass. `pnpm --filter @nexo/catalog-service build`: pass, including Prisma generation and TypeScript compilation. `git diff --check`: pass (only Windows LF-to-CRLF notices).
- Remaining limitation: Prisma 6.19.0 omits `errorCode` on the observed unreachable-host query, so that case is identified by its Prisma exception type and specific message phrase. If Prisma changes that phrase without supplying a code, the response would fall back to sanitized 500 until this classifier is updated.
