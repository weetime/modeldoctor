# Notifications V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per user preference (`feedback_plan_execution_no_pause`), execute tasks straight through without pausing for confirmation between them.

**Goal:** Add a generic notification framework (Slack incoming webhook + generic JSON webhook) so benchmark and diagnostics events fan out to user-configured channels with retry, exposed through both REST + MCP tools and a `/notifications` web page.

**Architecture:** DB-outbox + `@nestjs/schedule` poll (no Redis). Channel/subscription/delivery models; producer services write delivery rows in the same transaction as their state change; a cron dispatcher scans pending/due rows and posts via adapter. Webhook URLs encrypted with the existing `aes-gcm` helper using `CONNECTION_API_KEY_ENCRYPTION_KEY`.

**Tech Stack:** NestJS + Prisma + zod + react-query + shadcn/ui + react-i18next; `@nestjs/schedule` (already wired); `@modelcontextprotocol/sdk` (already wired); reuses `safeFetch` from `connection/discovery/`.

**Reference spec:** `docs/superpowers/specs/2026-05-11-notifications-v1-design.md`.

**Branch / worktree:** `feat/notifications-v1` at `../feat-notifications-v1` (already created).

---

## File Structure

### Backend (`apps/api/`)

```
apps/api/prisma/schema.prisma                                  # +3 models + User back-ref
apps/api/prisma/migrations/<ts>_add_notifications/             # auto-generated
apps/api/src/modules/connection/discovery/safe-fetch.ts        # extend: method + body
apps/api/src/modules/connection/discovery/safe-fetch.spec.ts   # +POST test
apps/api/src/modules/notifications/
  notifications.module.ts
  notifications.controller.ts
  channels.service.ts             channels.service.spec.ts
  subscriptions.service.ts        subscriptions.service.spec.ts
  notify.service.ts               notify.service.spec.ts
  dispatcher.service.ts           dispatcher.service.spec.ts
  notifications.dto.ts            # zod request/response schemas
  adapters/
    slack.adapter.ts              slack.adapter.spec.ts
    webhook.adapter.ts            webhook.adapter.spec.ts
    index.ts                      # type → adapter dispatch
apps/api/src/modules/mcp/tools/
  list-channels.tool.ts
  create-channel.tool.ts
  subscribe.tool.ts
  unsubscribe.tool.ts
  test-channel.tool.ts
apps/api/src/modules/mcp/mcp.service.ts                       # register 5 new tools + ChannelsService/SubscriptionsService deps
apps/api/src/modules/mcp/mcp.module.ts                        # import NotificationsModule
apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts  # emit on terminal state
apps/api/src/modules/benchmark/benchmark.service.ts           # emit on submit-fail
apps/api/src/modules/benchmark/benchmark.module.ts            # import NotificationsModule
apps/api/src/modules/diagnostics/diagnostics.service.ts       # emit on probe-failed
apps/api/src/modules/diagnostics/diagnostics.module.ts        # import NotificationsModule
apps/api/src/app.module.ts                                    # register NotificationsModule
apps/api/test/e2e/notifications.e2e-spec.ts                   # happy-path e2e
```

### Contracts (`packages/contracts/`)

```
packages/contracts/src/notifications.ts                       # DTO types
packages/contracts/src/index.ts                               # re-export
```

### Web (`apps/web/`)

```
apps/web/src/locales/zh-CN/notifications.json
apps/web/src/locales/en-US/notifications.json
apps/web/src/locales/zh-CN/sidebar.json                       # +items.notifications
apps/web/src/locales/en-US/sidebar.json                       # +items.notifications
apps/web/src/components/sidebar/sidebar-config.tsx            # +entry
apps/web/src/router/index.tsx                                 # +route
apps/web/src/features/notifications/
  NotificationsPage.tsx
  ChannelsSection.tsx
  ChannelDialog.tsx
  SubscriptionsSection.tsx
  SubscriptionDialog.tsx
  queries.ts
  schemas.ts
```

### Plan Coverage

Each spec section maps to tasks 1-16 below. Final task closes #152 and posts V2 backlog comment.

---

### Task 1: Prisma schema + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<auto>_add_notifications/migration.sql` (via `prisma migrate dev --create-only`)

- [ ] **Step 1: Add three models + enum to schema**

Append to `apps/api/prisma/schema.prisma`:

```prisma
enum ChannelType {
  slack
  webhook
}

enum DeliveryStatus {
  pending
  sent
  failed
}

model NotificationChannel {
  id        String      @id @default(cuid())
  userId    String      @map("user_id")
  type      ChannelType
  name      String
  config    Json
  createdAt DateTime    @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt DateTime    @updatedAt @map("updated_at") @db.Timestamptz(3)

  user          User                       @relation(fields: [userId], references: [id], onDelete: Cascade)
  subscriptions NotificationSubscription[]
  deliveries    NotificationDelivery[]

  @@index([userId])
  @@map("notification_channels")
}

model NotificationSubscription {
  id        String   @id @default(cuid())
  channelId String   @map("channel_id")
  eventType String   @map("event_type")
  filter    Json?
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)

  channel NotificationChannel @relation(fields: [channelId], references: [id], onDelete: Cascade)

  @@index([channelId, eventType])
  @@map("notification_subscriptions")
}

model NotificationDelivery {
  id          String         @id @default(cuid())
  channelId   String         @map("channel_id")
  eventType   String         @map("event_type")
  payload     Json
  status      DeliveryStatus @default(pending)
  attempts    Int            @default(0)
  lastError   String?        @map("last_error")
  nextRetryAt DateTime?      @map("next_retry_at") @db.Timestamptz(3)
  createdAt   DateTime       @default(now()) @map("created_at") @db.Timestamptz(3)
  sentAt      DateTime?      @map("sent_at") @db.Timestamptz(3)

  channel NotificationChannel @relation(fields: [channelId], references: [id], onDelete: Cascade)

  @@index([status, nextRetryAt])
  @@map("notification_deliveries")
}
```

Also add to the existing `User` model relations block:

```
notificationChannels NotificationChannel[]
```

- [ ] **Step 2: Generate migration**

```bash
cd apps/api && pnpm exec prisma migrate dev --create-only --name add_notifications
```

Expected: a new directory under `apps/api/prisma/migrations/` containing `migration.sql`. Verify the SQL creates 3 tables, 2 enums, indexes, and FK cascades.

- [ ] **Step 3: Apply migration to dev DB**

```bash
cd apps/api && pnpm exec prisma migrate dev
```

Expected: "Already in sync, no schema change or pending migration was found" or "applied". `pnpm exec prisma migrate status` reports DB up to date.

- [ ] **Step 4: Regenerate Prisma client**

```bash
cd apps/api && pnpm exec prisma generate
```

Expected: `Generated Prisma Client`.

- [ ] **Step 5: Type-check sanity**

```bash
pnpm -F @modeldoctor/api type-check
```

