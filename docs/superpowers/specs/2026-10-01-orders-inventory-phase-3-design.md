# Phase 3: Orders and Inventory Design

**Status:** Draft for Sentinel review  
**Date:** 2026-10-01

## Scope and non-goals

Phase 3 adds order placement and inventory reservation to the existing NexoCommerce checkout path. It covers the private service contracts, durable order and reservation records, stock safety, retry behavior, and operational rollout.

Non-goals: payments or payment capture, fulfillment/shipping, returns, customer-facing order APIs, inventory receiving/adjustments, product or cart redesign, and distributed transactions across services. Payment authorization, if already present, remains outside the order/inventory transaction and needs an explicit compensation policy before integration.

## Current facts and assumptions

- This work is in the isolated `phase-3-orders` worktree and is a design-only phase here; no runtime implementation or migration is included.
- The requested system participants are HTTP Gateway, Cart, Catalog, and the new order/inventory capability.
- No repository-specific service topology, persistence engine, existing schemas, or deployed contract details were supplied for this design. Names and ownership below are recommendations, not claims about current implementation.
- Gateway is treated as the private service-to-service entry point; direct public access to Cart, Catalog, and Orders is out of scope.

## Recommended ownership

Introduce an **Orders service** as the source of truth for order lifecycle, order-line price snapshots, and reservation lifecycle. It owns the Orders and Reservations tables and orchestrates placement. Catalog owns sellable product data and stock quantities; only Catalog may mutate available stock. Cart owns mutable cart contents and does not own checkout prices or stock. Gateway authenticates callers, enforces private routing, propagates request context, and forwards the checkout command.

Catalog must expose one atomic reserve operation that checks and decrements stock in its own database. Orders calls it per SKU in stable SKU order, then creates order/reservation records. Because there is no cross-service transaction, Orders compensates successful reservations if any later reservation or order write fails. The reservation operation accepts an idempotency key so retries cannot decrement twice. This design favors explicit compensation and reconciliation over pretending a distributed transaction is atomic.

## Checkout flow

1. Client submits checkout to Gateway with the cart identifier and an `Idempotency-Key`.
2. Gateway authenticates the caller and forwards identity, `x-request-id`, and idempotency key to Orders.
3. Orders loads the cart through Cart, validates ownership and non-empty lines, and requests current authoritative SKU, sellability, and unit-price data from Catalog. Cart-provided prices are ignored.
4. Orders calculates line totals and grand total using integer minor currency units and a single currency per order. It records immutable item name/SKU, quantity, currency, unit price, and tax/discount amounts where applicable as snapshots.
5. Orders obtains stock reservations from Catalog for every distinct SKU in deterministic order. Catalog atomically succeeds only when `on_hand - reserved >= requested`; reserve failure returns insufficient stock. Catalog uses a unique reservation token per order/SKU and makes repeated reserve calls with the same token return the original result.
6. If any reserve fails, Orders releases all reservations already obtained and returns a conflict; no order is accepted. If all succeed, Orders transactionally persists the order, lines, and reservation references in `PENDING` / `ACTIVE` state. A persistence failure triggers release compensation. Failed compensation is retried by a durable reconciliation worker and must alert.
7. On success, Orders returns the stable order representation. Cart is cleared only after the order is durable; clearing is idempotent and failure is retried without changing order acceptance.

Use a transactional outbox (or an equivalent durable work queue) for release, cart-clear, and expiry work so process crashes do not lose compensation. Do not hold a database transaction open while making HTTP calls.

## Order and Reservation state machines

Order states: `PENDING → CONFIRMED → CANCELLED` and `PENDING → EXPIRED`. `PENDING` is created only after all reservations are acquired. `CONFIRMED` means the order was accepted by this phase; it does not imply payment or fulfillment. Cancellation/expiry is terminal for this phase. State updates use compare-and-set/version checks; invalid transitions return conflict. If payment is later integrated, its pending/authorized/failed states require a separate reviewed extension.

