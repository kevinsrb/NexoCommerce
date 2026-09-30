# Nexo Commerce — Agent coordination

Last updated: 2026-09-30

## Baseline and dependency graph

The shared baseline is `main` at `dcf7c2e` (Phase 1 and Phase 2). It contains
the API Gateway, Auth Service, Catalog Service, Cart Service, PostgreSQL, and
Redis. The Gateway is the only browser API; Cart uses Catalog's internal batch
lookup and Redis has only temporary cart state.

```text
Phase 1: Auth + Catalog + Gateway
                         ↓
Phase 2: Cart + Redis ───┘
                         ↓
Phase 3: Orders + Inventory (Atlas)
                         ↓
Phase 4: RabbitMQ events (Hermes)
                     ┌───┴────┐
Phase 5: Payments    │        Phase 6: Notifications
      (Mercury)      │             (Echo)
                     ↓
Phase 7: Observability (Argus) — design may proceed alongside service phases
Phase 8: CI/CD (Forge)         — design may proceed alongside service phases
Phase 9: Infrastructure (Titan) — design only until the service topology settles
```

No dependent feature branch may start from a stale `main` revision. The
coordinator creates or refreshes it only after the required dependency has
been integrated locally. Workers use isolated worktrees and must not edit this
shared status file; they report status and findings to the coordinator.

## Current work

| Agent | Phase | Branch | Status | Depends On |
| --- | --- | --- | --- | --- |
| Atlas | 3 | `phase-3-orders` | DESIGN | `main` |
| Hermes | 4 | `phase-4-events` | BLOCKED | Atlas integrated |
| Mercury | 5 | `phase-5-payments` | BLOCKED | Hermes integrated |
| Echo | 6 | `phase-6-notifications` | BLOCKED | Mercury and event contracts |
| Argus | 7 | `phase-7-observability` | DESIGN | Evolving architecture |
| Forge | 8 | `phase-8-cicd` | DESIGN | Evolving architecture |
| Titan | 9 | `phase-9-infrastructure` | DESIGN | Final service topology |
| Sentinel | Review | n/a | BASELINE REVIEW | Current and milestone designs |

## Coordination rules

- Phase 3's order, inventory, reservation, and checkout contracts require a
  written design and Sentinel review before implementation of the critical
  state transitions.
- Design workers may commit documentation only in their own branches. They do
  not alter shared runtime services, contracts, or deployment configuration.
- Every implementation phase requires focused tests plus `build`, `lint`,
  `typecheck`, the complete test suite, a clean worktree, documentation, and
  a Sentinel review where applicable before it is proposed for integration.
- Branches remain unmerged and unpushed until explicit authorization.