Expected: clean. The models are not yet used anywhere, so the only check is that the schema compiles.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(api): notifications schema (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Extend `safeFetch` to support POST

**Files:**
- Modify: `apps/api/src/modules/connection/discovery/safe-fetch.ts`
- Modify: `apps/api/src/modules/connection/discovery/safe-fetch.spec.ts`

- [ ] **Step 1: Write failing test for POST behaviour**

Append to `apps/api/src/modules/connection/discovery/safe-fetch.spec.ts`:

```ts
describe("safeFetch POST", () => {
  it("forwards method + body and content-type header", async () => {
    const spy = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.method).toBe("POST");
      expect(init.body).toBe('{"hello":"world"}');
      expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
      return new Response("", { status: 200 });
    });
    vi.stubGlobal("fetch", spy);
    const res = await safeFetch("https://httpbin.example/post", {
      method: "POST",
      body: '{"hello":"world"}',
      extraHeaders: { "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm -F @modeldoctor/api test -- safe-fetch.spec
```

Expected: FAIL — method/body not propagated.

- [ ] **Step 3: Extend `SafeFetchOptions` and the fetch call**

In `apps/api/src/modules/connection/discovery/safe-fetch.ts`, extend the interface:

```ts
export interface SafeFetchOptions {
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** HTTP method. Default "GET". */
  method?: "GET" | "POST";
  /** Request body (already serialized; caller sets content-type via extraHeaders). */
  body?: string;
}
```

In the body, change the `fetch(currentUrl, { method: "GET", ...})` call to:

```ts
const res = await fetch(currentUrl, {
  method: opts.method ?? "GET",
  headers,
  body: opts.body,
  redirect: "manual",
  signal: controller.signal,
});
```

- [ ] **Step 4: Run test**

```bash
pnpm -F @modeldoctor/api test -- safe-fetch.spec
```

Expected: PASS (including pre-existing GET tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/connection/discovery/safe-fetch.ts apps/api/src/modules/connection/discovery/safe-fetch.spec.ts
git commit -m "feat(api): safeFetch supports POST method + body (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Slack + webhook adapters

**Files:**
- Create: `apps/api/src/modules/notifications/adapters/slack.adapter.ts`
- Create: `apps/api/src/modules/notifications/adapters/slack.adapter.spec.ts`
- Create: `apps/api/src/modules/notifications/adapters/webhook.adapter.ts`
- Create: `apps/api/src/modules/notifications/adapters/webhook.adapter.spec.ts`
- Create: `apps/api/src/modules/notifications/adapters/index.ts`

- [ ] **Step 1: Define shared types in `adapters/index.ts`**

```ts
import type { ChannelType } from "@prisma/client";
import { sendSlack } from "./slack.adapter.js";
import { sendWebhook } from "./webhook.adapter.js";

export interface DeliveryPayload {
  eventType: string;
  payload: Record<string, unknown>;
}

export class NotificationDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationDeliveryError";
  }
}

export async function dispatchToChannel(
  type: ChannelType,
  url: string,
  body: DeliveryPayload,
): Promise<void> {
  if (type === "slack") return sendSlack(url, body);
  if (type === "webhook") return sendWebhook(url, body);
  // exhaustive guard
  const _: never = type;
  throw new Error(`Unsupported channel type: ${String(type)}`);
}
```

- [ ] **Step 2: Write failing test for Slack adapter**

`apps/api/src/modules/notifications/adapters/slack.adapter.spec.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationDeliveryError } from "./index.js";
import { sendSlack } from "./slack.adapter.js";

afterEach(() => vi.unstubAllGlobals());

describe("sendSlack", () => {
  it("POSTs { text } payload with formatted message", async () => {
    const spy = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await sendSlack("https://hooks.slack.com/services/AAA/BBB/CCC", {
      eventType: "benchmark.completed",
      payload: { name: "bench-1", status: "completed", connectionId: "c1" },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.com/services/AAA/BBB/CCC");
    expect(init.method).toBe("POST");
    const parsed = JSON.parse(init.body as string) as { text: string };
    expect(parsed.text).toContain("benchmark.completed");
    expect(parsed.text).toContain("bench-1");
  });

  it("throws NotificationDeliveryError on non-2xx response", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    await expect(
      sendSlack("https://hooks.slack.com/services/X", { eventType: "x", payload: {} }),
    ).rejects.toBeInstanceOf(NotificationDeliveryError);
  });
});
```

- [ ] **Step 3: Run test (fails — file missing)**

```bash
pnpm -F @modeldoctor/api test -- slack.adapter.spec
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement Slack adapter**

`apps/api/src/modules/notifications/adapters/slack.adapter.ts`:

```ts
import { safeFetch } from "../../connection/discovery/safe-fetch.js";
import { type DeliveryPayload, NotificationDeliveryError } from "./index.js";

export async function sendSlack(url: string, body: DeliveryPayload): Promise<void> {
  const text = formatText(body);
  const res = await safeFetch(url, {
    method: "POST",
    body: JSON.stringify({ text }),
    extraHeaders: { "content-type": "application/json" },
    timeoutMs: 5000,
  });
  if (!res.ok) {
    throw new NotificationDeliveryError(`slack webhook returned ${res.status}`);
  }
}

function formatText(body: DeliveryPayload): string {
  const tag = `[ModelDoctor] ${body.eventType}`;
  const p = body.payload as Record<string, unknown>;
  const name = typeof p.name === "string" ? p.name : (p.runId as string | undefined) ?? "(unknown)";
  const status = typeof p.status === "string" ? ` status=${p.status}` : "";
  const conn = typeof p.connectionId === "string" ? ` connection=${p.connectionId}` : "";
  return `${tag} ${name}${status}${conn}`;
}
```

- [ ] **Step 5: Run test**

```bash
pnpm -F @modeldoctor/api test -- slack.adapter.spec
```

Expected: PASS.

- [ ] **Step 6: Write failing test for webhook adapter**

`apps/api/src/modules/notifications/adapters/webhook.adapter.spec.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationDeliveryError } from "./index.js";
import { sendWebhook } from "./webhook.adapter.js";

afterEach(() => vi.unstubAllGlobals());

describe("sendWebhook", () => {
  it("POSTs full DeliveryPayload as JSON", async () => {
    const spy = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    await sendWebhook("https://example.test/hook", {
      eventType: "benchmark.failed",
      payload: { name: "bench-x", reason: "timeout" },
    });
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const parsed = JSON.parse(init.body as string) as { eventType: string; payload: { reason: string } };
    expect(parsed.eventType).toBe("benchmark.failed");
    expect(parsed.payload.reason).toBe("timeout");
  });

  it("throws on 4xx", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    await expect(
      sendWebhook("https://example.test/hook", { eventType: "x", payload: {} }),
    ).rejects.toBeInstanceOf(NotificationDeliveryError);
  });
});
```

- [ ] **Step 7: Implement webhook adapter**

`apps/api/src/modules/notifications/adapters/webhook.adapter.ts`:

```ts
import { safeFetch } from "../../connection/discovery/safe-fetch.js";
import { type DeliveryPayload, NotificationDeliveryError } from "./index.js";

export async function sendWebhook(url: string, body: DeliveryPayload): Promise<void> {
  const res = await safeFetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    extraHeaders: { "content-type": "application/json" },
    timeoutMs: 5000,
  });
  if (!res.ok) {
    throw new NotificationDeliveryError(`webhook returned ${res.status}`);
  }
}
```

- [ ] **Step 8: Run all adapter tests**

```bash
pnpm -F @modeldoctor/api test -- adapters/
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/notifications/adapters/
git commit -m "feat(api): slack + webhook notification adapters (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `ChannelsService` (CRUD + encryption)

**Files:**
- Create: `apps/api/src/modules/notifications/channels.service.ts`
- Create: `apps/api/src/modules/notifications/channels.service.spec.ts`

- [ ] **Step 1: Write failing test for encryption + masking roundtrip**

`apps/api/src/modules/notifications/channels.service.spec.ts`:

```ts
import { ConfigService } from "@nestjs/config";
import { type DeepMockProxy, mockDeep } from "vitest-mock-extended";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service.js";
import { ChannelsService } from "./channels.service.js";

const TEST_KEY_BASE64 = Buffer.alloc(32, 7).toString("base64");

function mockConfig(): ConfigService {
  return { get: (_k: string) => TEST_KEY_BASE64 } as unknown as ConfigService;
}

describe("ChannelsService", () => {
  let prisma: DeepMockProxy<PrismaService>;
  let svc: ChannelsService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    svc = new ChannelsService(prisma, mockConfig());
  });

  it("encrypts url on create and returns masked output", async () => {
    prisma.notificationChannel.create.mockResolvedValue({
      id: "c1",
      userId: "u1",
      type: "slack",
      name: "ops",
      config: { url: "<<cipher>>" } as never,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    const out = await svc.create("u1", {
      type: "slack",
      name: "ops",
      url: "https://hooks.slack.com/services/AAA/BBB/CCC",
    });
    expect(out.urlMasked).toBe("https://hooks.slack.com/services/***");
    const createCall = prisma.notificationChannel.create.mock.calls[0][0];
    const storedUrl = (createCall.data.config as { url: string }).url;
    expect(storedUrl.startsWith("v1:")).toBe(true);
  });

  it("decryptUrl returns the original url", async () => {
    const cipher = await svc.encryptForTest("https://example.test/abc");
    expect(svc.decryptUrl(cipher)).toBe("https://example.test/abc");
  });

  it("masks generic webhook url to <scheme>://host/***", async () => {
    expect(svc.maskUrl("https://example.test/path/secret")).toBe("https://example.test/***");
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm -F @modeldoctor/api test -- channels.service.spec
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `ChannelsService`**

`apps/api/src/modules/notifications/channels.service.ts`:

```ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type ChannelType } from "@prisma/client";
import { decodeKey, decrypt, encrypt } from "../../common/crypto/aes-gcm.js";
import type { Env } from "../../config/env.schema.js";
import { PrismaService } from "../../prisma/prisma.service.js";

export interface CreateChannelInput {
  type: ChannelType;
  name: string;
  url: string;
}

export interface UpdateChannelInput {
  name?: string;
  url?: string;
}

