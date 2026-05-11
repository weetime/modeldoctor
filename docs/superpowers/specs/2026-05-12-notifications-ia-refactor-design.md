# Notifications IA Refactor — Design (as-built)

Status: shipped
Owner: weetime
Branch: `feat/notifications-ia-refactor` → PR #171
Tracking issue: #152

## Goal

Reorganise the V1 notifications surface so **a channel is the unit of
management**. Channels live under Settings; each channel's subscriptions
(which connections, which events) are configured inside the same Sheet.

Backend, contracts, MCP tools, schema, encryption, dispatcher — all unchanged.

## Why this shape

We considered three industry-standard placements (Grafana / Sentry / Datadog
/ Linear) and started with a Datadog-style split: channels in Settings,
subscriptions on the Connection. That separation made sense in theory but in
review surfaced two real complaints: (1) too many places to look at to
answer "who gets pinged for this connection", and (2) a global-subscriptions
sub-table felt orphaned.

Pivoted mid-implementation to: **everything for a channel lives in the
channel's Sheet**. Adding a Slack hook and saying "fire for benchmark.failed
across these 3 connections" is one form, one save.

## Design

### Sidebar

Top-rail `🔔 Notifications` removed. Connections + Settings remain.

### `/settings` — summary card

A `SettingSection` named "通知通道" with channel-type counts and a
"subscriptions coverage" line (e.g. "5/12 connections have subscriptions").
"管理 →" button navigates to `/settings/notifications`.

### `/settings/notifications` — list page

Follows our list-page conventions (see CLAUDE.md):

- `PageHeader` with breadcrumbs `Settings › 通知通道`
- `+ New channel` button in `PageHeader` `rightSlot`
- Table columns: name (clickable, opens edit Sheet) · type · created · actions
- Actions cell: `Test` text button + `Pencil` icon + `Trash2` icon
- Delete uses `AlertDialog` confirm

### `ChannelSheet` — one Sheet, two sections

**Section 1: Channel** — type / name / URL (existing fields).

**Section 2: Subscriptions** — collapses what used to be "subscriptions
page":

- Event checkboxes (Benchmark completed / Benchmark failed / Diagnostics failed)
- "All connections" Switch
  - On: backend rows with `connectionId=null` (one per checked event)
  - Off: per-connection multi-select via scrollable checkbox list
- Connection checkbox list is disabled when "All connections" is on
- Tip block: explains Feishu/DingTalk keyword requirement when relevant
  channel type is selected; for `webhook`, shows a code-block sample of the
  outbound payload

### Save semantics

On submit:

1. Create or PATCH the channel itself (PATCH skips the URL field when blank,
   so existing URL is preserved).
2. Diff intended `(connectionId | null, eventType)` pairs against the
   channel's current subscription rows.
3. Issue create + delete subscription requests **in parallel**.

### Open/edit semantics

- Form syncs **once** per (sheet-open transition, channel.id) tuple.
  Subsequent background refetches of subscriptions do not wipe in-flight
  edits.
- Edit mode waits for `useSubscriptions().isSuccess` before seeding the
  Subscriptions section, so the cold-start race (subs query unsettled when
  Sheet first opens) doesn't pre-fill with an empty selection.
- URL field uses a split schema:
  - Create: `z.string().url()` required.
  - Edit: optional; empty = keep existing. Placeholder shows the masked URL.

### Form validation

Two zod schemas in `apps/web/src/features/notifications/schemas.ts`:

- `channelFormCreateSchema` — full validation.
- `channelFormEditSchema` — URL becomes optional with a refine that still
  validates non-empty values as URLs.

`useForm`'s resolver switches at mount time based on `!!channel`.

## Backend / API contract

**Zero changes.** Same Prisma schema, same REST endpoints, same MCP tools.
Frontend now issues many subscription POSTs/DELETEs in parallel at save
time instead of one-at-a-time from a dedicated subscription form.

## i18n

- `sidebar:items.notifications` removed.
- `settings:notifications.section.*` (summary card)
- `settings:notifications.page.*` (sub-route header + breadcrumb)
- `notifications:channel.form.{basicSection,subscriptionsSection,subscriptionsHint,events,eventOptions.*,applyToAll,applyToAllHint,connections,connectionsDisabled,connectionsEmpty,urlEditHint}`

## Removed components

- `apps/web/src/features/notifications/{NotificationsPage,ChannelsSection,SubscriptionsSection,SubscriptionSheet}.tsx`
- Top-rail `/notifications` route + `Bell` sidebar icon

Files retained in `features/notifications/`:

- `ChannelSheet.tsx` — now also hosts the subscriptions form section
- `queries.ts` / `schemas.ts` — hooks + zod schemas

## Non-goals

- Per-connection subscription view (the channel is the unit; if a user wants
  "show all alerts for this connection", that's a future inverse-lookup view).
- Bulk subscription import.
- HMAC signing for outbound webhooks (V2).
- Custom event-payload templates (V2).
- Drag-to-reorder, priority, severity routing — Grafana territory.

## Risks

- **Cold-start race on first sheet open**: mitigated by gating the form sync
  on `subsQuery.isSuccess` in edit mode.
- **Parallel mutation invalidation churn**: `Promise.all` of N create +
  M delete fires N+M `onSuccess` callbacks → N+M invalidations of the
  `["notifications", "subscriptions"]` query key. React-Query coalesces
  identical invalidations within a tick, so this is fine in practice; a
  follow-up could batch via a single `optimisticUpdate` if it ever stutters
  visibly.

## Out of scope

- E2E coverage for the Sheet's Subscriptions section. Existing
  notifications.e2e-spec.ts still covers the dispatcher / adapter path
  end-to-end; the IA refactor is pure UI.
