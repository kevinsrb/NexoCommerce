# Gateway service integration design

## Scope

This change makes the API Gateway the public application API for Auth and Catalog. It adds no Cart capability, message broker, shared persistence, or cross-service database access.

## Public and internal HTTP topology

The browser-facing frontend calls only the Gateway public API. The Gateway forwards the currently implemented endpoints to their owning services over HTTP/REST:

| Public Gateway route | Internal target |
| --- | --- |
| `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/me` | Auth Service `/auth/*` |
| `/api/products`, `/api/products/:slug`, `POST /api/products`, `PATCH /api/products/:id` | Catalog Service `/products/*` |
| `/api/categories`, `POST /api/categories` | Catalog Service `/categories` |

The Gateway obtains target origins only from required `AUTH_SERVICE_URL` and `CATALOG_SERVICE_URL` environment variables. The services retain their own routes and databases, but are not browser API entry points. Their CORS configuration is removed because browser traffic now crosses the Gateway only.

## Gateway forwarding behavior

The Gateway has one small HTTP forwarding service and an explicit controller surface matching the routes above. It preserves the method, query string, JSON body, `Authorization`, `Accept`, and `Content-Type` headers where present. It always sends the Gateway-assigned `x-request-id` to the selected service, allowing the service response and logs to retain the same correlation ID.

An upstream HTTP response keeps its status, content type, and body; the Auth and Catalog public error envelope therefore remains unchanged. Connection failures and timeouts are translated at the Gateway into the existing public error shape with status `503`, code `SERVICE_UNAVAILABLE`, message `Internal service unavailable`, and the Gateway request ID. No internal URL or network detail is exposed.

## Storefront behavior

The featured-products area becomes a client-side catalog boundary. It calls `${NEXT_PUBLIC_API_GATEWAY_URL}/products` with an `Accept: application/json` header, renders ready/empty/error states from that response, and maps the Catalog public product response to the visual card model. The environment variable is a public Gateway URL such as `http://localhost:3003/api`; no web source file mentions a Catalog Service URL.

## Validation

Gateway integration tests use controlled local HTTP servers as real upstreams. They prove Auth forwarding, Catalog forwarding including query strings, `x-request-id` propagation, and a safe 503 when a configured upstream is unavailable. Storefront tests control `fetch` at the network boundary and prove that the public Gateway URL is the sole request target, alongside ready, empty, and error presentation states. The complete workspace build, lint, typecheck, and test commands are required before completion.
