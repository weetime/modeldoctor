# Notifications IA Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Per user preference (`feedback_plan_execution_no_pause`), run tasks straight through without pausing between them.

**Goal:** Move notifications UI from `/notifications` to two new homes — channels (+ global subs) into `/settings/notifications`, per-connection subscriptions into `ConnectionSheet` as a new "通知" Tab. Backend untouched.

**Architecture:** Pure frontend refactor. All hooks in `apps/web/src/features/notifications/queries.ts` get reused from new locations. Add a settings sub-route + a tab inside ConnectionSheet.

**Tech Stack:** react-router-dom, shadcn `Tabs`, existing `Sheet` / `Dialog` / `Form` primitives.

**Reference spec:** `docs/superpowers/specs/2026-05-12-notifications-ia-refactor-design.md`

**Branch:** `feat/notifications-ia-refactor` (stacked on `feat/notifications-feishu-dingtalk`)

---

## File Structure

### Web

```
DELETE:
  apps/web/src/features/notifications/NotificationsPage.tsx        # moves to settings
  apps/web/src/features/notifications/ChannelsSection.tsx          # merged into new settings page
  apps/web/src/features/notifications/SubscriptionsSection.tsx     # split between settings (global) + ConnectionSheet (per-conn)

CREATE:
  apps/web/src/features/settings/NotificationsSettingsSection.tsx  # summary card on /settings
  apps/web/src/features/settings/NotificationsPage.tsx             # the /settings/notifications page
  apps/web/src/features/settings/GlobalSubscriptionsSection.tsx    # global subs table
  apps/web/src/features/settings/GlobalSubscriptionSheet.tsx       # add global sub (no connection picker)
  apps/web/src/features/connections/notifications/
    ConnectionNotificationsTab.tsx                                  # the tab content
    ConnectionSubscriptionSheet.tsx                                 # add/edit sub for this connection
    groupSubscriptions.ts                                           # pure helper to group rows by channel

MODIFY:
  apps/web/src/router/index.tsx                                    # remove /notifications; add /settings/notifications
  apps/web/src/components/sidebar/sidebar-config.tsx               # remove Bell entry
  apps/web/src/features/settings/SettingsPage.tsx                  # render NotificationsSettingsSection
  apps/web/src/features/connections/ConnectionSheet.tsx            # add Tabs + render new tab
  apps/web/src/features/connections/ConnectionsPage.tsx            # add 🔔 column
  apps/web/src/locales/zh-CN/{settings,connections,sidebar}.json   # new keys, drop notifications sidebar
  apps/web/src/locales/en-US/{settings,connections,sidebar}.json   # same
  apps/web/src/locales/zh-CN/notifications.json                    # no changes needed (sheet still uses its strings)
```

`ChannelSheet.tsx` itself moves location-wise but stays the same component;
re-export from the new settings page.

---

### Task 1: Sidebar + route surgery — remove `/notifications`

**Files:**
- Modify: `apps/web/src/components/sidebar/sidebar-config.tsx`
- Modify: `apps/web/src/router/index.tsx`
- Modify: `apps/web/src/locales/zh-CN/sidebar.json`
- Modify: `apps/web/src/locales/en-US/sidebar.json`

- [ ] **Step 1: Remove Bell entry from sidebar**

In `sidebar-config.tsx` remove the `{ to: "/notifications", icon: Bell, ...}` entry from `sidebarPrimaryItems`. Remove the `Bell` import.

- [ ] **Step 2: Remove route**

In `apps/web/src/router/index.tsx`:
- Remove the `import { NotificationsPage } from "@/features/notifications/NotificationsPage";` line
- Remove `{ path: "notifications", element: <NotificationsPage /> }` entry

- [ ] **Step 3: Drop sidebar i18n key**

Remove `"notifications": "通知"` line from both `zh-CN/sidebar.json` and `en-US/sidebar.json`.