export interface ChannelRow {
  id: string;
  type: ChannelType;
  name: string;
  urlMasked: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ChannelsService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    const k = config.get("CONNECTION_API_KEY_ENCRYPTION_KEY", { infer: true });
    if (!k) throw new Error("CONNECTION_API_KEY_ENCRYPTION_KEY is required");
    this.key = decodeKey(k);
  }

  async list(userId: string): Promise<ChannelRow[]> {
    const rows = await this.prisma.notificationChannel.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toRow(r));
  }

  async create(userId: string, input: CreateChannelInput): Promise<ChannelRow> {
    const cipher = encrypt(input.url, this.key);
    const row = await this.prisma.notificationChannel.create({
      data: {
        userId,
        type: input.type,
        name: input.name,
        config: { url: cipher },
      },
    });
    return this.toRow(row);
  }

  async update(userId: string, id: string, input: UpdateChannelInput): Promise<ChannelRow> {
    const existing = await this.prisma.notificationChannel.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException(`Channel ${id} not found`);
    const config = input.url
      ? { url: encrypt(input.url, this.key) }
      : (existing.config as { url: string });
    const row = await this.prisma.notificationChannel.update({
      where: { id },
      data: { name: input.name ?? existing.name, config },
    });
    return this.toRow(row);
  }

  async delete(userId: string, id: string): Promise<void> {
    const existing = await this.prisma.notificationChannel.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException(`Channel ${id} not found`);
    await this.prisma.notificationChannel.delete({ where: { id } });
  }

  /** Load + decrypt url. Internal use (dispatcher, test path). */
  async resolveForDispatch(channelId: string): Promise<{ type: ChannelType; url: string } | null> {
    const row = await this.prisma.notificationChannel.findUnique({ where: { id: channelId } });
    if (!row) return null;
    const cipher = (row.config as { url: string }).url;
    return { type: row.type, url: decrypt(cipher, this.key) };
  }

  // Public for spec convenience; not exposed in module barrel.
  encryptForTest(plain: string): string {
    return encrypt(plain, this.key);
  }
  decryptUrl(cipher: string): string {
    return decrypt(cipher, this.key);
  }

  maskUrl(plain: string): string {
    try {
      const u = new URL(plain);
      return `${u.protocol}//${u.host}/***`;
    } catch {
      return "***";
    }
  }

  private toRow(r: {
    id: string;
    type: ChannelType;
    name: string;
    config: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): ChannelRow {
    const cipher = (r.config as { url: string }).url;
    let urlMasked: string;
    try {
      urlMasked = this.maskUrl(decrypt(cipher, this.key));
    } catch {
      urlMasked = "***";
    }
    return {
      id: r.id,
      type: r.type,
      name: r.name,
      urlMasked,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm -F @modeldoctor/api test -- channels.service.spec
```

Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/notifications/channels.service.ts apps/api/src/modules/notifications/channels.service.spec.ts
git commit -m "feat(api): notification channels CRUD service (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `SubscriptionsService`

**Files:**
- Create: `apps/api/src/modules/notifications/subscriptions.service.ts`
- Create: `apps/api/src/modules/notifications/subscriptions.service.spec.ts`

- [ ] **Step 1: Write failing test**

`apps/api/src/modules/notifications/subscriptions.service.spec.ts`:

```ts
import { type DeepMockProxy, mockDeep } from "vitest-mock-extended";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service.js";
import { SubscriptionsService } from "./subscriptions.service.js";

describe("SubscriptionsService", () => {
  let prisma: DeepMockProxy<PrismaService>;
  let svc: SubscriptionsService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    svc = new SubscriptionsService(prisma);
  });

  it("create persists eventType + optional filter.connectionId", async () => {
    prisma.notificationChannel.findFirst.mockResolvedValue({ id: "c1" } as never);
    prisma.notificationSubscription.create.mockResolvedValue({
      id: "s1",
      channelId: "c1",
      eventType: "benchmark.failed",
      filter: { connectionId: "conn-x" } as never,
      createdAt: new Date(),
    } as never);
    const out = await svc.create("u1", {
      channelId: "c1",
      eventType: "benchmark.failed",
      connectionId: "conn-x",
    });
    expect(out.eventType).toBe("benchmark.failed");
    expect(out.connectionId).toBe("conn-x");
  });

  it("create rejects when channel does not belong to user", async () => {
    prisma.notificationChannel.findFirst.mockResolvedValue(null);
    await expect(
      svc.create("u1", { channelId: "c-other", eventType: "benchmark.completed" }),
    ).rejects.toThrow(/not found/);
  });

  it("list returns subscriptions joined to channel name", async () => {
    prisma.notificationSubscription.findMany.mockResolvedValue([
      {
        id: "s1",
        channelId: "c1",
        eventType: "diagnostics.failed",
        filter: null as never,
        createdAt: new Date(),
        channel: { name: "ops" },
      } as never,
    ]);
    const rows = await svc.list("u1");
    expect(rows[0].channelName).toBe("ops");
    expect(rows[0].connectionId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm -F @modeldoctor/api test -- subscriptions.service.spec
```

Expected: FAIL.

- [ ] **Step 3: Implement `SubscriptionsService`**

`apps/api/src/modules/notifications/subscriptions.service.ts`:

```ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";

export type EventType = "benchmark.completed" | "benchmark.failed" | "diagnostics.failed";

export interface CreateSubscriptionInput {
  channelId: string;
  eventType: EventType;
  connectionId?: string;
}

export interface SubscriptionRow {
  id: string;
  channelId: string;
  channelName: string;
  eventType: EventType;
  connectionId?: string;
  createdAt: Date;
}

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<SubscriptionRow[]> {
    const rows = await this.prisma.notificationSubscription.findMany({
      where: { channel: { userId } },
      orderBy: { createdAt: "desc" },
      include: { channel: { select: { name: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      channelId: r.channelId,
      channelName: r.channel.name,
      eventType: r.eventType as EventType,
      connectionId: (r.filter as { connectionId?: string } | null)?.connectionId,
      createdAt: r.createdAt,
    }));
  }

  async create(userId: string, input: CreateSubscriptionInput): Promise<SubscriptionRow> {
    const channel = await this.prisma.notificationChannel.findFirst({
      where: { id: input.channelId, userId },
    });
    if (!channel) throw new NotFoundException(`Channel ${input.channelId} not found`);
    const row = await this.prisma.notificationSubscription.create({
      data: {
        channelId: input.channelId,
        eventType: input.eventType,
        filter: input.connectionId ? { connectionId: input.connectionId } : undefined,
      },
    });
    return {
      id: row.id,
      channelId: row.channelId,
      channelName: channel.name,
      eventType: row.eventType as EventType,
      connectionId: input.connectionId,
      createdAt: row.createdAt,
    };
  }

  async delete(userId: string, id: string): Promise<void> {
    const existing = await this.prisma.notificationSubscription.findFirst({
      where: { id, channel: { userId } },
    });
    if (!existing) throw new NotFoundException(`Subscription ${id} not found`);
    await this.prisma.notificationSubscription.delete({ where: { id } });
  }
}
```

- [ ] **Step 4: Run test**

```bash
pnpm -F @modeldoctor/api test -- subscriptions.service.spec
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/notifications/subscriptions.service.ts apps/api/src/modules/notifications/subscriptions.service.spec.ts
git commit -m "feat(api): notification subscriptions CRUD service (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `NotifyService` (fan-out)

**Files:**
- Create: `apps/api/src/modules/notifications/notify.service.ts`
- Create: `apps/api/src/modules/notifications/notify.service.spec.ts`

- [ ] **Step 1: Write failing test**

`apps/api/src/modules/notifications/notify.service.spec.ts`:

```ts
import { type DeepMockProxy, mockDeep } from "vitest-mock-extended";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service.js";
import { NotifyService } from "./notify.service.js";

describe("NotifyService", () => {
  let prisma: DeepMockProxy<PrismaService>;
  let svc: NotifyService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    svc = new NotifyService(prisma);
  });

  it("fans out to subscriptions matching eventType + matching/null connectionId", async () => {
    prisma.notificationSubscription.findMany.mockResolvedValue([
      { id: "s1", channelId: "c1", filter: null as never },
      { id: "s2", channelId: "c2", filter: { connectionId: "conn-a" } as never },
      { id: "s3", channelId: "c3", filter: { connectionId: "conn-b" } as never },
    ] as never);
    prisma.notificationDelivery.createMany.mockResolvedValue({ count: 2 } as never);

    await svc.emit({
      eventType: "benchmark.completed",
      userId: "u1",
      connectionId: "conn-a",
      payload: { name: "b-1" },
    });

    // Should have created two rows (s1 + s2, not s3 with mismatched connectionId)
    const arg = prisma.notificationDelivery.createMany.mock.calls[0][0];
    expect(arg.data).toHaveLength(2);
    expect(new Set((arg.data as Array<{ channelId: string }>).map((d) => d.channelId))).toEqual(
      new Set(["c1", "c2"]),
    );
  });

  it("no-op when no matching subscriptions", async () => {
    prisma.notificationSubscription.findMany.mockResolvedValue([] as never);
    await svc.emit({
      eventType: "diagnostics.failed",
      userId: "u1",
      payload: { runId: "r1" },
    });
    expect(prisma.notificationDelivery.createMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm -F @modeldoctor/api test -- notify.service.spec
```

Expected: FAIL.

- [ ] **Step 3: Implement `NotifyService`**

`apps/api/src/modules/notifications/notify.service.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { EventType } from "./subscriptions.service.js";

export interface NotifyInput {
  eventType: EventType;
  userId: string;
  connectionId?: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class NotifyService {
  private readonly log = new Logger(NotifyService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fan out an event to matching subscriptions by inserting outbox rows.
   * Safe to call inside a wider transaction — pass the tx client via the
   * caller's prisma context if you need atomicity with state mutation. V1
   * uses the global prisma instance; the cron dispatcher tolerates orphan
   * rows because outbox rows are created AFTER the state-change update
   * commits.
   */
  async emit(input: NotifyInput): Promise<void> {
    const subs = await this.prisma.notificationSubscription.findMany({
      where: {
        eventType: input.eventType,
        channel: { userId: input.userId },
      },
    });
    const matched = subs.filter((s) => {
      const f = s.filter as { connectionId?: string } | null;
      if (!f?.connectionId) return true;
      return f.connectionId === input.connectionId;
    });
    if (matched.length === 0) {
      this.log.debug(`No subscribers for ${input.eventType} user=${input.userId}`);
      return;
    }
    await this.prisma.notificationDelivery.createMany({
      data: matched.map((s) => ({
        channelId: s.channelId,
        eventType: input.eventType,
        payload: input.payload as Prisma.InputJsonValue,
      })),
    });
    this.log.log(`Queued ${matched.length} deliveries for ${input.eventType} user=${input.userId}`);
  }
}
```

- [ ] **Step 4: Run test**

```bash
pnpm -F @modeldoctor/api test -- notify.service.spec
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/notifications/notify.service.ts apps/api/src/modules/notifications/notify.service.spec.ts
git commit -m "feat(api): notify service fan-out to subscriptions (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `DispatcherService` (cron + backoff)

**Files:**
- Create: `apps/api/src/modules/notifications/dispatcher.service.ts`
- Create: `apps/api/src/modules/notifications/dispatcher.service.spec.ts`

- [ ] **Step 1: Write failing test**

`apps/api/src/modules/notifications/dispatcher.service.spec.ts`:

```ts
import { type DeepMockProxy, mockDeep } from "vitest-mock-extended";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../prisma/prisma.service.js";
import * as adapters from "./adapters/index.js";
import type { ChannelsService } from "./channels.service.js";
import { DispatcherService } from "./dispatcher.service.js";

describe("DispatcherService", () => {
  let prisma: DeepMockProxy<PrismaService>;
  let channels: DeepMockProxy<ChannelsService>;
  let svc: DispatcherService;
  let dispatchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    channels = mockDeep<ChannelsService>();
    svc = new DispatcherService(prisma, channels);
    dispatchSpy = vi.spyOn(adapters, "dispatchToChannel");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T00:00:00.000Z"));
  });
  afterEach?.(() => {
    vi.useRealTimers();
    dispatchSpy.mockRestore();
  });

  it("marks delivery sent on success", async () => {
    prisma.notificationDelivery.findMany.mockResolvedValue([
      { id: "d1", channelId: "c1", eventType: "x", payload: {} as never, status: "pending", attempts: 0 } as never,
    ]);
    channels.resolveForDispatch.mockResolvedValue({ type: "slack", url: "https://hooks/" });
    dispatchSpy.mockResolvedValue(undefined as never);

    await svc.tick();

    const updateArg = prisma.notificationDelivery.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: "d1" });
    expect((updateArg.data as { status: string }).status).toBe("sent");
  });

  it("schedules first retry +30s on attempt 1 failure", async () => {
    prisma.notificationDelivery.findMany.mockResolvedValue([
      { id: "d1", channelId: "c1", eventType: "x", payload: {} as never, status: "pending", attempts: 0 } as never,
    ]);
    channels.resolveForDispatch.mockResolvedValue({ type: "slack", url: "https://hooks/" });
    dispatchSpy.mockRejectedValue(new Error("boom"));

    await svc.tick();

    const update = prisma.notificationDelivery.update.mock.calls[0][0].data as {
      status: string;
      attempts: number;
      lastError: string;
      nextRetryAt: Date;
    };
    expect(update.status).toBe("failed");
    expect(update.attempts).toBe(1);
    expect(update.lastError).toBe("boom");
    expect(update.nextRetryAt.toISOString()).toBe("2026-05-11T00:00:30.000Z");
  });

  it("schedules +5min retry on attempt 2 failure", async () => {
    prisma.notificationDelivery.findMany.mockResolvedValue([
      { id: "d1", channelId: "c1", eventType: "x", payload: {} as never, status: "failed", attempts: 1 } as never,
    ]);
    channels.resolveForDispatch.mockResolvedValue({ type: "webhook", url: "https://hooks/" });
    dispatchSpy.mockRejectedValue(new Error("boom"));

    await svc.tick();

    const update = prisma.notificationDelivery.update.mock.calls[0][0].data as {
      attempts: number;
      nextRetryAt: Date;
    };
    expect(update.attempts).toBe(2);
    expect(update.nextRetryAt.toISOString()).toBe("2026-05-11T00:05:00.000Z");
  });

  it("marks terminal failed (nextRetryAt=null) on attempt 3 failure", async () => {
    prisma.notificationDelivery.findMany.mockResolvedValue([
      { id: "d1", channelId: "c1", eventType: "x", payload: {} as never, status: "failed", attempts: 2 } as never,
    ]);
    channels.resolveForDispatch.mockResolvedValue({ type: "webhook", url: "https://hooks/" });
    dispatchSpy.mockRejectedValue(new Error("boom"));

    await svc.tick();

    const update = prisma.notificationDelivery.update.mock.calls[0][0].data as {
      attempts: number;
      nextRetryAt: Date | null;
    };
    expect(update.attempts).toBe(3);
    expect(update.nextRetryAt).toBeNull();
  });
});
```

(If `afterEach` is unused-imported from the harness, replace the `afterEach?.(...)` line with a top-level `afterEach(...)` and add the import.)

- [ ] **Step 2: Run, expect failure**

```bash
pnpm -F @modeldoctor/api test -- dispatcher.service.spec
```

Expected: FAIL.

- [ ] **Step 3: Implement `DispatcherService`**

`apps/api/src/modules/notifications/dispatcher.service.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import { dispatchToChannel } from "./adapters/index.js";
import { ChannelsService } from "./channels.service.js";

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 50;
// Backoff seconds AFTER attempt N (1-indexed). Index 0 unused.
const BACKOFF_SECONDS: Record<number, number> = { 1: 30, 2: 300 };

@Injectable()
export class DispatcherService {
  private readonly log = new Logger(DispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async cron(): Promise<void> {
    try {
      await this.tick();
    } catch (e) {
      this.log.error("Dispatcher tick failed", e as Error);
    }
  }

  /** Public for tests; orchestrates one pass. */
  async tick(): Promise<void> {
    const now = new Date();
    const due = await this.prisma.notificationDelivery.findMany({
      where: {
        OR: [
          { status: "pending" },
          {
            status: "failed",
            attempts: { lt: MAX_ATTEMPTS },
            nextRetryAt: { lte: now },
          },
        ],
      },
      take: BATCH_SIZE,
    });
    if (due.length === 0) return;
    this.log.debug(`Dispatcher processing ${due.length} deliveries`);
    for (const row of due) {
      await this.processOne(row, now);
    }
  }

  private async processOne(
    row: { id: string; channelId: string; eventType: string; payload: unknown; attempts: number },
    now: Date,
  ): Promise<void> {
    const channel = await this.channels.resolveForDispatch(row.channelId);
    if (!channel) {
      await this.prisma.notificationDelivery.update({
        where: { id: row.id },
        data: { status: "failed", lastError: "channel deleted", nextRetryAt: null, attempts: MAX_ATTEMPTS },
      });
      return;
    }
    try {
      await dispatchToChannel(channel.type, channel.url, {
        eventType: row.eventType,
        payload: row.payload as Record<string, unknown>,
      });
      await this.prisma.notificationDelivery.update({
        where: { id: row.id },
        data: { status: "sent", sentAt: now, lastError: null, nextRetryAt: null },
      });
    } catch (e) {
      const attempts = row.attempts + 1;
      const isTerminal = attempts >= MAX_ATTEMPTS;
      const delay = BACKOFF_SECONDS[attempts];
      const nextRetryAt = isTerminal || !delay ? null : new Date(now.getTime() + delay * 1000);
      await this.prisma.notificationDelivery.update({
        where: { id: row.id },
        data: {
          status: "failed",
          attempts,
          lastError: ((e as Error).message ?? String(e)).slice(0, 2048),
          nextRetryAt,
        },
      });
    }
  }

  /** Used by `POST /channels/:id/test` to dispatch a single row immediately. */
  async dispatchById(id: string): Promise<void> {
    const row = await this.prisma.notificationDelivery.findUnique({ where: { id } });
    if (!row) throw new Error(`Delivery ${id} not found`);
    await this.processOne(row, new Date());
  }
}
```

- [ ] **Step 4: Run test**

```bash
pnpm -F @modeldoctor/api test -- dispatcher.service.spec
```

Expected: PASS (4/4). If imports for `afterEach` are missing, add at top: `import { afterEach } from "vitest";`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/notifications/dispatcher.service.ts apps/api/src/modules/notifications/dispatcher.service.spec.ts
git commit -m "feat(api): notification dispatcher with 30s/5min backoff (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Contracts mirror + REST controller + DTOs + module wiring

**Files:**
- Create: `packages/contracts/src/notifications.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/api/src/modules/notifications/notifications.dto.ts`
- Create: `apps/api/src/modules/notifications/notifications.controller.ts`
- Create: `apps/api/src/modules/notifications/notifications.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create contract types**

`packages/contracts/src/notifications.ts`:

```ts
export type ChannelType = "slack" | "webhook";
export type NotificationEventType =
  | "benchmark.completed"
  | "benchmark.failed"
  | "diagnostics.failed";

export interface Channel {
  id: string;
  type: ChannelType;
  name: string;
  urlMasked: string;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string;
  channelId: string;
  channelName: string;
  eventType: NotificationEventType;
  connectionId?: string;
  createdAt: string;
}

export interface CreateChannelRequest {
  type: ChannelType;
  name: string;
  url: string;
}

export interface UpdateChannelRequest {
  name?: string;
  url?: string;
}

export interface CreateSubscriptionRequest {
  channelId: string;
  eventType: NotificationEventType;
  connectionId?: string;
}

export interface TestChannelResponse {
  ok: boolean;
  error?: string;
}
```

- [ ] **Step 2: Re-export from contracts barrel**

Append to `packages/contracts/src/index.ts`:

```ts
export * from "./notifications.js";
```

- [ ] **Step 3: Rebuild contracts package**

```bash
pnpm -F @modeldoctor/contracts build
```

Expected: success.

- [ ] **Step 4: Write DTO zod schemas**

`apps/api/src/modules/notifications/notifications.dto.ts`:

```ts
import { z } from "zod";

export const channelTypeSchema = z.enum(["slack", "webhook"]);
export const eventTypeSchema = z.enum([
  "benchmark.completed",
  "benchmark.failed",
  "diagnostics.failed",
]);

export const createChannelSchema = z.object({
  type: channelTypeSchema,
  name: z.string().min(1).max(100),
  url: z.string().url(),
});

export const updateChannelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
});

export const createSubscriptionSchema = z.object({
  channelId: z.string().min(1),
  eventType: eventTypeSchema,
  connectionId: z.string().min(1).optional(),
});

export type CreateChannelDto = z.infer<typeof createChannelSchema>;
export type UpdateChannelDto = z.infer<typeof updateChannelSchema>;
export type CreateSubscriptionDto = z.infer<typeof createSubscriptionSchema>;
```

- [ ] **Step 5: Write controller**

`apps/api/src/modules/notifications/notifications.controller.ts`:

```ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { ChannelsService } from "./channels.service.js";
import { DispatcherService } from "./dispatcher.service.js";
import {
  createChannelSchema,
  createSubscriptionSchema,
  updateChannelSchema,
} from "./notifications.dto.js";
import type { CreateChannelDto, CreateSubscriptionDto, UpdateChannelDto } from "./notifications.dto.js";
import { SubscriptionsService } from "./subscriptions.service.js";
import { PrismaService } from "../../prisma/prisma.service.js";

function userIdOf(req: Request): string {
  const u = (req as Request & { user?: { sub?: string } }).user;
  if (!u?.sub) throw new BadRequestException("Missing user context");
  return u.sub;
}

@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly channels: ChannelsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly dispatcher: DispatcherService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("channels")
  list(@Req() req: Request) {
    return this.channels.list(userIdOf(req));
  }

  @Post("channels")
  create(@Req() req: Request, @Body(new ZodValidationPipe(createChannelSchema)) body: CreateChannelDto) {
    return this.channels.create(userIdOf(req), body);
  }

  @Patch("channels/:id")
  update(
    @Req() req: Request,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateChannelSchema)) body: UpdateChannelDto,
  ) {
    return this.channels.update(userIdOf(req), id, body);
  }

  @Delete("channels/:id")
  @HttpCode(204)
  async remove(@Req() req: Request, @Param("id") id: string): Promise<void> {
    await this.channels.delete(userIdOf(req), id);
  }

  @Post("channels/:id/test")
  async test(@Req() req: Request, @Param("id") id: string) {
    const userId = userIdOf(req);
    // Confirm ownership
    const row = await this.channels.list(userId);
    if (!row.find((c) => c.id === id)) throw new BadRequestException("Channel not found");
    const delivery = await this.prisma.notificationDelivery.create({
      data: {
        channelId: id,
        eventType: "test",
        payload: { message: "Test notification from ModelDoctor" },
      },
    });
    try {
      await this.dispatcher.dispatchById(delivery.id);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  @Get("subscriptions")
  listSubs(@Req() req: Request) {
    return this.subscriptions.list(userIdOf(req));
  }

  @Post("subscriptions")
  createSub(
    @Req() req: Request,
    @Body(new ZodValidationPipe(createSubscriptionSchema)) body: CreateSubscriptionDto,
  ) {
    return this.subscriptions.create(userIdOf(req), body);
  }

  @Delete("subscriptions/:id")
  @HttpCode(204)
  async removeSub(@Req() req: Request, @Param("id") id: string): Promise<void> {
    await this.subscriptions.delete(userIdOf(req), id);
  }
}
```

If `ZodValidationPipe` does not exist at that path, locate the project's existing zod pipe (search `grep -rn "ZodValidationPipe\|implements PipeTransform" apps/api/src --include="*.ts"`) and adjust the import path. Otherwise add it to this same task as `apps/api/src/common/pipes/zod-validation.pipe.ts` (mirror an existing schema-pipe pattern in the codebase).

- [ ] **Step 6: Module wiring**

`apps/api/src/modules/notifications/notifications.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "../../prisma/prisma.module.js";
import { ChannelsService } from "./channels.service.js";
import { DispatcherService } from "./dispatcher.service.js";
import { NotifyService } from "./notify.service.js";
import { NotificationsController } from "./notifications.controller.js";
import { SubscriptionsService } from "./subscriptions.service.js";

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [NotificationsController],
  providers: [ChannelsService, SubscriptionsService, NotifyService, DispatcherService],
  exports: [ChannelsService, SubscriptionsService, NotifyService],
})
export class NotificationsModule {}
```

Add the module to `apps/api/src/app.module.ts` `imports` array.

- [ ] **Step 7: Type-check + lint**

```bash
pnpm -F @modeldoctor/api type-check && pnpm lint
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts apps/api/src/modules/notifications/notifications.dto.ts apps/api/src/modules/notifications/notifications.controller.ts apps/api/src/modules/notifications/notifications.module.ts apps/api/src/app.module.ts
git commit -m "feat(api): notifications REST controller + module wiring (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Wire event producers (benchmark + diagnostics)

**Files:**
- Modify: `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts`
- Modify: `apps/api/src/modules/benchmark/benchmark.service.ts`
- Modify: `apps/api/src/modules/benchmark/benchmark.module.ts`
- Modify: `apps/api/src/modules/diagnostics/diagnostics.service.ts`
- Modify: `apps/api/src/modules/diagnostics/diagnostics.module.ts`

- [ ] **Step 1: Import `NotificationsModule` into both modules**

`apps/api/src/modules/benchmark/benchmark.module.ts`: add `NotificationsModule` to `imports`.
`apps/api/src/modules/diagnostics/diagnostics.module.ts`: same.

- [ ] **Step 2: Inject `NotifyService` into `BenchmarkCallbackController`**

In `apps/api/src/modules/benchmark/callbacks/benchmark-callback.controller.ts`:

```ts
// constructor: add `private readonly notify: NotifyService`
import { NotifyService } from "../../notifications/notify.service.js";
```

After the `await this.benchmarks.update(id, { status: finalState, ... })` call (around line 132-138), append (inside the same function, after the SSE close):

```ts
// Resolve userId + connectionId from the row for fan-out
const row = await this.benchmarks.findById(id);
if (row?.userId) {
  await this.notify.emit({
    eventType: finalState === "completed" ? "benchmark.completed" : "benchmark.failed",
    userId: row.userId,
    connectionId: row.connectionId ?? undefined,
    payload: {
      benchmarkId: row.id,
      name: row.name,
      status: finalState,
      scenario: row.scenario ?? undefined,
      tool: row.tool ?? undefined,
      connectionId: row.connectionId,
      summaryMetrics: summary,
    },
  });
}
```

(Verify `this.benchmarks.findById(id)` exists in `BenchmarkService` — if it does not, add a public wrapper around `repo.findById`. Search: `grep -n "findById" apps/api/src/modules/benchmark/benchmark.service.ts`.)

- [ ] **Step 3: Emit on submit-fail path in `benchmark.service.ts`**

In `apps/api/src/modules/benchmark/benchmark.service.ts` around line 244 (after `this.repo.update(row.id, { status: "failed", ... })` inside the catch block), append:

```ts
await this.notify.emit({
  eventType: "benchmark.failed",
  userId: row.userId,
  connectionId: row.connectionId ?? undefined,
  payload: { benchmarkId: row.id, name: row.name, status: "failed", reason: msg.slice(0, 2048) },
});
```

Inject `NotifyService` in the constructor.

- [ ] **Step 4: Emit on diagnostics failure**

In `apps/api/src/modules/diagnostics/diagnostics.service.ts`:
- Inject `NotifyService`.
- After the line `if (!allPassed)` branch / inside the existing failed-path update (around line 75-82), append:

```ts
if (!allPassed && userId) {
  await this.notify.emit({
    eventType: "diagnostics.failed",
    userId,
    connectionId: conn.id,
    payload: {
      runId: created.id,
      connectionId: conn.id,
      failingProbes: results.filter((r) => !r.pass).map((r) => r.probe),
    },
  });
}
```

After the `catch` block's `this.repo.update(...)` call (around line 87-92), append:

```ts
if (userId) {
  await this.notify.emit({
    eventType: "diagnostics.failed",
    userId,
    connectionId: conn.id,
    payload: { runId: created.id, connectionId: conn.id, error: (err as Error).message?.slice(0, 2048) },
  });
}
```

(If `r.probe` is not the actual field name on a probe result, check the type and use the matching field, e.g. `r.kind` or `r.name`.)

- [ ] **Step 5: Type-check**

```bash
pnpm -F @modeldoctor/api type-check
```

Expected: clean.

- [ ] **Step 6: Run existing tests to make sure nothing regressed**

```bash
pnpm -F @modeldoctor/api test
```

Expected: existing benchmark + diagnostics + new notification tests all green. If existing service specs need a `NotifyService` mock (because the service constructor signature changed), add `notify: { emit: vi.fn() }` to the manual injection in those specs.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/benchmark apps/api/src/modules/diagnostics
git commit -m "feat(api): emit notifications on benchmark/diagnostics terminal states (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: MCP tools (5 new)

**Files:**
- Create: `apps/api/src/modules/mcp/tools/list-channels.tool.ts`
- Create: `apps/api/src/modules/mcp/tools/create-channel.tool.ts`
- Create: `apps/api/src/modules/mcp/tools/subscribe.tool.ts`
- Create: `apps/api/src/modules/mcp/tools/unsubscribe.tool.ts`
- Create: `apps/api/src/modules/mcp/tools/test-channel.tool.ts`
- Modify: `apps/api/src/modules/mcp/mcp.service.ts`
- Modify: `apps/api/src/modules/mcp/mcp.module.ts`

- [ ] **Step 1: Implement `list_channels`**

`apps/api/src/modules/mcp/tools/list-channels.tool.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

export function registerListChannels(server: McpServer, deps: McpToolDeps): void {
  registerTool<Record<string, never>>(
    server,
    {
      name: "list_channels",
      title: "List notification channels",
      description:
        "List the user's notification channels (Slack/webhook). Returns id, type, name, urlMasked, createdAt.",
    },
    async () => {
      const list = await deps.channels.list(deps.userId);
      return {
        content: [{ type: "text", text: JSON.stringify(list, null, 2) }],
        structuredContent: { channels: list } as unknown as Record<string, unknown>,
      };
    },
  );
}
```

- [ ] **Step 2: Implement `create_channel`**

`apps/api/src/modules/mcp/tools/create-channel.tool.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type CreateChannelInput = {
  type: "slack" | "webhook";
  name: string;
  url: string;
};

export function registerCreateChannel(server: McpServer, deps: McpToolDeps): void {
  registerTool<CreateChannelInput>(
    server,
    {
      name: "create_channel",
      title: "Create notification channel",
      description:
        "Create a Slack or generic webhook notification channel. URL is stored encrypted; subsequent reads return a masked form.",
      inputShape: {
        type: z.enum(["slack", "webhook"]).describe("Channel kind."),
        name: z.string().min(1).max(100).describe("Display name."),
        url: z.string().url().describe("Webhook URL (treated as secret)."),
      },
    },
    async (input) => {
      const row = await deps.channels.create(deps.userId, input);
      return {
        content: [{ type: "text", text: JSON.stringify(row, null, 2) }],
        structuredContent: row as unknown as Record<string, unknown>,
      };
    },
  );
}
```

- [ ] **Step 3: Implement `subscribe`**

`apps/api/src/modules/mcp/tools/subscribe.tool.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type SubscribeInput = {
  channelId: string;
  eventType: "benchmark.completed" | "benchmark.failed" | "diagnostics.failed";
  connectionId?: string;
};

export function registerSubscribe(server: McpServer, deps: McpToolDeps): void {
  registerTool<SubscribeInput>(
    server,
    {
      name: "subscribe",
      title: "Subscribe a channel to an event",
      description:
        "Subscribe an existing notification channel to an event type. Optionally filter by connectionId.",
      inputShape: {
        channelId: z.string().describe("Channel id from list_channels."),
        eventType: z
          .enum(["benchmark.completed", "benchmark.failed", "diagnostics.failed"])
          .describe("Event type to subscribe to."),
        connectionId: z
          .string()
          .optional()
          .describe("If set, only fire when the event's connectionId matches."),
      },
    },
    async (input) => {
      const row = await deps.subscriptions.create(deps.userId, input);
      return {
        content: [{ type: "text", text: JSON.stringify(row, null, 2) }],
        structuredContent: row as unknown as Record<string, unknown>,
      };
    },
  );
}
```

- [ ] **Step 4: Implement `unsubscribe`**

`apps/api/src/modules/mcp/tools/unsubscribe.tool.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type UnsubscribeInput = { subscriptionId: string };

export function registerUnsubscribe(server: McpServer, deps: McpToolDeps): void {
  registerTool<UnsubscribeInput>(
    server,
    {
      name: "unsubscribe",
      title: "Remove a subscription",
      description: "Delete a notification subscription by its id.",
      inputShape: {
        subscriptionId: z.string().describe("Subscription id from list_subscriptions."),
      },
    },
    async (input) => {
      await deps.subscriptions.delete(deps.userId, input.subscriptionId);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
        structuredContent: { ok: true } as unknown as Record<string, unknown>,
      };
    },
  );
}
```

- [ ] **Step 5: Implement `test_channel`**

`apps/api/src/modules/mcp/tools/test-channel.tool.ts`:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpToolDeps } from "../mcp.service.js";
import { registerTool } from "./_register.js";

type TestChannelInput = { channelId: string };

export function registerTestChannel(server: McpServer, deps: McpToolDeps): void {
  registerTool<TestChannelInput>(
    server,
    {
      name: "test_channel",
      title: "Send a test notification",
      description:
        "Send a one-shot test payload through the given channel. Returns { ok, error? }.",
      inputShape: {
        channelId: z.string().describe("Channel id from list_channels."),
      },
    },
    async (input) => {
      const result = await deps.notificationsTest(input.channelId);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );
}
```

- [ ] **Step 6: Extend `McpToolDeps` and register the 5 tools**

In `apps/api/src/modules/mcp/mcp.service.ts`:

1. Add imports:

```ts
import { ChannelsService } from "../notifications/channels.service.js";
import { SubscriptionsService } from "../notifications/subscriptions.service.js";
import { DispatcherService } from "../notifications/dispatcher.service.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { registerListChannels } from "./tools/list-channels.tool.js";
import { registerCreateChannel } from "./tools/create-channel.tool.js";
import { registerSubscribe } from "./tools/subscribe.tool.js";
import { registerUnsubscribe } from "./tools/unsubscribe.tool.js";
import { registerTestChannel } from "./tools/test-channel.tool.js";
```

2. Inject in constructor:

```ts
constructor(
  private readonly discovery: DiscoveryService,
  private readonly connections: ConnectionService,
  private readonly benchmarks: BenchmarkService,
  private readonly diagnostics: DiagnosticsService,
  private readonly channels: ChannelsService,
  private readonly subscriptions: SubscriptionsService,
  private readonly dispatcher: DispatcherService,
  private readonly prisma: PrismaService,
) {}
```

3. Update the `deps` object inside `handleRequest`:

```ts
const deps = {
  userId,
  discovery: this.discovery,
  connections: this.connections,
  benchmarks: this.benchmarks,
  diagnostics: this.diagnostics,
  channels: this.channels,
  subscriptions: this.subscriptions,
  notificationsTest: async (channelId: string) => {
    const channelRows = await this.channels.list(userId);
    if (!channelRows.find((c) => c.id === channelId)) {
      return { ok: false, error: "channel not found" };
    }
    const delivery = await this.prisma.notificationDelivery.create({
      data: {
        channelId,
        eventType: "test",
        payload: { message: "Test notification from ModelDoctor (MCP)" },
      },
    });
    try {
      await this.dispatcher.dispatchById(delivery.id);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
};
```

4. Register the new tools after the existing four:

```ts
registerListChannels(server, deps);
registerCreateChannel(server, deps);
registerSubscribe(server, deps);
registerUnsubscribe(server, deps);
registerTestChannel(server, deps);
```

5. Update the exported `McpToolDeps` interface at the bottom of the file:

```ts
export interface McpToolDeps {
  userId: string;
  discovery: DiscoveryService;
  connections: ConnectionService;
  benchmarks: BenchmarkService;
  diagnostics: DiagnosticsService;
  channels: ChannelsService;
  subscriptions: SubscriptionsService;
  notificationsTest: (channelId: string) => Promise<{ ok: boolean; error?: string }>;
}
```

- [ ] **Step 7: Import `NotificationsModule` into `MCP` module**

`apps/api/src/modules/mcp/mcp.module.ts`: add `NotificationsModule` to `imports`.

- [ ] **Step 8: Type-check + lint**

```bash
pnpm -F @modeldoctor/api type-check && pnpm lint
```

Expected: clean. If TS2589 surfaces, the existing `_register.ts` wrapper already handles it; verify each new tool uses `registerTool<TInput>(...)` form.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/mcp
git commit -m "feat(api): MCP tools for notifications (list/create/subscribe/unsubscribe/test) (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: API e2e — notifications happy path

**Files:**
- Create: `apps/api/test/e2e/notifications.e2e-spec.ts`

- [ ] **Step 1: Write the e2e spec**

`apps/api/test/e2e/notifications.e2e-spec.ts`:

```ts
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { DispatcherService } from "../../src/modules/notifications/dispatcher.service.js";
import { issueTestJwt } from "./helpers/auth.js"; // assumed; if not present, mirror pattern from other e2e

describe("Notifications e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dispatcher: DispatcherService;
  let userId: string;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    dispatcher = app.get(DispatcherService);

    // Create test user
    const user = await prisma.user.create({
      data: {
        email: `notify-${Date.now()}@test.local`,
        passwordHash: "x",
      },
    });
    userId = user.id;
    token = issueTestJwt(userId);
  });

  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await prisma.notificationDelivery.deleteMany({});
    await prisma.notificationSubscription.deleteMany({});
    await prisma.notificationChannel.deleteMany({});
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await app.close();
  });

  it("create channel + subscription + outbound fetch on dispatched delivery", async () => {
    // 1. Create channel
    const channelRes = await request(app.getHttpServer())
      .post("/notifications/channels")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "webhook", name: "test-hook", url: "https://example.test/hook" })
      .expect(201);
    const channelId: string = channelRes.body.id;
    expect(channelRes.body.urlMasked).toBe("https://example.test/***");

    // 2. Create subscription
    await request(app.getHttpServer())
      .post("/notifications/subscriptions")
      .set("Authorization", `Bearer ${token}`)
      .send({ channelId, eventType: "benchmark.completed" })
      .expect(201);

    // 3. Insert a delivery row directly (skip emitting from a benchmark to keep test deterministic)
    const delivery = await prisma.notificationDelivery.create({
      data: {
        channelId,
        eventType: "benchmark.completed",
        payload: { benchmarkId: "b1", name: "test-run", status: "completed" },
      },
    });

    // 4. Stub fetch
    const fetchSpy = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    // 5. Trigger dispatcher
    await dispatcher.tick();

    // 6. Verify outbound POST
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/hook");
    expect(init.method).toBe("POST");

    // 7. Verify delivery row marked sent
    const reloaded = await prisma.notificationDelivery.findUnique({ where: { id: delivery.id } });
    expect(reloaded?.status).toBe("sent");
  });
});
```

If `helpers/auth.ts` does not exist, find an existing e2e spec under `apps/api/test/e2e/` and reuse its auth scheme verbatim. The exact env that `pickTestDatabaseUrl` resolves to is documented in `apps/api/CLAUDE.md` / repo root `CLAUDE.md`.

- [ ] **Step 2: Run e2e**

```bash
pnpm -F @modeldoctor/api test:e2e -- notifications.e2e
```

Expected: PASS (1/1). If the schedule decorator runs in test mode and interferes with deterministic timing, set `NODE_ENV=test` and verify that `@Cron` is only registered when needed.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/e2e/notifications.e2e-spec.ts
git commit -m "test(api): notifications happy-path e2e (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Web — i18n + sidebar + route + page skeleton

**Files:**
- Create: `apps/web/src/locales/zh-CN/notifications.json`
- Create: `apps/web/src/locales/en-US/notifications.json`
- Modify: `apps/web/src/locales/zh-CN/sidebar.json` (+items.notifications)
- Modify: `apps/web/src/locales/en-US/sidebar.json`
- Modify: `apps/web/src/components/sidebar/sidebar-config.tsx`
- Modify: `apps/web/src/router/index.tsx`
- Create: `apps/web/src/features/notifications/NotificationsPage.tsx`

- [ ] **Step 1: Write i18n strings**

`apps/web/src/locales/zh-CN/notifications.json`:

```json
{
  "page": {
    "title": "通知",
    "subtitle": "配置 Slack / Webhook 通道与订阅"
  },
  "channel": {
    "sectionTitle": "通道",
    "columns": { "name": "名称", "type": "类型", "createdAt": "创建时间", "actions": "操作" },
    "newButton": "+ 新建通道",
    "editButton": "编辑",
    "testButton": "测试",
    "deleteButton": "删除",
    "form": {
      "type": "类型",
      "typeSlack": "Slack",
      "typeWebhook": "通用 Webhook",
      "name": "名称",
      "url": "Webhook URL",
      "urlPlaceholder": "https://hooks.slack.com/services/..."
    },
    "testSuccess": "测试发送成功",
    "testFailure": "测试发送失败：{{error}}"
  },
  "subscription": {
    "sectionTitle": "订阅",
    "columns": { "channel": "通道", "eventType": "事件", "filter": "过滤", "actions": "操作" },
    "newButton": "+ 新建订阅",
    "deleteButton": "删除",
    "form": {
      "channel": "通道",
      "eventType": "事件类型",
      "connection": "连接 (可选)",
      "events": {
        "benchmark.completed": "Benchmark 完成",
        "benchmark.failed": "Benchmark 失败",
        "diagnostics.failed": "诊断失败"
      }
    },
    "filter": { "anyConnection": "全部连接", "specific": "连接：{{name}}" }
  },
  "delete": {
    "channelTitle": "删除通道？",
    "channelDescription": "将级联删除该通道下的所有订阅和投递记录。此操作不可恢复。",
    "subscriptionTitle": "删除订阅？",
    "subscriptionDescription": "该订阅将立刻失效。"
  }
}
```

`apps/web/src/locales/en-US/notifications.json` mirrors with English strings (translate inline; preserve `{{error}}` / `{{name}}` placeholders).

In `sidebar.json` (both locales), add under `items`:

```
"notifications": "通知"  / "Notifications"
```

- [ ] **Step 2: Add route**

In `apps/web/src/router/index.tsx`, after `{ path: "connections", element: <ConnectionsPage /> }`:

```tsx
import { NotificationsPage } from "@/features/notifications/NotificationsPage";
// ...
{ path: "notifications", element: <NotificationsPage /> },
```

- [ ] **Step 3: Add sidebar entry**

In `apps/web/src/components/sidebar/sidebar-config.tsx`, in the top-of-rail array (where `Connections` and `Settings` live):

```tsx
import { Bell } from "lucide-react";
// ...
{ to: "/notifications", icon: Bell, labelKey: "items.notifications" },
```

Place it between Connections and Settings.

- [ ] **Step 4: Create page skeleton**

`apps/web/src/features/notifications/NotificationsPage.tsx`:

```tsx
import { PageHeader } from "@/components/common/page-header";
import { useTranslation } from "react-i18next";
import { ChannelsSection } from "./ChannelsSection";
import { SubscriptionsSection } from "./SubscriptionsSection";

export function NotificationsPage(): JSX.Element {
  const { t } = useTranslation("notifications");
  return (
    <>
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")} />
      <div className="px-8 py-6 space-y-6">
        <ChannelsSection />
        <SubscriptionsSection />
      </div>
    </>
  );
}
```

- [ ] **Step 5: Stub sections so the route compiles**

`apps/web/src/features/notifications/ChannelsSection.tsx`:

```tsx
export function ChannelsSection(): JSX.Element {
  return <div>channels (todo)</div>;
}
```

`apps/web/src/features/notifications/SubscriptionsSection.tsx`:

```tsx
export function SubscriptionsSection(): JSX.Element {
  return <div>subscriptions (todo)</div>;
}
```

- [ ] **Step 6: Build web to confirm it compiles**

```bash
pnpm -F @modeldoctor/web build
```

Expected: build succeeds; `/notifications` is reachable.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/locales apps/web/src/components/sidebar/sidebar-config.tsx apps/web/src/router/index.tsx apps/web/src/features/notifications
git commit -m "feat(web): notifications page route + i18n + sidebar item (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Web — queries + ChannelsSection + ChannelDialog

**Files:**
- Create: `apps/web/src/features/notifications/queries.ts`
- Create: `apps/web/src/features/notifications/schemas.ts`
- Modify: `apps/web/src/features/notifications/ChannelsSection.tsx`
- Create: `apps/web/src/features/notifications/ChannelDialog.tsx`

- [ ] **Step 1: Create query hooks**

`apps/web/src/features/notifications/queries.ts`:

```ts
import { apiClient } from "@/lib/api-client";
import type {
  Channel,
  CreateChannelRequest,
  CreateSubscriptionRequest,
  Subscription,
  TestChannelResponse,
  UpdateChannelRequest,
} from "@modeldoctor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const channelsKey = ["notifications", "channels"] as const;
const subscriptionsKey = ["notifications", "subscriptions"] as const;

export function useChannels() {
  return useQuery({
    queryKey: channelsKey,
    queryFn: () => apiClient.get<Channel[]>("/notifications/channels"),
  });
}

export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateChannelRequest) =>
      apiClient.post<Channel>("/notifications/channels", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelsKey }),
  });
}

export function useUpdateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateChannelRequest }) =>
      apiClient.patch<Channel>(`/notifications/channels/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelsKey }),
  });
}

