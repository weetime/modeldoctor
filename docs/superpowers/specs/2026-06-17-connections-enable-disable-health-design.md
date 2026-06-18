# Connections: enable/disable (archive) + on-demand health test

Date: 2026-06-17
Status: Approved (design)

## Motivation

Connections that have been used in a quality-gate **evaluation run** cannot be
deleted — the `EvaluationRun.endpointA/endpointB` FKs are `onDelete: Restrict`
on purpose (the A/B comparison would lose meaning if an endpoint vanished).
PR #297 turns the resulting 500 into a readable 409, but the user still can't
get a stale historical connection out of their way.

The fix is an **archive** affordance, not deletion: an `enabled` flag. A
disabled connection disappears from the list (by default) and from every
endpoint picker, but its history and the evaluation runs that reference it
stay intact.

Separately, users want a quick way to check whether a connection's endpoint is
reachable. We add an **on-demand "Test connection"** action (Grafana
datasource "Test" style) rather than a persistent health column — browsers
can't probe the internal inference endpoints directly (CORS + network
isolation), so any health check must go through the backend, and a per-row
always-on probe would be heavy and stale.

## Non-goals (YAGNI)

- No persistent "health" column in the table.
- No periodic/background health polling or scheduler.
- No Prometheus `up`-based liveness derivation.
- No new dedicated enable/disable endpoint (reuse `PATCH`).

## Requirements

1. A connection has an `enabled` state (default `true`).
2. The connections list defaults to showing only enabled connections, with a
   status filter (All / Enabled / Disabled) defaulting to **Enabled**.
3. The "…" row menu gains **Enable/Disable** (whichever applies) and **Test
   connection**.
4. Disabling a connection removes it from the 6 `ConnectionPicker` usages
   (playground / benchmark create / quality-gate run create / diagnostics) so
   it can't be picked for new work. Historical filter dropdowns (benchmark
   list, eval-runs list) must still list it so past runs remain filterable.
5. "Test connection" probes the endpoint on demand and reports online/offline.

## Design

### Data layer

- `prisma/schema.prisma` — `Connection` gains `enabled Boolean @default(true)`.
  Migration is an additive column with a default; existing rows become `true`.
  Generate via `prisma migrate dev --create-only`, review SQL, then apply.
- `packages/contracts/src/connection.ts` — `connectionPublicSchema` gains
  `enabled: z.boolean()`. `updateConnectionSchema` (already `.partial()`)
  gains optional `enabled: z.boolean()`.

### Backend

- **List filter.** `GET /api/connections?status=enabled|disabled|all`.
  - `status` parsed via a small zod enum, **default `enabled`**.
  - `ConnectionService.list(userId, status)` adds the `enabled` where-clause
    (`enabled: true` / `false` / omitted for `all`).
  - Defaulting to `enabled` means the 6 `ConnectionPicker` consumers exclude
    disabled connections with **zero code change** on the picker side; callers
    that need everything pass `status=all` explicitly.
- **Enable/Disable.** Reuse `PATCH /api/connections/:id` with `{ enabled }`.
  `updateConnectionSchema` is already partial; the service's update path
  already maps provided fields. Add `enabled` to the mapped fields.
- **Health test.** New `POST /api/connections/:id/health`.
  - Loads the owned connection, decrypts its apiKey, and issues a
    `GET {baseUrl}/v1/models` with the connection's apiKey + custom headers +
    query params, short timeout (~3s).
  - `/v1/models` is chosen over `/health`: every OpenAI-compatible inference
    endpoint exposes it, and a 200 there means the inference path is actually
    reachable (not just a gateway liveness route).
  - Returns `{ status: "online" | "offline", latencyMs?: number,
    modelCount?: number, error?: string }`. Reuses the discovery models-probe
    logic (refactor the shared fetch into a helper if needed; do not duplicate).
  - Contract: `connectionHealthResponseSchema` in `connection.ts`.

### Frontend

- **`useConnections(params?: { status?: "enabled" | "disabled" | "all" })`** —
  default `enabled`. Threads `status` into the query key and the request URL.
  - The 6 `ConnectionPicker` usages keep calling `useConnections()` → get
    enabled-only automatically.
  - `BenchmarkListFilters` and the eval-runs `RunsListFilters` change to
    `useConnections({ status: "all" })` so disabled connections that have
    historical runs remain filterable.
- **New mutations** in `connections/queries.ts`:
  - `useSetConnectionEnabled()` → `PATCH :id { enabled }`, invalidates the
    connections list.
  - `useTestConnection()` → `POST :id/health`, returns the health result (no
    cache; it's an action).
- **ConnectionsPage**:
  - Status filter `<Select>` (All / Enabled / Disabled), default **Enabled**,
    wired into `useConnections({ status })`. Sits alongside the existing
    category/tags filters.
  - "…" `DropdownMenu` per row gains, above the existing Delete:
    - **Test connection** → calls `useTestConnection`, shows a toast
      (online + latency, or offline + reason). The menu item shows a brief
      loading state while probing.
    - **Enable** or **Disable** (whichever the current `enabled` is not) →
      `useSetConnectionEnabled`, success/err toast.
  - Disabled rows (visible only under All/Disabled) render muted with a
    "Disabled" badge in the Name cell.
  - No health column added.
- i18n: `connections.json` (zh-CN + en-US) — status filter labels, menu
  labels (test/enable/disable), toast messages (online/offline/enabled/
  disabled/errors). Keep zh/en key parity.

## Affected consumers

| Consumer | Change |
| --- | --- |
| 6× `ConnectionPicker` (playground/benchmark/qg/diagnostics) | none (default `enabled`) |
| `BenchmarkListFilters` (connection filter) | `useConnections({ status: "all" })` |
| `RunsListFilters` (eval-runs endpoint filter) | `useConnections({ status: "all" })` |
| `ConnectionsPage` | status filter + menu actions + disabled-row styling |

## Testing

- **Backend (vitest)**:
  - `list` honors `status` (enabled-only by default, disabled-only, all).
  - `update` persists `enabled`.
  - health endpoint maps a reachable `/v1/models` → `online`, a failing/timeout
    fetch → `offline` (mock the fetch).
- **Frontend (vitest)**:
  - ConnectionsPage status filter defaults to Enabled and re-queries on change.
  - "…" menu Enable/Disable calls the mutation with the toggled value.
  - Test connection shows the online/offline toast.
  - `BenchmarkListFilters`/eval filter request `status=all`.

## Migration / rollout

- One additive Prisma migration (`enabled` column, default true). No data
  backfill needed.
- Single PR, phase-per-commit (schema+contract → backend → frontend → i18n+tests).
</content>
</invoke>
