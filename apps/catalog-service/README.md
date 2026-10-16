# Catalog service

Independent NestJS service on Express, port `3002`. This service owns `catalog_db`,
its Prisma schema, migrations, and generated client (`generated/client`). It does
not access Auth tables or import Auth entities or persistence.

Copy `.env.example` to `.env` inside this directory for local development. From
the workspace root, run `pnpm catalog:prisma:generate`,
`pnpm catalog:prisma:migrate`, and `pnpm --filter @nexo/catalog-service dev`.
PostgreSQL must be available before applying migrations or using catalog routes.
Prisma commands run from this package and load its `.env`; application startup
uses the validated Catalog environment parser. `DATABASE_URL` must use PostgreSQL.

## HTTP contract

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/health` | Liveness only: `{ "status": "ok", "service": "catalog-service" }`; no database query |
| GET | `/products?limit=20&offset=0` | Array of active products; limit 1–100, nonnegative offset, ordered by slug |
| GET | `/products/:slug` | Active product detail; missing/inactive products return 404 |
| GET | `/categories` | Array of categories, ordered by slug |
| POST | `/categories` | Creates a category from `name` and unique lowercase `slug`; requires an ADMIN Auth JWT |
| POST | `/products` | Creates a product and its variants atomically; requires an ADMIN Auth JWT |
| PATCH | `/products/:id` | Updates supplied product fields by UUID; requires an ADMIN Auth JWT |
| PATCH | `/variants/:variantId/stock` | Sets `onHand` without crossing `reserved`; requires an ADMIN Auth JWT |
| DELETE | `/products/:id` | Deletes only when no nonterminal reservation references its variants; requires an ADMIN Auth JWT |

Catalog validates Auth-issued access JWTs locally for the three write endpoints and
requires the signed `ADMIN` role proof. CUSTOMER and anonymous requests are rejected.
CORS currently permits all origins without credentials.

Example create-product body:

```json
{
  "name": "Roasted coffee",
  "slug": "roasted-coffee",
  "description": "A Colombian roast",
  "categoryId": "550e8400-e29b-41d4-a716-446655440001",
  "variants": [
    { "sku": "COF-250", "name": "250 grams", "price": "25000.00", "currency": "COP", "stock": 12 }
  ]
}
```

Product and variant `active` default to `true`; variant `stock` defaults to `0`.
Products require a category and 1–100 variants. Currency accepts three uppercase
letters. Price accepts a nonnegative decimal **string**, up to 16 integral digits
and two decimal places, stored as `Prisma.Decimal` / PostgreSQL `DECIMAL(18,2)`.
Responses use fixed two-decimal strings. JSON numbers, exponents, negatives and
extra fractional precision are rejected, avoiding JavaScript float corruption.
This phase uses two-decimal prices for all currency codes; currency-specific minor
unit policies are deferred.

PATCH permits `name`, `slug`, `description`, `categoryId`, `active`, and `variants`.
Omitted fields are preserved; null and empty patches are rejected. When supplied,
`variants` is the **complete replacement collection** in one nested transaction;
replacement variants receive new UUIDs. Omit it to preserve existing variant IDs.
There is no per-variant patch route in this phase.

Public product responses contain `id`, `name`, `slug`, `description`, `active`,
`category: { id, name, slug }`, and active `variants` with `id`, `sku`, `name`,
`price`, `currency`, `stock`, `active`. Write responses also include inactive
variants so administrators can see what they wrote. Timestamps, relation foreign
keys, and unexpected persistence fields are excluded. Categories expose only
`id`, `name`, `slug`.

Validation rejects unknown fields. Errors follow `{ statusCode, code, message,
requestId }`; database internals are hidden. Unique conflicts return 409, foreign
key errors 400, and missing resources 404. Every response carries `x-request-id`;
valid UUID request IDs are propagated and others are replaced. Pino logs one
completion record with service, request ID, method, path, status, and duration in
milliseconds. Request bodies, query strings and headers are not logged. Helmet
and the global validation/error boundary apply to all routes.

## Phase 3 inventory reservations

Catalog owns `onHand`, `reserved`, and durable stock reservations in `catalog_db`; public and internal availability is always `onHand - reserved`. It is the only service that reserves, publishes, releases, or expires stock. A successful internal reservation atomically locks every requested variant, validates sellability/current price/current availability, reserves all lines or none, and computes its own UTC `reservedAt` and exact 15-minute `expiresAt`.

Orders authenticates private variant and reservation calls with `CATALOG_INTERNAL_TOKEN`. The private endpoints under `/internal/v1/` are not Gateway routes: variant lookup, reserve, reservation status, publish-order, and release. Publication is serialized with expiry and records an immutable revision; Catalog releases reserved quantity exactly once for release/expiry. Orders stores references/snapshots but never updates Catalog stock itself.

`PATCH /variants/:variantId/stock` requires an ADMIN JWT and rejects `onHand` below currently reserved inventory. Product deletion and variant replacement are blocked while nonterminal reservations exist. Catalog's expiry worker runs every second outside test mode. No reservation is an order confirmation or stock consumption in Phase 3.

## Verification

`pnpm --filter @nexo/catalog-service test` exercises the real Nest/Express routes,
DTO validation and Catalog service, replacing only the local Prisma dependency.
Use `typecheck`, `lint`, and `build` scripts for package checks. Migrations are
committed SQL; UUID and `updatedAt` values are managed by Prisma. Apply via
`pnpm catalog:prisma:migrate` against the development `catalog_db` only.