export function useDeleteChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/notifications/channels/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: channelsKey });
      qc.invalidateQueries({ queryKey: subscriptionsKey });
    },
  });
}

export function useTestChannel() {
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<TestChannelResponse>(`/notifications/channels/${id}/test`, {}),
  });
}

export function useSubscriptions() {
  return useQuery({
    queryKey: subscriptionsKey,
    queryFn: () => apiClient.get<Subscription[]>("/notifications/subscriptions"),
  });
}

export function useCreateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSubscriptionRequest) =>
      apiClient.post<Subscription>("/notifications/subscriptions", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: subscriptionsKey }),
  });
}

export function useDeleteSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/notifications/subscriptions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: subscriptionsKey }),
  });
}
```

(Adjust `apiClient` method names / shapes to match the project's actual client. Verify: `grep -n "apiClient\." apps/web/src/features/connections/queries.ts` or similar.)

- [ ] **Step 2: Form schemas**

`apps/web/src/features/notifications/schemas.ts`:

```ts
import { z } from "zod";

export const channelFormSchema = z.object({
  type: z.enum(["slack", "webhook"]),
  name: z.string().min(1).max(100),
  url: z.string().url(),
});
export type ChannelForm = z.infer<typeof channelFormSchema>;

export const subscriptionFormSchema = z.object({
  channelId: z.string().min(1),
  eventType: z.enum(["benchmark.completed", "benchmark.failed", "diagnostics.failed"]),
  connectionId: z.string().optional(),
});
export type SubscriptionForm = z.infer<typeof subscriptionFormSchema>;
```

- [ ] **Step 3: ChannelDialog (create / edit / test inline)**

`apps/web/src/features/notifications/ChannelDialog.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormActions } from "@/components/common/form-actions";
import { useCreateChannel, useTestChannel, useUpdateChannel } from "./queries";
import { type ChannelForm, channelFormSchema } from "./schemas";
import type { Channel } from "@modeldoctor/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channel?: Channel | null; // edit if set
}

