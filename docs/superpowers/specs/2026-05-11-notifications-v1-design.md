# Notifications V1 — Design (Roadmap B / #152)

Status: draft → review
Owner: weetime
Tracking issue: #152 (umbrella #155)
Branch: `feat/notifications-v1`

## Goal

Provide a generic Notification framework so Day-2 ops events (benchmark completion / diagnostics failure, and later SLO breaches from Roadmap C) can be pushed to user-configured channels.

V1 ships two channel adapters — **Slack incoming webhook** and **Generic webhook (POST JSON)** — plus a persistent outbox with retry. Email is deferred (V2).

Success criteria (per #152):

- "Configure a Feishu bot → benchmark completion push" reachable in under 5 minutes.
- Delivery failure retries with exponential backoff (max 3 attempts), failure logged.
- All channels and subscriptions reachable through both Web UI and MCP tools.

## Non-goals (V1)

- Email channel (V2).
- Custom message templates (V1 ships fixed Slack/webhook templates).
- `slo.breached` event type — placeholder reserved, but the producer ships with Roadmap C (#154).
- Subscription filters beyond `connectionId` (no `scenario`, `minStatusCode`, etc.).
- Channel sharing or team scope (single-user, like Connections).
- Confirmation/approval flow for MCP write tools — single-tenant token already gates access.

## Architecture decisions

### A1. Delivery runtime: DB outbox + `@nestjs/schedule` poll

`notification_deliveries` is the source of truth. Business code only writes rows
(transactionally with the originating event); a `@Cron("*/10 * * * * *")` worker
scans pending / due-retry rows and dispatches them via the appropriate adapter.

Rationale: persistence + observability + cross-restart safety without introducing
BullMQ + Redis (over-engineered for single-node V1). `@nestjs/schedule` is already
wired in `app.module.ts`.

### A2. Secret encryption: reuse `CONNECTION_API_KEY_ENCRYPTION_KEY`

Webhook URLs are secrets (anyone with the URL can post). Encrypt at rest using
the shared AES-GCM helper at `apps/api/src/common/crypto/aes-gcm.ts`
(`encrypt`/`decrypt`/`decodeKey`) with `CONNECTION_API_KEY_ENCRYPTION_KEY` — the
same scheme used by `LlmJudgeProvider` and `Connection.apiKeyCipher`. No new env
var.

Stored shape: `config = { url: "<aes-gcm ciphertext string>" }`. Read endpoints
return the URL masked (`https://hooks.slack.com/services/***`). Decryption
happens only in `dispatcher.service` (real dispatch) and the synchronous test
path inside `channels.service.test()`.

### A3. Event emission: synchronous, in-trx outbox writes

No `@nestjs/event-emitter`. The producing service (`BenchmarkService`,
`DiagnosticsService`) injects `NotifyService` and calls
`notify.emit(eventType, payload)` inside the same Prisma transaction that mutates
state. `emit` synchronously queries matching subscriptions and inserts
`NotificationDelivery` rows. This keeps "did the user get notified?" tied to
"did the state change commit?", and avoids stale-cache concerns of a separate
event bus.

### A4. MCP scope: full 5 tools (read + write)

Breaks from the V1 "read-only" stance of PR #167 because channel/subscription
config is a high-frequency LLM-driven operation ("subscribe me on Slack to
failures of connection X"). Single-tenant MCP token + per-user data scope is
sufficient gating; we will *not* introduce a generic confirmation layer.

### A5. UI placement: top-level `/notifications`

Peer of `Connections` and `Settings` in the sidebar's top-of-rail. Channel CRUD
and subscription CRUD are too large to embed as a `SettingsPage` section.

## Data model

```prisma
enum ChannelType {
  slack
  webhook
}

// Status semantics:
//   pending     — never attempted; dispatcher picks up immediately
//   sent        — terminal success
//   failed      — last attempt errored; transient vs terminal distinguished by
//                 `nextRetryAt`: non-null → still in retry window (dispatcher
//                 picks up when `nextRetryAt <= NOW()`); null → terminal (3 attempts exhausted)
enum DeliveryStatus {
  pending
  sent
  failed
}

model NotificationChannel {
  id          String    @id @default(cuid())
  userId      String
  type        ChannelType
  name        String
  config      Json      // { url: "<encrypted>" } for both slack and webhook
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  user           User                       @relation(fields: [userId], references: [id], onDelete: Cascade)
  subscriptions  NotificationSubscription[]
  deliveries     NotificationDelivery[]
  @@index([userId])
  @@map("notification_channels")
}

model NotificationSubscription {
  id         String   @id @default(cuid())
  channelId  String
  eventType  String   // "benchmark.completed" | "benchmark.failed" | "diagnostics.failed"
  filter     Json?    // { connectionId?: string }
  createdAt  DateTime @default(now())
  channel    NotificationChannel @relation(fields: [channelId], references: [id], onDelete: Cascade)
  @@index([channelId, eventType])
  @@map("notification_subscriptions")
}

model NotificationDelivery {
  id           String         @id @default(cuid())
  channelId    String
  eventType    String
  payload      Json
  status       DeliveryStatus @default(pending)
  attempts     Int            @default(0)
  lastError    String?
  nextRetryAt  DateTime?
  createdAt    DateTime       @default(now())
  sentAt       DateTime?
  channel      NotificationChannel @relation(fields: [channelId], references: [id], onDelete: Cascade)
  @@index([status, nextRetryAt])
  @@map("notification_deliveries")
}
```

`User` model gets back-refs `notificationChannels NotificationChannel[]` (cascade).

Migration is created via `prisma migrate dev --create-only` (no hand-written SQL).

## Backend module (`apps/api/src/modules/notifications/`)

```
notifications.module.ts            // imports PrismaModule; exports NotifyService
notifications.controller.ts        // REST endpoints (JWT-guarded like rest of api)
channels.service.ts                // create / list / update / delete / test
subscriptions.service.ts           // create / list / delete
notify.service.ts                  // emit(eventType, payload) → fan-out → insert outbox
dispatcher.service.ts              // @Cron worker: scan + dispatch + retry
adapters/
  slack.adapter.ts                 // POST { text } to webhook URL
  webhook.adapter.ts               // POST whole payload
  index.ts                         // typed dispatch by ChannelType
notifications.dto.ts               // zod schemas; mirror to packages/contracts
```

### `NotifyService.emit(eventType, payload)`

1. Within the caller's `prisma.$transaction(...)` (passed in as the `tx` arg, like other services do):
2. Fetch subscriptions where `eventType` matches and `filter.connectionId` either matches `payload.connectionId` or is null.
3. For each matched subscription, insert one `NotificationDelivery(status=pending)`.

### `DispatcherService` (`@Cron("*/10 * * * * *")`)

```
const now = new Date()
const due = await tx.notificationDelivery.findMany({
  where: {
    OR: [
      { status: "pending" },
      { status: "failed", attempts: { lt: 3 }, nextRetryAt: { lte: now } },
    ],
  },
  take: 50,
  include: { channel: true },
})

for each row:
  try:
    adapter[row.channel.type].send(decrypt(row.channel.config.url), row.payload)
    update row → { status: "sent", sentAt: now, lastError: null }
  catch (e):
    attempts += 1
    if attempts >= 3:
      update row → { status: "failed", lastError: e.message, nextRetryAt: null }
    else:
      // backoff: attempt 1 fail → +30s, attempt 2 fail → +5min
      const delaySec = attempts === 1 ? 30 : 300
      update row → { status: "failed", attempts, lastError: e.message, nextRetryAt: now + delaySec }
```

Single-instance assumption — no row-level lock; if we ever scale to multiple replicas we'll switch to `SELECT … FOR UPDATE SKIP LOCKED`. Tracked as a follow-up only if it becomes real (YAGNI).

### Event producer wiring

- `BenchmarkService` — on transition into `completed` / `failed`, call `notify.emit("benchmark.completed"|"benchmark.failed", { benchmarkId, name, status, scenario, tool, connectionId, summaryMetrics })` inside the same tx that updates `benchmarks`.
- `DiagnosticsService` — on run completion with any probe failure, call `notify.emit("diagnostics.failed", { runId, connectionId, failingProbes })`.

Both producers depend on the existing `OnModuleInit`-style DI; no new bus.

### Adapters

`slack.adapter.ts`:
```ts
export async function send(url: string, payload: EventPayload): Promise<void> {
  const text = formatSlackText(payload);   // V1 fixed template per eventType
  const res = await safeFetch(url, { method: "POST", body: JSON.stringify({ text }), headers: { "content-type": "application/json" }, timeoutMs: 5000 });
  if (!res.ok) throw new NotificationDeliveryError(`slack returned ${res.status}`);
}
```

`webhook.adapter.ts`:
```ts
export async function send(url: string, payload: EventPayload): Promise<void> {
  const res = await safeFetch(url, { method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json" }, timeoutMs: 5000 });
  if (!res.ok) throw new NotificationDeliveryError(`webhook returned ${res.status}`);
}
```

Both reuse `apps/api/src/modules/connection/discovery/safe-fetch.ts` (SSRF guard,
redirect re-validation, 1 MB body cap).

## REST API

All routes under `/api/notifications`, JWT-guarded (same global auth as other api routes).

```
GET    /channels                         → list (URL masked)
POST   /channels                         → { type, name, url } → 201 Channel
PATCH  /channels/:id                     → { name?, url? }
DELETE /channels/:id                     → 204 (cascades subscriptions + deliveries)
POST   /channels/:id/test                → 200 { ok: true } or 502 { error: "..." }

GET    /subscriptions                    → list (with channel name)
POST   /subscriptions                    → { channelId, eventType, connectionId? } → 201
DELETE /subscriptions/:id                → 204
```

DTOs live in `notifications.dto.ts` and are mirrored to `packages/contracts/src/` so the web app's react-query layer is typed end-to-end.

`POST /channels/:id/test` synchronously inserts a `NotificationDelivery(eventType: "test", payload: { message: "Test notification from ModelDoctor" })` and immediately runs one dispatcher pass on that single row, returning success or the first error. Not subject to the scheduler.

## MCP tools

In `apps/api/src/modules/mcp/tools/`, four new files:
- `list-channels.tool.ts` — read
- `create-channel.tool.ts` — write { type, name, url }
- `subscribe.tool.ts` — write { channelId, eventType, connectionId? }
- `unsubscribe.tool.ts` — write { subscriptionId }
- `test-channel.tool.ts` — write-like { channelId }

All register via the existing `_register.ts` wrapper (TS2589 workaround). `mcp.service.ts` registers them alongside the existing 4 read-only tools.

Auth: existing `McpAuthGuard` + `MCP_USER_ID`. No additional confirmation.

## Web UI

### Sidebar

In `apps/web/src/components/sidebar/sidebar-config.tsx`:

```ts
{ to: "/notifications", icon: Bell, labelKey: "items.notifications" },
```

Inserted in the top-of-rail array between `Connections` and `Settings`.

i18n keys: `sidebar:items.notifications` (zh-CN: "通知" / en-US: "Notifications").

### `/notifications` page (`apps/web/src/features/notifications/NotificationsPage.tsx`)

```
PageHeader title="通知" subtitle="配置 Slack / Webhook 通道与订阅"
└─ <div className="px-8 py-6 space-y-6">
    <FormSection title="通道">
      <ChannelsTable rows={...} onEdit onDelete onTest />
      <Button>+ 新建通道</Button>
      <ChannelDialog />          // type select / name / url / inline Test
      <DeleteChannelDialog />    // AlertDialog with confirm
    </FormSection>
    <FormSection title="订阅">
      <SubscriptionsTable rows={...} onDelete />
      <Button>+ 新建订阅</Button>
      <SubscriptionDialog />     // channel select / eventType select / ConnectionPicker (allowManual=false, optional)
    </FormSection>
   </div>
```

Conventions (per CLAUDE.md):
- No breadcrumbs (top-level page).
- V1 has no detail page — edit happens in a dialog. Channels-table first column is the plain name string (not a link). This is a documented exception to the `feedback_list_page_actions_pattern` "first column links to detail" rule, justified by the absence of a per-channel detail view.
- `操作` column: `编辑` (opens dialog) + `测试` (channels only) + `删除` (AlertDialog).
- React Query keys: `["notifications", "channels"]`, `["notifications", "subscriptions"]`.
- Forms use shadcn `Form` + `useForm(zod)` + `FormActions(cancel, submit)`.
- i18n: `apps/web/src/locales/{zh-CN,en-US}/notifications.json`.

## Testing

Unit (`*.spec.ts`):
- `channels.service.spec.ts` — CRUD, masking, encryption roundtrip.
- `subscriptions.service.spec.ts` — filter validation.
- `notify.service.spec.ts` — fan-out matches by eventType + connectionId.
- `dispatcher.service.spec.ts` — backoff timing (attempt 1 → +30s, attempt 2 → +5min, attempt 3 → failed terminal); success path; SSRF-blocked URL handling.
- Adapters — payload shape and error mapping.

E2E (`apps/api/test/e2e/notifications.e2e-spec.ts`):
- Happy path: create channel → create subscription → trigger benchmark completion (insert a row via Prisma directly to keep it deterministic) → tick dispatcher → assert outbound fetch was called once with expected payload.
- Test endpoint: `POST /channels/:id/test` invokes adapter exactly once.
- MCP guard test pattern reused for any new MCP tool integration check.

Web tests: minimal — `NotificationsPage.test.tsx` smoke render with mocked api responses (`vi.mock("@/lib/api-client")` per memory).

## i18n

`apps/web/src/locales/{zh-CN,en-US}/notifications.json` with sections `page.*`, `channel.*`, `subscription.*`, `delete.*`, `test.*`. Sidebar key added in `sidebar.json`.

## Deferred / follow-ups

After merge, comment on #152 with V2 backlog (email, custom templates, multi-dim filters, `slo.breached` producer in Roadmap C) per `feedback_temp_followups`.

## Open risks

- **Dispatcher concurrency**: V1 assumes single api instance. If horizontal scale lands before C, dispatcher needs row-level locking. Mitigation: the model+index are designed to make `SELECT FOR UPDATE SKIP LOCKED` a one-line addition.
- **Slack rate limit**: Slack returns 429 with `Retry-After` for incoming-webhook spam. V1 maps 429 to a normal failure (counts against the 3-attempt budget). Acceptable for low-volume V1; not adequate at Watcher-scale (Roadmap C will revisit).
- **Webhook receiver auth**: V1 does *not* HMAC-sign outbound payloads. Generic receivers wanting auth must use a secret in their URL (path/query). V2 may add a per-channel signing secret.