Reservation states: `ACTIVE → RELEASED` or `ACTIVE → CONSUMED`; terminal states do not transition. `CONSUMED` is reserved for a later fulfillment/stock-decrement workflow and is not emitted by Phase 3 checkout. Release is idempotent. A reservation has a server-set expiry deadline; expiry releases active stock and moves a still-pending order to `EXPIRED`. Confirmation policy must be decided before implementation: either confirmation makes the reservation non-expiring, or the order remains pending until a later acceptance step.

## Price snapshots

Persist prices as integer minor units plus ISO currency code; never use floating point. Each line stores SKU, display-name snapshot, quantity, unit amount, line subtotal, and applicable tax/discount amounts and source identifiers. The order stores currency, subtotal, tax, discounts, shipping amount if later applicable, and total. Enforce `total = subtotal + tax + shipping - discounts` under a documented rounding rule. Subsequent Catalog price/name changes do not alter existing orders. Reject mixed-currency carts and invalid/negative quantities or amounts.

## Atomic reservations and oversell prevention

Catalog performs reserve in a single database transaction using a conditional update (or row lock): decrement `available`/increase `reserved` only when the requested amount is available. The stock invariant is `on_hand >= reserved >= 0` and `available = on_hand - reserved`. Add a uniqueness constraint on `(reservation_token, sku)`; the same token and same quantity replays successfully, while a quantity mismatch is a conflict. Lock/update SKUs in stable order for multi-SKU requests. Never implement read-then-write availability checks in Orders or Cart. Catalog is responsible for ensuring concurrent requests cannot drive availability below zero.

## Expiry and release

Reservation TTL and expiry worker cadence are configuration, not client inputs. Persist `expires_at` in UTC. A worker claims due active reservations in bounded batches, atomically changes each to released and restores availability once, then emits/records completion. The compare-and-set makes concurrent release, cancellation, and expiry safe. Orders must retry transient release failures with backoff and expose oldest-due age and failure counts. A periodic reconciliation compares active reservation records with Catalog reserved stock and raises discrepancies for repair; automatic repair must be reviewed before enabling.

## Idempotency

Require a caller-provided `Idempotency-Key` for checkout. Scope it by authenticated principal and operation. Store key, canonical request hash, status, and resulting order ID under a uniqueness constraint. Same key and same request returns the original in-progress/final result; same key with a different request returns `409 IDEMPOTENCY_KEY_REUSED`. Retain records at least as long as orders remain retryable. Catalog reserve/release operations use stable order-derived tokens and are independently idempotent. Propagate idempotency through Gateway retries; `x-request-id` is for tracing and is not an idempotency key.

## Private HTTP contracts and errors

All routes below are private, versioned service contracts over authenticated service-to-service HTTP. Gateway exposes only the customer checkout route; internal service routes must not be internet-routable.

- Gateway → Orders: `POST /internal/v1/checkouts`, body `{cart_id}`, headers `Authorization` (caller context), `Idempotency-Key`, `x-request-id`. Returns `201` with order ID, state, currency, totals, and line snapshots, or the stored replay response.
- Orders → Cart: `GET /internal/v1/carts/{cart_id}` returns cart ID, owner ID, and SKU/quantity lines. `DELETE /internal/v1/carts/{cart_id}/contents` is idempotent and owner-scoped; it runs after durable order creation.
- Orders → Catalog: `POST /internal/v1/reservations` with `{reservation_token, order_id, sku, quantity, expires_at}`; `DELETE /internal/v1/reservations/{reservation_token}/{sku}` releases idempotently. Catalog responses include reservation state and authoritative item/pricing data only from its product read endpoint, e.g. `GET /internal/v1/products?sku=...`.
- Orders read path, if needed internally: `GET /internal/v1/orders/{order_id}` returns the persisted order; no customer-facing Orders endpoint is introduced in this phase.

Use a consistent error body: `{code, message, request_id, details?}`. Expected mappings: `400 INVALID_REQUEST` for malformed input; `401 UNAUTHENTICATED`; `403 FORBIDDEN` for ownership/scope failures; `404 CART_NOT_FOUND` or `404 SKU_NOT_FOUND`; `409 INSUFFICIENT_STOCK`, `409 IDEMPOTENCY_KEY_REUSED`, `409 INVALID_STATE_TRANSITION`; `422 CART_EMPTY` or `422 UNSUPPORTED_CURRENCY`; `429 RATE_LIMITED`; `503 DEPENDENCY_UNAVAILABLE` for exhausted transient dependency failures. Never return internal exception details. Gateway preserves these codes and maps unknown upstream failures to a generic `503`.

