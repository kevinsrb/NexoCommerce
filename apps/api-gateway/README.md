# API Gateway

The Gateway is the sole browser/API entry point. It has no application persistence and listens locally on port `3003` under the `/api` prefix. Copy `.env.example` to `.env`; every target is a validated internal HTTP(S) origin.

| Public route family | Internal owner |
| --- | --- |
| `/api/auth/*` | Auth Service |
| `/api/products*`, `/api/categories*` | Catalog Service |
| `/api/cart*` | Cart Service |
| `POST /api/checkout` | Orders `POST /internal/v1/checkouts` |

Swagger is at `/api/docs`. Gateway forwards `Authorization`, `Idempotency-Key` where applicable, JSON body, and a valid/generated `x-request-id`; unavailable or malformed upstream responses become a safe public 503 envelope. It does not expose Catalog, Cart, or Orders private namespaces.

`CHECKOUT_ENABLED` is a server-side kill switch. It defaults to `false` when omitted. With `false`, Gateway rejects new public checkout requests with 503 before calling Orders; it does not stop Orders recovery, Catalog expiry, or Cart claim resolution. Set it explicitly to `true` only after the Phase 3 migrations and Cart key migration are healthy. See the [Phase 3 runbook](../../docs/architecture/phase-3.md) for rollout and rollback procedure.
