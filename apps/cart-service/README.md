# Cart Service

The Cart service owns temporary Redis-backed customer cart state. Configure `.env` from `.env.example`, start Redis with `pnpm db:up`, and run `pnpm --filter @nexo/cart-service dev` on port `3004`.

`GET /health` is an unauthenticated liveness endpoint for local diagnostics. The authenticated Cart API is intended to be reached through the API Gateway:

- `GET /cart`
- `POST /cart/items`
- `PATCH /cart/items/:variantId`
- `DELETE /cart/items/:variantId`
- `DELETE /cart`

Cart accepts Auth-issued HS256 access JWTs and stores `cart:{userId}` in Redis with a 30-day (`2592000` seconds) TTL. Mutations renew the TTL; reads do not. The stored value contains only currency, variant IDs, quantities, and `updatedAt`. Catalog is queried for current product state, price, currency, and stock through its private batch endpoint.

The first item establishes one Cart currency. A different current currency returns `CART_CURRENCY_MISMATCH`. Cart validates stock but does not reserve or decrement it. Inactive lines remain removable. Cart has no PostgreSQL persistence, Orders, checkout, payments, or sign-in UI.