- [ ] **Step 4: Verify web builds (route still compiles)**

```bash
pnpm -F @modeldoctor/web build
```

Expected: success. The components in `features/notifications/` still exist but are now unreachable from router; we'll delete or re-home them in later tasks.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/sidebar/sidebar-config.tsx apps/web/src/router/index.tsx apps/web/src/locales/zh-CN/sidebar.json apps/web/src/locales/en-US/sidebar.json
git commit -m "refactor(web): drop /notifications top-rail entry (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Settings summary card

**Files:**
- Create: `apps/web/src/features/settings/NotificationsSettingsSection.tsx`
- Modify: `apps/web/src/features/settings/SettingsPage.tsx`
- Modify: `apps/web/src/locales/zh-CN/settings.json`
- Modify: `apps/web/src/locales/en-US/settings.json`

- [ ] **Step 1: Add i18n strings**

In `zh-CN/settings.json` add under root:

```json
"notifications": {
  "section": {
    "title": "通知通道",
    "subtitle": "Slack / 飞书 / 钉钉 / 通用 Webhook",
    "manageButton": "管理 →",
    "loading": "加载中…",
    "summaryCounts": "{{slack}} Slack · {{feishu}} 飞书 · {{dingtalk}} 钉钉 · {{webhook}} 通用 Webhook",
    "subscriptionsCoverage": "{{withSubs}}/{{total}} 个连接配置了订阅"
  }
}
```

`en-US/settings.json` mirrors with English strings.

- [ ] **Step 2: Create the section component**

`apps/web/src/features/settings/NotificationsSettingsSection.tsx`:

```tsx
import { SettingSection } from "./settings-primitives";
import { Button } from "@/components/ui/button";
import { useChannels, useSubscriptions } from "@/features/notifications/queries";
import { useConnections } from "@/features/connections/queries";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function NotificationsSettingsSection(): JSX.Element {
  const { t } = useTranslation("settings");
  const navigate = useNavigate();
  const { data: channels = [] } = useChannels();
  const { data: subscriptions = [] } = useSubscriptions();
  const { data: connections = [] } = useConnections();

  const counts = {
    slack: channels.filter((c) => c.type === "slack").length,
    feishu: channels.filter((c) => c.type === "feishu").length,
    dingtalk: channels.filter((c) => c.type === "dingtalk").length,
    webhook: channels.filter((c) => c.type === "webhook").length,
  };
  const connectionIdsWithSubs = new Set(
    subscriptions.map((s) => s.connectionId).filter(Boolean) as string[],
  );

  return (
    <SettingSection title={t("notifications.section.title")} subtitle={t("notifications.section.subtitle")}>
      <div className="space-y-2 text-sm text-muted-foreground">
        <div>{t("notifications.section.summaryCounts", counts)}</div>
        <div>
          {t("notifications.section.subscriptionsCoverage", {
            withSubs: connectionIdsWithSubs.size,
            total: connections.length,
          })}
        </div>
      </div>
      <Button variant="outline" onClick={() => navigate("/settings/notifications")} className="mt-3">
        {t("notifications.section.manageButton")}
      </Button>
    </SettingSection>
  );
}
```

