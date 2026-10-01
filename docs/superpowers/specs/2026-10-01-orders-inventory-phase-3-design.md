# Phase 3: Orders and Inventory Design

**Status:** Revised after Sentinel NO-GO
**Date:** 2026-10-01

## Scope and non-goals

Phase 3 adds checkout order records and inventory reservations using the existing principal-scoped Cart and Catalog variant model. Orders durably records checkout intent and the order saga; Catalog alone owns stock and reservation lifecycle.

Non-goals: payment authorization/capture, tax, discounts, shipping charges, fulfillment, returns, public order management APIs, inventory receiving, and cross-service distributed transactions.

## Current facts and design assumptions

- Cart is scoped to the authenticated principal; checkout does not accept or depend on a caller-supplied `cart_id`.
- Cart lines identify Catalog variants with `variantId` and quantity.
- Catalog prices are decimal strings. Checkout must preserve and calculate those values without JavaScript floating-point arithmetic.
- Phase 3 adds Cart version/claim metadata and Catalog stock-reservation records. Do not assume Phase 2 already has either capability. These proposed contract additions must be aligned with service owners before implementation.

## Ownership

- **Gateway** forwards the end-user authorization header and trace context unchanged, and enforces the public/private routing boundary. Orders performs local JWT verification and derives the principal identity.
- **Cart** owns the Redis state for the current principal-scoped cart. Phase 3 adds a monotonically increasing version and checkout-claim metadata in the same principal cart key; it atomically claims a version and prevents edits while that claim is active.
- **Catalog** is the sole owner of sellable variants, prices, stock quantities, and the complete reservation lifecycle: reserve, release, expiry, and reservation-aware administrative changes.
- **Orders** owns checkout idempotency/intent, immutable order snapshots, order state, and durable saga progress. It stores Catalog reservation references for recovery, but does not own or mutate reservation state or stock.

No cross-service transaction is assumed. Orders persists intent before asking Catalog to reserve, and retries or compensates using stable operation identifiers.

## Checkout flow and duplicate prevention

1. Client sends the checkout request to Gateway with `Authorization: Bearer <JWT>` and a required `Idempotency-Key`; Gateway creates or forwards `x-request-id`.
2. Orders locally verifies the forwarded HS256 JWT using the existing access-token configuration and requires `sub`, `type: access`, and valid `exp`. It derives `principalId` from `sub`, then atomically inserts/claims a durable checkout attempt before any Catalog reserve call. Uniqueness is enforced for `(principal_id, idempotency_key)`. The attempt records a canonical request hash and stable `checkout_attempt_id`. Same key/hash replays the existing attempt/result; a different hash returns `409 IDEMPOTENCY_KEY_REUSED`.
3. Orders reads the principal-scoped Cart and receives its current `version` and lines `{variantId, quantity}`. It asks Cart to claim that exact version using `checkout_attempt_id`. Cart atomically permits only one active checkout claim for the principal's current cart version. A repeated claim by the same attempt returns the original claim; a competing claim returns conflict. After successful checkout, Cart finalization clears the cart and advances its version, so a second request holding the old version cannot create another order. A stale version returns conflict. While claimed, cart edits fail with `409 CART_CHECKOUT_IN_PROGRESS`.
4. Orders retrieves each variant's authoritative current sellability, decimal-string price, and currency from Catalog. It validates quantities and a single currency, then calculates exact line and order totals. The request's cart prices, if any, are ignored.
5. Orders persists the prepared variant/quantity/price snapshot and `RESERVATION_PENDING` saga state before calling Catalog. It calls Catalog once with the stable attempt ID and complete line set. Catalog atomically reserves all requested variants or none; it returns the same reservation on retries of that attempt.
6. After Catalog confirms reservation, Orders transactionally writes the order, lines, Catalog reservation reference, and `ORDER_RECORDED` attempt state. The order becomes `PENDING` once the reservation and order record are durable. Orders then finalizes/clears Cart using the same claim and version. Cart finalization is idempotent; failure does not undo the accepted order and is retried.
7. Insufficient stock or validation failure causes Orders to ask Cart to release the claim and returns a stable error. If reservation outcome is uncertain, Orders does not release the Cart claim or start a new attempt: recovery queries/retries Catalog using the same attempt ID until the outcome is known, then completes or safely compensates.

### Durable recovery

Checkout attempts move through `CLAIMED → CART_CLAIMED → PREPARED → RESERVATION_PENDING → ORDER_RECORDED → COMPLETE`, with `FAILED` as a terminal result only after any Catalog reservation is confirmed released and the Cart claim is released. Attempt state changes use transactional compare-and-set/version checks. A recovery worker scans nonterminal attempts and resumes idempotently:

- Before Cart claim: retry reading and claiming the current Cart version for the same attempt.
- After Cart claim but before the Orders record contains its result: retry Cart claim with the same attempt ID to retrieve the same claim/version.
- During/after a Catalog timeout: retry reserve or query reservation status with the same attempt ID; Catalog returns the original outcome rather than reserving twice.
- After reservation but before order persistence: retry the Orders transaction. If the attempt is deliberately abandoned, release through Catalog and wait for confirmed release before releasing the Cart claim or marking `FAILED`.
- After order persistence but before Cart finalization: retry Cart finalization without creating another order.

Transient failures remain recoverable and visible; never discard an uncertain attempt or create a new reservation token to bypass it. Alert on attempts exceeding the recovery age threshold.

## Order and checkout state machines

Order states: `PENDING → CONFIRMED → CANCELLED`, and `PENDING → EXPIRED`. `CONFIRMED` means checkout/order acceptance only; it does not imply payment or fulfillment. Cancellation/expiry are terminal in this phase. Expiry is driven by Catalog's reservation expiry notification/status; Orders updates its own order state idempotently. Orders does not independently expire or release stock.

Checkout attempt states and recovery rules are defined above. Invalid transitions return conflict. All transitions use compare-and-set/version checks.

## Price snapshots and totals

At checkout, Orders snapshots the current authoritative Catalog variant price as an exact decimal string, along with `variantId`, currency, quantity, and exact line total. Phase 3 applies no tax, discounts, or shipping: `order total = sum(line quantity × unit price)` in the same currency. Preserve decimal scale/precision from Catalog and serialize the resulting total as a decimal string. Parse and multiply using an exact decimal or base-10 integer-and-scale implementation; never convert price or total to a JavaScript `Number`. Later Catalog price changes do not rewrite an order snapshot.

## Catalog reservations and oversell prevention

Catalog exposes an atomic batch reserve operation over all order variants. In one Catalog database transaction, it locks or conditionally updates variants in stable `variantId` order, verifies each is sellable and sufficiently available, and creates the reservation only if every line succeeds. Availability must never become negative. A stable unique `checkout_attempt_id` is the idempotency token: same token and same normalized lines returns the original reservation; same token with different lines conflicts. Catalog owns the reservation record and state; Orders persists only the returned reservation identifier/reference and saga progress.

Catalog release is conditional and idempotent: only `ACTIVE → RELEASED` restores availability, exactly once. Repeated release returns the existing terminal state. Expiry performs the same one-time transition. Reservation states are `ACTIVE → RELEASED` or `ACTIVE → EXPIRED`; `CONSUMED` is out of scope because fulfillment is out of scope. Orders cannot directly alter these states.

### Reservation-aware Catalog administration

Administrative stock adjustment must use the same Catalog transaction/locking boundary as reservation. A resulting stock quantity may not be lower than active reserved quantity; reject such an update with a conflict and report available/reserved quantities to authorized operators. Variant deletion/replacement is blocked while active reservations refer to that `variantId`. A replacement receives a new `variantId`; active reservations remain attached to the old immutable variant until released/expired. Do not silently transfer reservations or rewrite order snapshots. Catalog's admin API and schema constraints must enforce these rules even when called outside checkout.

## Expiry and release

Catalog computes `expires_at` from its own configured reservation TTL when it creates the reservation; callers cannot set or override it. Catalog persists the deadline in UTC and runs the expiry worker. The worker conditionally claims due `ACTIVE` reservations, transitions each to `EXPIRED`, restores stock once, and emits a durable event or exposes status for Orders reconciliation. Cancellation/release and expiry race through the same conditional transition, so only one restores stock. Orders consumes expiry/release outcomes idempotently to update its attempt/order record and alerts on stale references or failed reconciliation. Orders may request release but may not expire reservations itself.

## Gateway and private HTTP contracts