## Authentication and request tracing

Gateway validates the end-user/session credential and supplies a signed, short-lived internal identity context to Orders. Orders authorizes cart ownership against the authenticated principal, never a caller-supplied owner ID. Service calls use workload identity or mutually authenticated service credentials with least-privilege scopes (`orders:checkout`, `cart:read`, `cart:clear`, `catalog:read`, `catalog:reserve`, `catalog:release`). Reject missing/invalid internal identity and prohibit direct public service access. Gateway creates `x-request-id` if absent, validates length/character set if supplied, and forwards it unchanged through all calls and logs. Do not put credentials, full cart contents, or payment data in logs.

## Schemas and migrations

Recommended Orders schema:

- `orders(id, principal_id, cart_id, state, currency, subtotal_minor, tax_minor, discount_minor, total_minor, created_at, updated_at, expires_at, version)`.
- `order_lines(id, order_id, sku, item_name_snapshot, quantity, unit_minor, subtotal_minor, tax_minor, discount_minor, metadata_snapshot)` with FK to order and positive quantity checks.
- `order_reservations(id, order_id, sku, catalog_token, quantity, state, expires_at, released_at, consumed_at)` unique on `(order_id, sku)` and `(catalog_token, sku)`.
- `idempotency_records(principal_id, operation, key, request_hash, status, order_id, response_snapshot, created_at, expires_at)` unique on `(principal_id, operation, key)`.
- `outbox(id, event_type, aggregate_id, payload, created_at, available_at, attempts, completed_at)` with an index for pending work.

Catalog schema adds/validates stock `on_hand` and `reserved` (or an equivalent available quantity with safe atomic updates), plus `stock_reservations(token, order_id, sku, quantity, state, expires_at, created_at, released_at)` unique on `(token, sku)`. Add checks for positive quantities and valid state values, FK/indexes, and nonnegative stock constraints where supported. Migrations should be additive and backward-compatible: deploy schema first, backfill/validate stock invariants, deploy Catalog reserve/release support, then Orders. Existing stock must be reconciled before enabling checkout; do not infer reservations from carts.

## Tests and rollout

Before enabling traffic, cover unit tests for totals/rounding/state transitions; contract tests for Gateway, Cart, Catalog, and error mapping; database tests for uniqueness and conditional stock updates; concurrency tests proving simultaneous checkouts cannot oversell; retry/idempotency tests for timeouts at each call boundary; compensation and expiry tests including worker crashes; and end-to-end tests for success, empty/invalid carts, price change, insufficient stock, duplicate requests, and Cart clear retry.

Roll out behind a server-side feature flag by tenant/cohort. Apply additive migrations, reconcile Catalog stock, deploy Catalog APIs and workers disabled, deploy Orders and Gateway routing disabled, then enable for internal users and a small cohort. Monitor checkout success/conflict rates, duplicate replay rates, reservation age, release failures, stock invariant violations, and outbox lag. Expand only after reconciliation and error rates are acceptable; keep a kill switch that disables new checkout while preserving release/expiry workers. Rollback disables traffic first; retain data and schema until all active reservations are released or otherwise resolved.

## Decisions Sentinel must review

1. Confirm whether Orders is a new service and Catalog remains the sole stock owner, and identify the actual service/database boundaries.
2. Select the authoritative price/tax/discount source, rounding rules, supported currencies, and whether price is revalidated at final acceptance.
3. Set reservation TTL, expiry cadence, and whether confirmation ends expiry; define behavior if reservation succeeds but Orders persistence or compensation fails.
4. Approve the compensation/outbox/reconciliation design and the operational owner and repair policy for stock drift.
5. Confirm whether payment authorization belongs in this phase; if so, specify ordering, timeout handling, void/refund compensation, and the associated state machine.
6. Validate private route names, identity propagation, workload authentication, error envelope, and caller retry expectations against existing platform conventions.
7. Confirm actual persistence technology and migration constraints, retention for idempotency records, and cohort/monitoring thresholds before production enablement.
