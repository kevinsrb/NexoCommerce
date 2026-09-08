# ADR 003: NestJS with Express

## Context

The backend applications need a consistent HTTP foundation for validation, request correlation, secure headers, CORS, exception handling, structured logs, tests, and Swagger at the gateway. The codebase and its HTTP typings/tests use the Express request/response model.

## Decision

Use NestJS with the Express adapter (`@nestjs/platform-express`) for the API gateway, Auth service, and Catalog service. Create applications as `NestExpressApplication` instances through `NestFactory.create(...)`. Do **not** install or configure Fastify in Phase 1. Configure the shared service convention around Express middleware and Nest global pipes/filters: Helmet, CORS, request IDs, completion logging, validation, and safe public errors.

## Consequences

The services have one familiar middleware model and can use Express-compatible middleware/types consistently. Existing Supertest coverage exercises the same adapter used at runtime. Express may not be the highest-throughput adapter for every future workload, but performance requirements do not justify a second HTTP abstraction now. Moving to Fastify later would be an explicit, cross-service architecture decision because middleware, types, tests, and operational behavior would need review.