(Adjust `SettingSection`'s actual prop names if they differ — check `settings-primitives.tsx`. Likely `title` + `description`; adapt.)

- [ ] **Step 3: Mount inside SettingsPage**

In `SettingsPage.tsx`, import and render `<NotificationsSettingsSection />` near the top of the page body (above `<AiDiagnosisSection />`).

- [ ] **Step 4: Build + smoke**

```bash
pnpm -F @modeldoctor/web build
```

Expected: success. Visit `/settings` in dev → notifications card visible.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/settings/NotificationsSettingsSection.tsx apps/web/src/features/settings/SettingsPage.tsx apps/web/src/locales/zh-CN/settings.json apps/web/src/locales/en-US/settings.json
git commit -m "feat(web/settings): notifications summary card with channel counts (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `/settings/notifications` sub-route + channels section

**Files:**
- Create: `apps/web/src/features/settings/NotificationsPage.tsx`
- Modify: `apps/web/src/router/index.tsx`
- Modify: `apps/web/src/locales/zh-CN/settings.json`, `en-US/settings.json` (page-level strings)

- [ ] **Step 1: Add i18n page strings**

Append under `settings.notifications` in both locale files:

```json
"page": {
  "title": "通知通道",
  "subtitle": "管理 Slack / 飞书 / 钉钉 / 通用 Webhook 通道与全局订阅",
  "breadcrumb": "通知通道"
},
"channels": {
  "sectionTitle": "通道"
},
"global": {
  "sectionTitle": "全局订阅 (跨所有连接)",
  "empty": "暂无全局订阅。如需按连接配置告警，请去连接的「通知」标签页。"
}
```

- [ ] **Step 2: Create the page**

`apps/web/src/features/settings/NotificationsPage.tsx`:

```tsx
import { PageHeader } from "@/components/common/page-header";
import { ChannelsSection } from "@/features/notifications/ChannelsSection";
import { GlobalSubscriptionsSection } from "./GlobalSubscriptionsSection";
import { useTranslation } from "react-i18next";

export function SettingsNotificationsPage(): JSX.Element {
  const { t } = useTranslation("settings");
  const { t: tSidebar } = useTranslation("sidebar");
  const breadcrumbs = [
    { label: tSidebar("items.settings") },
    { label: tSidebar("items.settings"), to: "/settings" },
    { label: t("notifications.page.breadcrumb") },
  ];
  return (
    <>
      <PageHeader
        title={t("notifications.page.title")}
        subtitle={t("notifications.page.subtitle")}
        breadcrumbs={breadcrumbs}
      />
      <div className="px-8 py-6 space-y-8">
        <ChannelsSection />
        <GlobalSubscriptionsSection />
      </div>
    </>
  );
}
```

(Reuses the existing `ChannelsSection` from `features/notifications/`. We're NOT deleting that file in this task — just re-importing it from the new location.)

- [ ] **Step 3: Add route**

In `router/index.tsx`:

```tsx
import { SettingsNotificationsPage } from "@/features/settings/NotificationsPage";
// ...
{ path: "settings/notifications", element: <SettingsNotificationsPage /> },
```

Insert right after the `settings` entry.

- [ ] **Step 4: Build smoke**

```bash
pnpm -F @modeldoctor/web build
```

Visit `/settings/notifications` → page renders, breadcrumbs visible, channels table shows. Global subscriptions section not yet implemented — Step 5 of next task.

- [ ] **Step 5: Commit (partial — global subs comes next task)**

```bash
git add apps/web/src/features/settings/NotificationsPage.tsx apps/web/src/router/index.tsx apps/web/src/locales
git commit -m "feat(web/settings): /settings/notifications sub-route with channels section (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Global subscriptions section (under `/settings/notifications`)

**Files:**
- Create: `apps/web/src/features/settings/GlobalSubscriptionsSection.tsx`
- Create: `apps/web/src/features/settings/GlobalSubscriptionSheet.tsx`

- [ ] **Step 1: Sheet component (single channel × multi-event, no connection)**

`apps/web/src/features/settings/GlobalSubscriptionSheet.tsx`:

```tsx
import { FormActions } from "@/components/common/form-actions";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useChannels, useCreateSubscription } from "@/features/notifications/queries";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { z } from "zod";

const EVENTS = ["benchmark.completed", "benchmark.failed", "diagnostics.failed"] as const;
type EventType = (typeof EVENTS)[number];

const schema = z.object({
  channelId: z.string().min(1),
  events: z.array(z.enum(EVENTS)).min(1),
});
type FormShape = z.infer<typeof schema>;

export function GlobalSubscriptionSheet({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const { data: channels = [] } = useChannels();
  const create = useCreateSubscription();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<FormShape>({
    mode: "onTouched",
    resolver: zodResolver(schema),
    defaultValues: { channelId: "", events: [] },
  });

  useEffect(() => {
    if (open) {
      setSubmitError(null);
      form.reset({ channelId: "", events: [] });
    }
  }, [open, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      // N sequential POSTs — one row per event type.
      for (const eventType of values.events) {
        await create.mutateAsync({ channelId: values.channelId, eventType });
      }
      onOpenChange(false);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : tc("errors.unknown"));
    }
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[640px]">
        <SheetHeader>
          <SheetTitle>{t("subscription.newButton")}</SheetTitle>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <FormField control={form.control} name="channelId" render={({ field }) => (
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
            )} />
            <FormField control={form.control} name="events" render={() => (
              <FormItem>
                <FormLabel required>{t("subscription.form.eventType")}</FormLabel>
                <div className="space-y-2">
                  {EVENTS.map((ev) => (
                    <label key={ev} className="flex items-center gap-2">
                      <Checkbox
                        checked={form.watch("events").includes(ev)}
                        onCheckedChange={(checked) => {
                          const current = form.getValues("events");
                          form.setValue(
                            "events",
                            checked ? [...current, ev] : current.filter((e) => e !== ev),
                            { shouldValidate: true },
                          );
                        }}
                      />
                      <span className="text-sm">{t(`subscription.form.events.${ev}`)}</span>
                    </label>
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )} />
            {submitError ? (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {submitError}
              </div>
            ) : null}
            <FormActions
              onCancel={() => onOpenChange(false)}
              cancelLabel={tc("actions.cancel")}
              submitLabel={tc("actions.create")}
              pending={create.isPending}
            />
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Section component (lists subs where connectionId is null)**

`apps/web/src/features/settings/GlobalSubscriptionsSection.tsx`:

```tsx
import { FormSection } from "@/components/common/form-section";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useDeleteSubscription, useSubscriptions } from "@/features/notifications/queries";
import type { Subscription } from "@modeldoctor/contracts";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { GlobalSubscriptionSheet } from "./GlobalSubscriptionSheet";

export function GlobalSubscriptionsSection(): JSX.Element {
  const { t } = useTranslation("settings");
  const { t: tn } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const { data = [] } = useSubscriptions();
  const del = useDeleteSubscription();
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<Subscription | null>(null);

  const globalSubs = useMemo(() => data.filter((s) => !s.connectionId), [data]);

  return (
    <FormSection title={t("notifications.global.sectionTitle")}>
      {globalSubs.length === 0 ? (
        <div className="text-sm text-muted-foreground">{t("notifications.global.empty")}</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tn("subscription.columns.channel")}</TableHead>
              <TableHead>{tn("subscription.columns.eventType")}</TableHead>
              <TableHead className="text-right">{tn("subscription.columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {globalSubs.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{s.channelName}</TableCell>
                <TableCell>{tn(`subscription.form.events.${s.eventType}`)}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setToDelete(s)}>
                    {tn("subscription.deleteButton")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div className="mt-3">
        <Button onClick={() => setCreating(true)}>{tn("subscription.newButton")}</Button>
      </div>

      <GlobalSubscriptionSheet open={creating} onOpenChange={setCreating} />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tn("delete.subscriptionTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tn("delete.subscriptionDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={async () => {
              if (toDelete) await del.mutateAsync(toDelete.id);
              setToDelete(null);
            }}>{tn("subscription.deleteButton")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FormSection>
  );
}
```

- [ ] **Step 3: Build smoke**

```bash
pnpm -F @modeldoctor/web build
```

Visit `/settings/notifications` → "全局订阅" section visible, empty state OK, can create global sub via Sheet.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/settings/GlobalSubscriptionsSection.tsx apps/web/src/features/settings/GlobalSubscriptionSheet.tsx
git commit -m "feat(web/settings): global subscriptions (no-connection) section (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: ConnectionSheet Tabs scaffold + Notifications tab

**Files:**
- Modify: `apps/web/src/features/connections/ConnectionSheet.tsx`
- Create: `apps/web/src/features/connections/notifications/ConnectionNotificationsTab.tsx`
- Create: `apps/web/src/features/connections/notifications/groupSubscriptions.ts`
- Create: `apps/web/src/features/connections/notifications/ConnectionSubscriptionSheet.tsx`
- Modify: `apps/web/src/locales/zh-CN/connections.json`, `en-US/connections.json`

- [ ] **Step 1: Add i18n keys**

Both `connections.json` files: add under `dialog`:

```json
"tabs": {
  "basic": "基础信息",
  "notifications": "通知"
},
"notifications": {
  "empty": "暂无订阅。点击下方按钮为本连接添加告警。",
  "addButton": "+ 添加订阅",
  "subscriptionsCount": "{{count}}",
  "columns": {
    "channel": "通道",
    "events": "事件",
    "actions": "操作"
  },
  "edit": "编辑",
  "delete": "删除",
  "form": {
    "channel": "通道",
    "events": "事件 (可多选)"
  }
}
```

- [ ] **Step 2: Pure helper to group rows**

`apps/web/src/features/connections/notifications/groupSubscriptions.ts`:

```ts
import type { Subscription } from "@modeldoctor/contracts";

export interface GroupedSubscription {
  channelId: string;
  channelName: string;
  events: string[];
  rowIds: string[]; // backing subscription ids
}

export function groupByChannel(rows: Subscription[]): GroupedSubscription[] {
  const map = new Map<string, GroupedSubscription>();
  for (const r of rows) {
    const existing = map.get(r.channelId);
    if (existing) {
      existing.events.push(r.eventType);
      existing.rowIds.push(r.id);
    } else {
      map.set(r.channelId, {
        channelId: r.channelId,
        channelName: r.channelName,
        events: [r.eventType],
        rowIds: [r.id],
      });
    }
  }
  return Array.from(map.values());
}
```

- [ ] **Step 3: Per-connection subscription Sheet (multi-event create + diff edit)**

`apps/web/src/features/connections/notifications/ConnectionSubscriptionSheet.tsx`:

```tsx
import { FormActions } from "@/components/common/form-actions";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  useChannels,
  useCreateSubscription,
  useDeleteSubscription,
} from "@/features/notifications/queries";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { GroupedSubscription } from "./groupSubscriptions";

const EVENTS = ["benchmark.completed", "benchmark.failed", "diagnostics.failed"] as const;
type EventType = (typeof EVENTS)[number];

const schema = z.object({
  channelId: z.string().min(1),
  events: z.array(z.enum(EVENTS)).min(1),
});
type FormShape = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connectionId: string;
  existing: GroupedSubscription | null; // null = create
}

export function ConnectionSubscriptionSheet({
  open, onOpenChange, connectionId, existing,
}: Props) {
  const { t } = useTranslation("connections");
  const { t: tn } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const { data: channels = [] } = useChannels();
  const create = useCreateSubscription();
  const del = useDeleteSubscription();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<FormShape>({
    mode: "onTouched",
    resolver: zodResolver(schema),
    defaultValues: { channelId: "", events: [] },
  });

  useEffect(() => {
    if (open) {
      setSubmitError(null);
      form.reset({
        channelId: existing?.channelId ?? "",
        events: (existing?.events ?? []) as EventType[],
      });
    }
  }, [open, existing, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      if (existing) {
        // Diff & apply
        const before = new Set(existing.events);
        const after = new Set(values.events);
        const toAdd = values.events.filter((e) => !before.has(e));
        const toRemove = existing.events
          .map((ev, i) => ({ ev, id: existing.rowIds[i] }))
          .filter(({ ev }) => !after.has(ev));
        for (const eventType of toAdd) {
          await create.mutateAsync({ channelId: values.channelId, eventType, connectionId });
        }
        for (const { id } of toRemove) {
          await del.mutateAsync(id);
        }
      } else {
        for (const eventType of values.events) {
          await create.mutateAsync({ channelId: values.channelId, eventType, connectionId });
        }
      }
      onOpenChange(false);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : tc("errors.unknown"));
    }
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[640px]">
        <SheetHeader>
          <SheetTitle>
            {existing ? t("dialog.notifications.edit") : t("dialog.notifications.addButton")}
          </SheetTitle>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <FormField control={form.control} name="channelId" render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("dialog.notifications.form.channel")}</FormLabel>
                <FormControl>
                  <Select value={field.value} onValueChange={field.onChange} disabled={!!existing}>
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
            )} />
            <FormField control={form.control} name="events" render={() => (
              <FormItem>
                <FormLabel required>{t("dialog.notifications.form.events")}</FormLabel>
                <div className="space-y-2">
                  {EVENTS.map((ev) => (
                    <label key={ev} className="flex items-center gap-2">
                      <Checkbox
                        checked={form.watch("events").includes(ev)}
                        onCheckedChange={(checked) => {
                          const current = form.getValues("events");
                          form.setValue(
                            "events",
                            checked ? [...current, ev] : current.filter((e) => e !== ev),
                            { shouldValidate: true },
                          );
                        }}
                      />
                      <span className="text-sm">{tn(`subscription.form.events.${ev}`)}</span>
                    </label>
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )} />
            {submitError ? (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {submitError}
              </div>
            ) : null}
            <FormActions
              onCancel={() => onOpenChange(false)}
              cancelLabel={tc("actions.cancel")}
              submitLabel={tc(existing ? "actions.save" : "actions.create")}
              pending={create.isPending || del.isPending}
            />
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: ConnectionNotificationsTab**

`apps/web/src/features/connections/notifications/ConnectionNotificationsTab.tsx`:

```tsx
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useDeleteSubscription, useSubscriptions } from "@/features/notifications/queries";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConnectionSubscriptionSheet } from "./ConnectionSubscriptionSheet";
import { type GroupedSubscription, groupByChannel } from "./groupSubscriptions";

interface Props {
  connectionId: string;
}

export function ConnectionNotificationsTab({ connectionId }: Props): JSX.Element {
  const { t } = useTranslation("connections");
  const { t: tn } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const { data = [] } = useSubscriptions();
  const del = useDeleteSubscription();
  const [editing, setEditing] = useState<GroupedSubscription | null | undefined>(undefined);
  const [toDelete, setToDelete] = useState<GroupedSubscription | null>(null);

  const grouped = useMemo(
    () => groupByChannel(data.filter((s) => s.connectionId === connectionId)),
    [data, connectionId],
  );

  return (
    <div className="space-y-4">
      {grouped.length === 0 ? (
        <div className="text-sm text-muted-foreground">{t("dialog.notifications.empty")}</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("dialog.notifications.columns.channel")}</TableHead>
              <TableHead>{t("dialog.notifications.columns.events")}</TableHead>
              <TableHead className="text-right">{t("dialog.notifications.columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grouped.map((g) => (
              <TableRow key={g.channelId}>
                <TableCell>{g.channelName}</TableCell>
                <TableCell>
                  {g.events.map((e) => tn(`subscription.form.events.${e}`)).join(", ")}
                </TableCell>
                <TableCell className="text-right space-x-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(g)}>
                    {t("dialog.notifications.edit")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setToDelete(g)}>
                    {t("dialog.notifications.delete")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Button onClick={() => setEditing(null)}>{t("dialog.notifications.addButton")}</Button>

      <ConnectionSubscriptionSheet
        open={editing !== undefined}
        onOpenChange={(o) => !o && setEditing(undefined)}
        connectionId={connectionId}
        existing={editing ?? null}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tn("delete.subscriptionTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tn("delete.subscriptionDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={async () => {
              if (toDelete) {
                // Delete every backing row for this grouped (channel, conn) pair.
                for (const id of toDelete.rowIds) await del.mutateAsync(id);
              }
              setToDelete(null);
            }}>{t("dialog.notifications.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 5: Wire Tabs into ConnectionSheet**

In `ConnectionSheet.tsx`, find the existing form layout. Wrap it with shadcn `Tabs`:

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConnectionNotificationsTab } from "./notifications/ConnectionNotificationsTab";
// ...

// Replace direct rendering of `<Form>` with:
<Tabs defaultValue="basic" className="mt-4">
  <TabsList>
    <TabsTrigger value="basic">{t("dialog.tabs.basic")}</TabsTrigger>
    {isEdit ? (
      <TabsTrigger value="notifications">{t("dialog.tabs.notifications")}</TabsTrigger>
    ) : null}
  </TabsList>
  <TabsContent value="basic">
    {/* existing form contents */}
  </TabsContent>
  {isEdit && existing ? (
    <TabsContent value="notifications">
      <ConnectionNotificationsTab connectionId={existing.id} />
    </TabsContent>
  ) : null}
</Tabs>
```

(Locate the actual `existing` / `isEdit` variable names in current ConnectionSheet — they vary by file revision. Inspect first.)

- [ ] **Step 6: Build + smoke**

```bash
pnpm -F @modeldoctor/web build
```

Open `/connections` → click a connection's edit → Tab "通知" visible → empty state OK → "+ 添加订阅" Sheet opens → multi-event checkbox works.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/connections/ConnectionSheet.tsx apps/web/src/features/connections/notifications apps/web/src/locales
git commit -m "feat(web/connections): notifications tab in ConnectionSheet (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 🔔 column on Connections list page

**Files:**
- Modify: `apps/web/src/features/connections/ConnectionsPage.tsx`

- [ ] **Step 1: Compute subscription counts per connection**

In `ConnectionsPage.tsx`, add:

```tsx
import { useSubscriptions } from "@/features/notifications/queries";
// ...
const { data: subs = [] } = useSubscriptions();
const subCounts = useMemo(() => {
  const m = new Map<string, number>();
  for (const s of subs) {
    if (!s.connectionId) continue;
    m.set(s.connectionId, (m.get(s.connectionId) ?? 0) + 1);
  }
  return m;
}, [subs]);
```

- [ ] **Step 2: Render new column**

Insert a `<TableCell>` between existing "Tags" and "Actions" cells, both in the header and body:

```tsx
// Header
<TableHead className="text-right">🔔</TableHead>
// Body
<TableCell className="text-right">
  {subCounts.get(c.id) ?? 0 > 0 ? subCounts.get(c.id) : "—"}
</TableCell>
```

(Adjust to existing column conventions — header label may want an i18n key like `connections:list.columns.notifications`. Add to both locale files: `"notifications": "🔔"` or `"通知"` based on what reads better.)

- [ ] **Step 3: Build + commit**

```bash
pnpm -F @modeldoctor/web build
git add apps/web/src/features/connections/ConnectionsPage.tsx apps/web/src/locales
git commit -m "feat(web/connections): subscription-count column (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Remove orphaned `/notifications` feature folder

**Files:**
- Delete: `apps/web/src/features/notifications/NotificationsPage.tsx`
- Delete: `apps/web/src/features/notifications/SubscriptionsSection.tsx`
- Delete: `apps/web/src/features/notifications/SubscriptionSheet.tsx`
- Keep: `apps/web/src/features/notifications/ChannelsSection.tsx` (still used by settings page)
- Keep: `apps/web/src/features/notifications/ChannelSheet.tsx` (still used by ChannelsSection)
- Keep: `apps/web/src/features/notifications/queries.ts` + `schemas.ts`

- [ ] **Step 1: Verify nothing imports the deletion list**

```bash
grep -rn "NotificationsPage\|SubscriptionsSection\|SubscriptionSheet" apps/web/src
```

Should match only files we're about to delete (none should still reference them).

- [ ] **Step 2: Delete**

```bash
rm apps/web/src/features/notifications/NotificationsPage.tsx \
   apps/web/src/features/notifications/SubscriptionsSection.tsx \
   apps/web/src/features/notifications/SubscriptionSheet.tsx
```

- [ ] **Step 3: Build + lint**

```bash
pnpm -F @modeldoctor/web build && pnpm -F @modeldoctor/web lint
```

Both green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/notifications
git commit -m "refactor(web): remove unused /notifications page components (#152)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Workspace green sweep + PR

- [ ] **Step 1: Everything green locally**

```bash
pnpm -r build && pnpm -r type-check && pnpm lint && pnpm -r test
```

Expected: all green. If web component tests need updates (deleted NotificationsPage referenced by an existing test, etc.), fix inline.

- [ ] **Step 2: Push**

```bash
git push -u origin feat/notifications-ia-refactor
```

- [ ] **Step 3: Open PR (stacked on #170)**

```bash
gh pr create --base feat/notifications-feishu-dingtalk \
  --title "refactor(web): notifications IA — channels in Settings, subscriptions on Connection" \
  --body "$(cat <<'EOF'
## Summary

Restructures the notifications UI surface to follow industry IA conventions (Datadog / Linear / Sentry):

- **Channels (where can we send)** → moved to **Settings**
  - `/settings` summary card with counts + 「管理 →」 button
  - `/settings/notifications` sub-route with channels CRUD + global subscriptions
- **Subscriptions (which connection notifies whom)** → moved to **ConnectionSheet** as a new "通知" Tab
  - Multi-event Sheet on add (single channel × N events → N backend rows)
  - Edit via diff-and-apply (add/remove deltas only)
- Drop top-rail `/notifications` entry from sidebar

Zero backend changes — schema, REST, MCP tools, dispatcher all untouched. Frontend hooks (`queries.ts`) reused verbatim.

Addresses #152. Stacks on #170 (Feishu/DingTalk adapters).

## Test plan
- [ ] `/notifications` no longer in sidebar
- [ ] `/settings` shows notifications summary card with correct counts
- [ ] `/settings/notifications` lists channels + global subs; CRUD works; "测试" works
- [ ] Connection edit Sheet shows two tabs; "通知" tab shows per-connection subs grouped by channel
- [ ] "+ 添加订阅" creates N backend rows for N checked events
- [ ] "编辑" on a group correctly diffs and applies (no full-recreate flicker)
- [ ] Delete grouped row cascades to all backing subscription rows
- [ ] Connections list shows 🔔 column with counts
- [ ] MCP tools still work end-to-end (no UI changes touched the backend)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Watch CI**

```bash
gh pr checks <N>
# If pending: gh run watch <run-id> --exit-status
```

- [ ] **Step 5: Hand back to user for review**

Surface CI status + PR URL. Do not merge.

---

## Self-Review

1. **Spec coverage** — Every section of the spec maps to a task above (sidebar/route → T1; settings summary → T2; settings sub-route → T3+T4; ConnectionSheet tab → T5; 🔔 column → T6; cleanup → T7; ship → T8). ✓
2. **Backend impact** — Zero. No prisma, no contracts, no api, no MCP. ✓
3. **Placeholder scan** — Every step has concrete code or commands. ✓
4. **i18n** — Both zh-CN and en-US added in T2/T3/T5. T1 strictly removes keys. ✓
5. **Risk: Tab labels under narrow widths** — shadcn `Tabs` wraps naturally; mitigate at impl time if needed.