export function ChannelDialog({ open, onOpenChange, channel }: Props): JSX.Element {
  const { t } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const create = useCreateChannel();
  const update = useUpdateChannel();
  const testCh = useTestChannel();

  const form = useForm<ChannelForm>({
    mode: "onTouched",
    resolver: zodResolver(channelFormSchema),
    defaultValues: { type: channel?.type ?? "slack", name: channel?.name ?? "", url: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    if (channel) {
      await update.mutateAsync({ id: channel.id, body: { name: values.name, url: values.url || undefined } });
    } else {
      await create.mutateAsync(values);
    }
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{channel ? t("channel.editButton") : t("channel.newButton")}</DialogTitle>
          <DialogDescription>{t("channel.form.url")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("channel.form.type")}</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange} disabled={!!channel}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="slack">{t("channel.form.typeSlack")}</SelectItem>
                        <SelectItem value="webhook">{t("channel.form.typeWebhook")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("channel.form.name")}</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required={!channel}>{t("channel.form.url")}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t("channel.form.urlPlaceholder")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormActions
              onCancel={() => onOpenChange(false)}
              cancelLabel={tc("actions.cancel")}
              submitLabel={tc(channel ? "actions.save" : "actions.create")}
              pending={create.isPending || update.isPending}
              leading={
                channel ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      const res = await testCh.mutateAsync(channel.id);
                      if (res.ok) toast.success(t("channel.testSuccess"));
                      else toast.error(t("channel.testFailure", { error: res.error ?? "" }));
                    }}
                    disabled={testCh.isPending}
                  >
                    {t("channel.testButton")}
                  </Button>
                ) : null
              }
            />
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

