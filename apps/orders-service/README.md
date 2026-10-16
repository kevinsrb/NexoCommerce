# Orders Service

Orders owns `order_db` on port `3005`: durable idempotency attempts, immutable order/line snapshots, checkout saga progress, and recovery leases. Copy `.env.example` to `.env`, run `pnpm orders:prisma:generate` and `pnpm orders:prisma:migrate`, then run `pnpm --filter @nexo/orders-service dev`.

Its only checkout HTTP target is private: `POST /internal/v1/checkouts`. Gateway forwards the user's access JWT, `Idempotency-Key`, and `x-request-id`; Orders verifies the HS256 access JWT locally and derives the principal from `sub`. It never trusts caller-supplied identity headers and never exposes this internal path as a browser route.

Orders uses `CART_INTERNAL_SERVICE_TOKEN` only for Cart checkout read/claim/complete/release operations and `CATALOG_INTERNAL_TOKEN` only for Catalog variant/reservation operations. It persists intent before Catalog reservation, calculates decimal totals without JavaScript floating point, and retries/reconciles using stable attempt IDs. It owns neither Cart Redis state nor Catalog stock.

First accepted checkout is `201 PENDING`; the same idempotency key/body returns `200` with the current `PENDING` or `EXPIRED` state, and uncertainty returns `202 CHECKOUT_PROCESSING`. A `PENDING` order is not payment-confirmed. The Catalog reservation deadline is exactly 15 minutes and is authoritative for expiry. For local migration, rollout, and E2E steps see the [Phase 3 runbook](../../docs/architecture/phase-3.md).
