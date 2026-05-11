# Notifications IA Refactor — Design

Status: draft → ready to implement
Owner: weetime
Branch: `feat/notifications-ia-refactor` (stacks on `feat/notifications-feishu-dingtalk` / PR #170)
Tracking issue: #152

## Goal

Reorganise the V1 notifications surface from a standalone top-level
`/notifications` page (channels + subscriptions on one screen) into a
**producer-attached** model that mirrors Datadog / Linear / Sentry:

- **Channels** (where can we send) live in **Settings**
- **Subscriptions** (which connection's events go where) live on **the Connection**

Backend, contracts, MCP tools, schema, encryption, dispatcher — all unchanged.

## Why

`/notifications` co-located two different abstractions:
1. Channel CRUD = global config ("we can post to these places")
2. Subscriptions = business rules ("this connection's failures go here")

Mixing them on one page hides per-connection alert routing in a generic table
and forces users to translate connectionId UUIDs in a flat list. Industry
convergence (see comparison below) is to split them.

| Product | Channels | Subscriptions |
|---------|----------|--------------|
| Grafana | Settings → Contact points | Notification policies (label tree) |
| Sentry | Settings → Integrations | Project → Alert rules |
| Datadog | Settings → Integrations | Per-monitor inline (`@slack-x`) |
| Linear | Settings → Workspace integrations | Personal Settings → matrix |
| PagerDuty | Settings + Integrations | Per-service escalation policy |

**Common thread:** channels are global config in Settings, alert rules attach
to the producer.

## Design

### Sidebar

Remove the top-rail `🔔 Notifications` entry. Connections stays where it is.

### Settings landing page (`/settings`)

Add a new `SettingSection` summarising channel usage with a "管理 →" button
that links to the new sub-route:

```
通知通道
  Slack: 2 个 · 飞书: 1 个 · 钉钉: 1 个 · 通用 Webhook: 0 个
  5/12 个连接配置了订阅                                        [ 管理 → ]
```

The counts come from `useChannels()` + `useSubscriptions()` already exported
from `apps/web/src/features/notifications/queries.ts` — no new endpoints.

### `/settings/notifications` (new sub-route)

A dedicated page with two stacked sections:

1. **通道** — same CRUD table that lives on `/notifications` today. Reuse
   `ChannelSheet` verbatim.
2. **全局订阅 (跨所有连接)** — subscriptions where `filter.connectionId` is
   null. Small table + "+ 新建订阅" Sheet that constrains form to omit
   connection.

Page must follow CLAUDE.md page conventions: `PageHeader` with breadcrumbs
`Settings › 通知通道`, body `<div className="px-8 py-6 space-y-6">`,
sections via `FormSection`.

### ConnectionSheet — new "通知" Tab

`ConnectionSheet` (the existing right-side edit drawer) currently renders one
flat form. Add a `Tabs` row at the top with:

- **基础信息** — current form (default tab)
- **通知** — new section, render only in `edit` mode (creation flow has no
  channel/subscription context yet)

Notification tab content:

```
通道                  事件                       操作
─────────────────────────────────────────────────────
weetime (Slack)       Benchmark 完成,失败       编辑 删除
luck (钉钉)           诊断失败                  编辑 删除

[ + 添加订阅 ]
```

"事件" cell groups multiple subscription rows that share the same channel,
so the UI shows one logical row per (connection, channel) pair even though
the backend stores N rows.

### "+ 添加订阅" Sheet (nested or inline)

Single combined form, multi-event:

```
通道 *        [▼ 单选 dropdown — all channels for this user ]
事件 *        ☑ Benchmark 完成
              ☑ Benchmark 失败
              ☐ 诊断失败
```

On submit: backend creates **N rows** of `NotificationSubscription`, one per
checked event type, all with `channelId` = selected + `filter.connectionId` =
current connection.

Backend supports this with N sequential `POST /api/notifications/subscriptions`
calls (cheaper than adding a bulk endpoint for V1.5; backend stays unchanged).

### Edit semantics

V1.5 still does **not support edit** — the "编辑" action on the per-channel
group row pre-fills the same Sheet with current event selection; on save it
**diffs and applies**:

- Events checked-now-but-not-before → POST create
- Events checked-before-but-not-now → DELETE
- Events checked-in-both → no-op

Frontend computes the diff; backend stays primitive. Acceptable for V1.5 since
each rule is at most 3 events.

Alternative considered: "delete-and-recreate" on edit. Rejected because it
leaves a transient empty state visible to the user; diff is cleaner.

### Connections list — 🔔 column

Add a column between "Tags" and "Actions":

```
🔔 订阅
   3   (3 subscriptions → click jumps to this connection's notifications tab)
   —   (zero — render em-dash, not 0)
```

Source: `useSubscriptions()` grouped by `connectionId`. Adding this column
doesn't change the list endpoint — frontend joins client-side.

### Routes

| Old | New |
|-----|-----|
| `/notifications` | ❌ removed; route returns 404 if anyone hits it |
| `/connections/:id` doesn't exist | unchanged — edit still goes through Sheet |
| — | `/settings/notifications` (new) |

`/notifications` deletion is safe: zero users in production, the page just
moves its content to two new locations.

## Backend / API contract

**Zero changes** to:
- Prisma schema
- REST endpoints (`/api/notifications/...`)
- DTOs / zod schemas
- MCP tools
- AES-GCM encryption
- Dispatcher / adapter logic
- e2e tests

The frontend just consumes the same hooks from different places.

## i18n

- `sidebar:items.notifications` removed
- New keys under `settings:` namespace:
  - `notifications.section.title` ("通知通道")
  - `notifications.section.subtitle`
  - `notifications.section.manageButton` ("管理 →")
  - `notifications.section.summary.{slack,feishu,dingtalk,webhook}` count templates
  - `notifications.page.title`, `notifications.page.breadcrumb`
  - `notifications.globalSubscription.*` (table headers, empty state)
- New keys under `connections:` namespace:
  - `dialog.tabs.basic`, `dialog.tabs.notifications`
  - `dialog.notifications.empty`
  - `dialog.notifications.addButton`
  - `dialog.notifications.columns.{channel,events,actions}`
  - `dialog.notifications.subscriptionsCount` (for the 🔔 column)
- Existing `notifications:` namespace stays (Sheets still use its strings)

## Tests

- Web: `apps/web/src/features/settings/...` — new component test for the
  Settings notifications summary section
- Web: `ConnectionSheet` test extended to cover Tab switching + notifications
  tab empty state
- No new API tests needed (backend unchanged)
- Browser e2e: optional — out of V1.5 scope unless user requests

## Open questions resolved

| Question | Resolution |
|----------|-----------|
| Subscription home | ConnectionSheet Tab |
| Settings channel layout | Independent sub-route `/settings/notifications` |
| Global subscriptions | Same sub-route, second section |
| Bulk create form | Yes — single Sheet, multi-event checkbox |
| Edit support | Yes — frontend diff into create+delete |

## Risks / non-goals

- **Risk**: ConnectionSheet was already large; adding a Tab + sub-Sheet may
  feel cramped at narrow widths. Mitigation: Tab uses shadcn `Tabs` primitive;
  notifications section uses ≤ 1 sub-table. If width becomes painful, V2 can
  promote to a real `/connections/:id` detail page.
- **Non-goal**: No backend bulk endpoint. N sequential POSTs is fine at V1
  scale.
- **Non-goal**: No drag-to-reorder / priority / severity routing — that's
  Grafana territory, V2 if ever.
- **Non-goal**: `/connections/:id` detail page. Reuse ConnectionSheet.