(If `FormActions` does not accept a `leading` prop, check its current API — adjust to use whichever slot it provides for left-aligned content. Reference: `apps/web/src/components/common/form-actions.tsx`.)

- [ ] **Step 4: ChannelsSection (table + Add + Delete)**

`apps/web/src/features/notifications/ChannelsSection.tsx`:

```tsx
import { FormSection } from "@/components/common/form-section";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDeleteChannel, useChannels, useTestChannel } from "./queries";
import type { Channel } from "@modeldoctor/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChannelDialog } from "./ChannelDialog";
import { toast } from "sonner";

export function ChannelsSection(): JSX.Element {
  const { t } = useTranslation("notifications");
  const { data = [] } = useChannels();
  const del = useDeleteChannel();
  const testCh = useTestChannel();
  const [editing, setEditing] = useState<Channel | null | undefined>(undefined);
  const [toDelete, setToDelete] = useState<Channel | null>(null);

  return (
    <FormSection title={t("channel.sectionTitle")}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("channel.columns.name")}</TableHead>
            <TableHead>{t("channel.columns.type")}</TableHead>
            <TableHead>{t("channel.columns.createdAt")}</TableHead>
            <TableHead className="text-right">{t("channel.columns.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((c) => (
            <TableRow key={c.id}>
              <TableCell>{c.name}</TableCell>
              <TableCell>{c.type}</TableCell>
              <TableCell>{new Date(c.createdAt).toLocaleString()}</TableCell>
              <TableCell className="text-right space-x-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                  {t("channel.editButton")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const res = await testCh.mutateAsync(c.id);
                    if (res.ok) toast.success(t("channel.testSuccess"));
                    else toast.error(t("channel.testFailure", { error: res.error ?? "" }));
                  }}
                  disabled={testCh.isPending}
                >
                  {t("channel.testButton")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setToDelete(c)}>
                  {t("channel.deleteButton")}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Button onClick={() => setEditing(null)}>{t("channel.newButton")}</Button>

      <ChannelDialog
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        channel={editing}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete.channelTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("delete.channelDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (toDelete) await del.mutateAsync(toDelete.id);
                setToDelete(null);
              }}
            >
              {t("channel.deleteButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FormSection>
  );
}
```

