# Cart Service

The Cart service owns Redis-backed principal Cart state. Configure `.env` from `.env.example`, start Redis with `pnpm db:up`, and run `pnpm --filter @nexo/cart-service dev` on port `3004`.

`GET /health` is an unauthenticated liveness endpoint for local diagnostics. The authenticated Cart API is intended to be reached through the API Gateway:

- `GET /cart`
- `POST /cart/items`
- `PATCH /cart/items/:variantId`
- `DELETE /cart/items/:variantId`
- `DELETE /cart`

Cart accepts Auth-issued HS256 access JWTs. Phase 3 stores payload in `cart:data:{principalId}`, a monotonic non-expiring counter in `cart:version:{principalId}`, and active/terminal checkout metadata in `cart:claim:{principalId}`. The payload contains only currency, variant IDs, quantities, and `updatedAt`; unclaimed payloads retain a 30-day (`2592000` seconds) TTL renewed by mutations. Reads do not renew it. Catalog is queried for current product state, price, currency, and available inventory through its private batch endpoint using `CATALOG_INTERNAL_TOKEN`. Redis outages and missing version integrity fail closed as `503 CART_STORAGE_UNAVAILABLE`.

The first item establishes one Cart currency. A different current currency returns `CART_CURRENCY_MISMATCH`. Cart validates current availability but does not reserve/decrement Catalog stock. Inactive lines remain removable.

Orders is the only consumer of the private claim lifecycle and must present `CART_INTERNAL_SERVICE_TOKEN` plus `x-request-id`. It can read a snapshot, atomically claim a Cart version, complete a published checkout (clear Cart and advance version), or release a failed checkout. An active claim preserves the payload without TTL and rejects Cart edits with `409 CART_CHECKOUT_IN_PROGRESS`; it is intentionally not a timeout-based lock. Cart has no PostgreSQL persistence, payments, or sign-in UI.

When upgrading a live Phase 2 Redis dataset, stop Cart writes and run `pnpm --filter @nexo/cart-service migrate:keys`. The migration moves valid legacy `cart:{principalId}` keys atomically and seeds their version. Do not delete version or claimed keys as cleanup; use the [Phase 3 runbook](../../docs/architecture/phase-3.md) to reconcile first.
