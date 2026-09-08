# ADR 001: pnpm and Turborepo monorepo

## Context

Nexo Commerce begins with four applications that share TypeScript contracts, configuration parsing, logging, lint rules, testing utilities, and compiler settings. The services must remain independently runnable and separately own their persistence while changes across the repository still need one install, one set of quality commands, and reproducible local development.

## Decision

Use a pnpm workspace with applications in `apps/*` and shared packages in `packages/*`. Use Turborepo as the root task orchestrator for development, build, lint, test, and type-check commands. Share only source-level contracts, configuration, logging, testing, lint, and TypeScript configuration packages. Keep domain modules, Prisma schemas, migrations, generated clients, and repositories within their owning applications.

## Consequences

Developers use one lockfile and root commands such as `pnpm build` while retaining focused commands such as `pnpm --filter @nexo/catalog-service dev`. Workspace dependencies make shared API/type changes visible across consumers at build time. The repository gains tooling and task-graph complexity, so package scripts and workspace boundaries must stay accurate. This decision does not create a shared persistence layer or permit cross-service table access.