- [ ] **Step 5: Type-check + build**

```bash
pnpm -F @modeldoctor/web build
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/notifications/queries.ts apps/web/src/features/notifications/schemas.ts apps/web/src/features/notifications/ChannelDialog.tsx apps/web/src/features/notifications/ChannelsSection.tsx
git commit -m "feat(web): notifications channels CRUD UI (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Web — SubscriptionsSection + SubscriptionDialog

**Files:**
- Modify: `apps/web/src/features/notifications/SubscriptionsSection.tsx`
- Create: `apps/web/src/features/notifications/SubscriptionDialog.tsx`

- [ ] **Step 1: Create SubscriptionDialog**

`apps/web/src/features/notifications/SubscriptionDialog.tsx`:

```tsx
import { ConnectionPicker } from "@/components/connection/ConnectionPicker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormActions } from "@/components/common/form-actions";
import { useChannels, useCreateSubscription } from "./queries";
import { type SubscriptionForm, subscriptionFormSchema } from "./schemas";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function SubscriptionDialog({ open, onOpenChange }: Props): JSX.Element {
  const { t } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const { data: channels = [] } = useChannels();
  const create = useCreateSubscription();

  const form = useForm<SubscriptionForm>({
    mode: "onTouched",
    resolver: zodResolver(subscriptionFormSchema),
    defaultValues: { channelId: "", eventType: "benchmark.completed", connectionId: undefined },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    await create.mutateAsync({
      channelId: values.channelId,
      eventType: values.eventType,
      connectionId: values.connectionId || undefined,
    });
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("subscription.newButton")}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="channelId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("subscription.form.channel")}</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {channels.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="eventType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("subscription.form.eventType")}</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="benchmark.completed">{t("subscription.form.events.benchmark.completed")}</SelectItem>
                        <SelectItem value="benchmark.failed">{t("subscription.form.events.benchmark.failed")}</SelectItem>
                        <SelectItem value="diagnostics.failed">{t("subscription.form.events.diagnostics.failed")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="connectionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("subscription.form.connection")}</FormLabel>
                  <FormControl>
                    <ConnectionPicker
                      value={field.value ?? ""}
                      onChange={(v) => field.onChange(v || undefined)}
                      allowManual={false}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormActions
              onCancel={() => onOpenChange(false)}
              cancelLabel={tc("actions.cancel")}
              submitLabel={tc("actions.create")}
              pending={create.isPending}
            />
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

(Adjust `ConnectionPicker` props to match its actual API — see `apps/web/src/components/connection/ConnectionPicker.tsx`.)

- [ ] **Step 2: Replace `SubscriptionsSection` stub**

`apps/web/src/features/notifications/SubscriptionsSection.tsx`:

```tsx
import { FormSection } from "@/components/common/form-section";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDeleteSubscription, useSubscriptions } from "./queries";
import type { Subscription } from "@modeldoctor/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SubscriptionDialog } from "./SubscriptionDialog";

export function SubscriptionsSection(): JSX.Element {
  const { t } = useTranslation("notifications");
  const { data = [] } = useSubscriptions();
  const del = useDeleteSubscription();
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<Subscription | null>(null);

  return (
    <FormSection title={t("subscription.sectionTitle")}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("subscription.columns.channel")}</TableHead>
            <TableHead>{t("subscription.columns.eventType")}</TableHead>
            <TableHead>{t("subscription.columns.filter")}</TableHead>
            <TableHead className="text-right">{t("subscription.columns.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((s) => (
            <TableRow key={s.id}>
              <TableCell>{s.channelName}</TableCell>
              <TableCell>{t(`subscription.form.events.${s.eventType}`)}</TableCell>
              <TableCell>
                {s.connectionId
                  ? t("subscription.filter.specific", { name: s.connectionId })
                  : t("subscription.filter.anyConnection")}
              </TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="ghost" onClick={() => setToDelete(s)}>
                  {t("subscription.deleteButton")}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Button onClick={() => setCreating(true)}>{t("subscription.newButton")}</Button>

      <SubscriptionDialog open={creating} onOpenChange={setCreating} />

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete.subscriptionTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("delete.subscriptionDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (toDelete) await del.mutateAsync(toDelete.id);
                setToDelete(null);
              }}
            >
              {t("subscription.deleteButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FormSection>
  );
}
```

- [ ] **Step 3: Build + manual smoke test**

```bash
pnpm -F @modeldoctor/web build
```

Then start the dev stack (`pnpm dev` or per project convention) and visit `/notifications` in a browser. Verify: page renders, sidebar entry visible, create-channel dialog opens, can create a Slack channel (use a known-bad URL like `https://example.test/hook` to test failure path), can test it (expect error toast because of network), can delete it, can subscribe and unsubscribe.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/notifications/SubscriptionDialog.tsx apps/web/src/features/notifications/SubscriptionsSection.tsx
git commit -m "feat(web): notifications subscriptions CRUD UI (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Final integration — green sweep, push, PR

- [ ] **Step 1: Workspace-wide green check**

```bash
pnpm -r build && pnpm -r type-check && pnpm lint && pnpm -r test
```

Expected: all green. Fix any failures inline.

- [ ] **Step 2: API e2e**

```bash
pnpm -F @modeldoctor/api test:e2e
```

Expected: green (existing + the new notifications spec).

- [ ] **Step 3: Push branch**

```bash
git push -u origin feat/notifications-v1
```

- [ ] **Step 4: Open PR**

```bash
gh pr create --title "feat: notifications v1 — Slack/Webhook outbox + MCP (#152)" --body "$(cat <<'EOF'
## Summary
- Adds `NotificationChannel`, `NotificationSubscription`, `NotificationDelivery` (outbox) Prisma models.
- Backend module `notifications/` with channels/subscriptions services, fan-out `NotifyService`, `DispatcherService` (`@Cron("*/10 * * * * *")`, 30s/5min/terminal backoff), Slack + generic-webhook adapters reusing `safeFetch`.
- Event producers wired in `BenchmarkCallbackController`, `benchmark.service` (submit-fail), `diagnostics.service` (probe-failed + execution-failed).
- 5 MCP tools (`list_channels`, `create_channel`, `subscribe`, `unsubscribe`, `test_channel`) registered alongside existing 4 read-only tools.
- Web: new `/notifications` route + sidebar item, channels + subscriptions CRUD UI with Test inline.
- AES-GCM encryption of webhook URLs reuses `CONNECTION_API_KEY_ENCRYPTION_KEY`.
- e2e happy-path test.

Addresses #152 (Roadmap B). Umbrella #155.

## Test plan
- [ ] Open `/notifications`, create Slack channel (paste a real Slack webhook URL), Test → message arrives.
- [ ] Create webhook channel with `https://webhook.site/<your-id>`, Test → request visible.
- [ ] Subscribe channel to `benchmark.completed`, run a quick benchmark → notification fires after completion.
- [ ] Subscribe with connectionId filter; verify it only fires for matching connection.
- [ ] Delete channel → linked subscriptions cascade.
- [ ] `gh api repos/weetime/modeldoctor/actions/runs` shows green CI.
- [ ] MCP via Claude Code: `list_channels`, `subscribe`, `test_channel` round-trips OK.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Verify PR + CI**

```bash
gh pr view --json mergeStateStatus,statusCheckRollup -q '{mergeState: .mergeStateStatus, checks: [.statusCheckRollup[] | {name, status, conclusion}]}'
```

Watch CI: `gh pr checks <N>`. If pending, `gh run watch <run-id> --exit-status`.

- [ ] **Step 6: Post follow-up comment on #152**

Per `feedback_temp_followups`, add a V2 backlog comment summarizing deferred items so the next PR has inline context:

```bash
gh issue comment 152 --body "$(cat <<'EOF'
## V1 shipped (PR #<this-pr>)

Deferred to V2 follow-ups:
- Email channel (SMTP / templating / unsubscribe).
- Per-event custom templates (V1 ships fixed Slack/webhook formats).
- Subscription filters beyond `connectionId` (scenario, minStatusCode, tool).
- `slo.breached` event type — producer to be added when Roadmap C (#154) lands.
- Webhook receiver HMAC signing (V1 relies on URL-as-secret).
- Multi-replica dispatcher: switch to `SELECT … FOR UPDATE SKIP LOCKED` if/when api scales horizontally.
EOF
)"
```

- [ ] **Step 7: Hand off to user for review/merge**

Report PR URL + green CI status. Do **not** `gh pr merge` — that requires explicit user authorization per repo CLAUDE.md.

---

## Self-Review (post-write)

Re-read against the spec:

1. **Spec coverage:** Each section of `2026-05-11-notifications-v1-design.md` is implemented by at least one task above — schema (T1), encryption (T4), backend services (T4-T7), REST (T8), event wiring (T9), MCP tools (T10), e2e (T11), web (T12-T14), final + #152 followups (T15).
2. **Placeholders:** No "TBD" / "implement later". Every step has actual code.
3. **Type consistency:** `EventType` enum members are consistent across services, contracts, MCP tools, and i18n keys. `ChannelType` matches Prisma's generated type. `DispatcherService.tick()` and `.dispatchById()` are referenced consistently from controller + MCP.
4. **Risks called out in spec:** dispatcher concurrency, Slack rate limit, webhook signing — surfaced in PR comment / #152 follow-up rather than implemented.