Public Gateway contract: `POST /v1/checkout`, body `{}` (checkout uses the authenticated principal's current Cart). Required headers: `Authorization: Bearer <JWT>` and `Idempotency-Key`; `x-request-id` is optional on ingress and generated by Gateway when absent. Phase 3 preserves the existing HS256 access JWT contract: Orders verifies the JWT locally, using the existing access-token verification configuration as Cart does, and requires `sub`, `type: access`, and a valid `exp`. Do not add issuer/audience requirements or a Gateway-signed identity context. Gateway forwards the original `Authorization`, `Idempotency-Key`, and `x-request-id` headers unchanged to Orders. Orders derives `principalId` from verified `sub`; it does not accept identity from the body or caller-supplied identity headers. Public endpoints remain JWT-only and do not accept the internal Cart service token.

Proposed private contracts (all require authenticated service-to-service transport and must not be internet-routable):

- Gateway → Orders: `POST /internal/v1/checkouts`, body `{}`, headers original `Authorization`, `Idempotency-Key`, and `x-request-id`. Returns `201` with stable order ID, state, currency, decimal-string total, and line snapshots; an idempotent replay returns the same result/status.
- Orders → Cart: Orders authenticates with the new `CART_INTERNAL_SERVICE_TOKEN` environment secret; Cart validates the same configured secret. Orders never forwards the user's JWT to Cart. Private `POST /internal/v1/cart/read` requires `{principalId}`; `POST /internal/v1/cart/checkout-claims` requires `{principalId, attemptId, expectedVersion}`; `POST /internal/v1/cart/checkout-claims/complete` and `POST /internal/v1/cart/checkout-claims/release` require `{principalId, attemptId, version}`. Every endpoint requires the service token and `x-request-id`. Read returns `{version, lines:[{variantId, quantity}]}`; claim atomically claims the expected version; complete clears the claimed cart idempotently; release removes an uncompleted claim idempotently. Cart keys state by `principalId`; claim/complete/release additionally require the attempt and version to match the stored claim. The token grants only these Cart checkout operations and is not accepted on public endpoints. Orders forwards the same `x-request-id` to Cart for trace continuity; it is correlation metadata, never identity or idempotency proof.
- Orders → Catalog: `GET /internal/v1/variants/{variantId}` returns authoritative `{variantId, sellable, available, price_decimal, currency}`; `available` is point-in-time only, and reservation is the authoritative check. All public and internal Catalog availability reads expose `available`, never raw `onHand` as purchasable stock. `POST /internal/v1/reservations` accepts `{attemptId, lines:[{variantId, quantity}]}` and atomically reserves all lines; Catalog computes and persists expiry, and no caller expiry field is accepted. `GET /internal/v1/reservations/by-attempt/{attemptId}` returns the idempotent outcome. `DELETE /internal/v1/reservations/by-attempt/{attemptId}` requests conditional idempotent release. Catalog emits or exposes durable reservation state changes for expiry/release reconciliation.

Use error body `{code, message, request_id, details?}` without internal exception details. Expected codes: `400 INVALID_REQUEST`; `401 UNAUTHENTICATED`; `403 FORBIDDEN`; `404 VARIANT_NOT_FOUND`; `409 IDEMPOTENCY_KEY_REUSED`, `409 CART_VERSION_CHANGED`, `409 CART_CHECKOUT_IN_PROGRESS`, `409 INSUFFICIENT_STOCK`, `409 RESERVATION_LINES_MISMATCH`; `422 CART_EMPTY`, `422 VARIANT_UNSELLABLE`, `422 MIXED_CURRENCY`; `429 RATE_LIMITED`; `503 DEPENDENCY_UNAVAILABLE`. Gateway preserves known codes and maps unknown upstream errors to generic `503`. `x-request-id` is validated/generated at Gateway and propagated through all calls/logs; it is tracing only, never an idempotency token. Do not log JWTs or full cart contents.

## Schemas and migrations

Orders owns:

- `checkout_attempts(id, principal_id, idempotency_key, request_hash, cart_version, cart_claim_ref, state, saga_version, reservation_ref, failure_code, created_at, updated_at)` with unique `(principal_id, idempotency_key)`.
- `orders(id, checkout_attempt_id, principal_id, cart_version, state, currency, total_decimal, created_at, updated_at, version)` with unique `checkout_attempt_id` and unique `(principal_id, cart_version)` to prevent duplicate accepted orders while allowing a safely failed checkout to be retried.
- `order_lines(id, order_id, variant_id, quantity, unit_price_decimal, line_total_decimal, currency, variant_snapshot)` with positive-quantity checks and FK to order.
- `outbox(id, event_type, aggregate_id, payload, created_at, available_at, attempts, completed_at)` for durable recovery/reconciliation work, indexed by pending work.

Cart's Phase 3 Redis migration stores lines, monotonically increasing `version`, active claim `{attemptId, version}`, and last terminal attempt metadata in the same principal cart key. Claim uses one atomic Lua/script transaction: require an existing unexpired key, compare `expectedVersion`, allow only no active claim or the same `attemptId`, store the claim, and remove the key TTL (`PERSIST`). A claimed key is non-expiring until Orders terminally completes or releases the attempt; no lease expiry can silently unlock it. Every cart mutation uses an atomic script that rejects while claimed and increments `version` on successful mutation. Complete requires matching `principalId`, `attemptId`, and claimed version, clears lines and claim, advances version, records terminal completion for idempotent retries, and restores the normal unclaimed-cart TTL. Release requires the same binding, clears only the claim (preserving lines/version), records terminal release, and restores the normal TTL. Repeated terminal calls by that attempt return the recorded result; stale/mismatched attempts cannot modify the cart.

An absent/expired cart is not implicitly created by claim: private read and claim return `404 CART_NOT_FOUND`, which Orders maps to `422 CART_EMPTY` for checkout. Orders keeps its durable attempt and retries only while the original claim outcome can be resolved; an expired/missing key cannot have an active claim because claims are persisted with no TTL. If Orders crashes while a cart is claimed, its recovery worker resumes the durable attempt and calls complete or release. Operators must not delete claimed keys as routine cleanup; recovery/repair must resolve the attempt before key removal. Public Cart routes remain JWT-only and use the same claim-aware mutation scripts.

Catalog owns stock and `stock_reservations(attempt_id, reservation_id, variant_id, quantity, state, expires_at, created_at, updated_at)` with unique attempt/variant constraints and durable expiry state. Catalog reservation requests and reads use the same stable Orders `checkout_attempt_id` as the API's `attemptId`. Orders does not create a competing reservation table or migration in Catalog's database.

Catalog stock invariant is `onHand >= reserved >= 0`; `available = onHand - reserved`. Phase 3 migration adds `onHand` and `reserved`, initializes each existing stock quantity into `onHand`, and sets `reserved = 0`, then validates constraints before switching reads/writes. All public and internal availability reads expose `available`, never raw `onHand` as purchasable stock. Authorized admin views may show `onHand`, `reserved`, and `available`; admin writes may change `onHand` only if the resulting value is at least current `reserved`. Reservation increases `reserved`; release/expiry decreases it exactly once. Admin deletion or variant replacement is rejected while any active reservation refers to the variant; replacement uses a new `variantId` and never transfers active reservations.

Catalog batch reserve takes `attemptId` and all normalized `{variantId, quantity}` lines. In one database transaction it locks variants in stable order, checks sellability and `available`, and either reserves every line or none. It writes a durable reservation record with Catalog-computed expiry in the same transaction. Retries with the same `attemptId` and identical lines return the stored reservation; mismatched lines conflict. Existing stock is migrated as unreserved stock; do not infer reservations from carts. Deploy stock migration and guarded Catalog reads/writes/admin behavior before enabling reservation. Deploy the Cart Redis claim migration and private endpoints, then Orders and disabled Gateway routing. Do not create cart IDs or convert cart lines to SKU; use the existing principal scope and `variantId` contract.

## Tests and rollout

Cover exact decimal multiplication/serialization without floating point; intent uniqueness and concurrent idempotency claims; two different keys racing for the same Cart version; stale-version and edit-during-claim behavior; all-or-none concurrent Catalog reserve proving no oversell; idempotent reserve/release/expiry; reservation-aware admin adjustment and variant replacement; crash/timeout recovery at every checkout boundary; confirmed-release-before-claim-release; JWT validation and spoofed identity rejection; contract/error mapping; and end-to-end success, empty cart, unsellable variant, price change, insufficient stock, duplicate request, and Cart finalization retry.

Roll out behind a server-side flag by cohort. Apply additive migrations, reconcile Catalog stock and active reservation constraints, deploy Cart claim and Catalog reserve/release/expiry/admin protections with checkout disabled, then deploy Orders and Gateway routing disabled. Enable for internal users and a small cohort. Monitor duplicate/replay rates, checkout-attempt recovery age, active reservation age, release/expiry reconciliation failures, stock invariant violations, and outbox lag. Keep a kill switch for new checkout while Cart-claim recovery and Catalog release/expiry continue. Rollback disables new checkout first; retain schemas and data until all attempts and reservations are resolved.

## Sentinel review: resolved technical decisions

The following NO-GO findings are resolved by this design: intent is durable and uniquely claimed before Catalog reserve; principal Cart version claims prevent duplicate checkout; Catalog alone owns reservation and stock lifecycle; Catalog admin stock/variant operations respect active reservations; Catalog computes expiry; Gateway has an explicit JWT/header identity contract; prices remain exact decimal strings with no tax/discount/shipping or floating point; contracts use the current principal-scoped Cart and `variantId`.

## Remaining product decisions

1. Choose the customer-visible Catalog reservation TTL and checkout window; Catalog owns enforcement regardless of the selected duration.
2. Decide whether checkout accepts the latest Catalog price automatically or requires customer reconfirmation when it differs from the price last shown in Cart. The stored order price is always the authoritative Catalog price read during checkout.
3. Decide whether the post-reservation `PENDING` order is immediately shown as accepted/confirmed in the customer experience, or whether Phase 3 needs a separate explicit customer confirmation step before `CONFIRMED`.
