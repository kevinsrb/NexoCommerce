# ADR 002: Logical database per service

## Context

Auth and Catalog evolve at different rates and contain unrelated domain data. Sharing tables, entities, or migrations would couple their release and schema decisions. Local development still benefits from a compact Docker Compose setup rather than operating several database servers.

## Decision

Give Auth ownership of `auth_db` and Catalog ownership of `catalog_db`. Docker Compose starts one PostgreSQL container whose initialization SQL creates both databases. Each service maintains a private Prisma schema, migrations directory, generated client, and Prisma service; neither service accesses the other service's tables or imports its persistence code.

## Consequences

Service data can change independently and future deployment can place the databases on separate infrastructure without changing ownership. Developers must generate and deploy both Prisma clients/migrations during local setup, and connection strings must target the correct database. The Phase 1 isolation is logical rather than physical because the two databases share one local PostgreSQL container; it is not a claim of production-grade fault isolation.
