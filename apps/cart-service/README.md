# Cart Service

The Cart service owns Redis-backed customer cart persistence. Configure it with the values in `.env.example`, then run `pnpm --filter @nexo/cart-service dev`.

`GET /health` is an unauthenticated liveness endpoint. Future Cart API routes use Auth-issued HS256 access JWTs.
