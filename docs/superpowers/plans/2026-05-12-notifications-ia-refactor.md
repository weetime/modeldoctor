# Notifications IA Refactor — Implementation Plan (as-built)

> Plan retained as a historical record. The shipped implementation in PR
> #171 pivoted mid-stream away from a per-connection Notifications tab to
> a single-Sheet "channel + its subscriptions" model. See the spec at
> `docs/superpowers/specs/2026-05-12-notifications-ia-refactor-design.md`
> for the final design; this plan captures what was actually built so a
> future maintainer can retrace it.

**Goal:** Move notifications UI off its standalone `/notifications` page and
make a channel the unit of management. Backend untouched.

**Branch:** `feat/notifications-ia-refactor` (PR #171, rebased onto main
after #170 squashed).

---

## File map

```
DELETE:
  apps/web/src/features/notifications/NotificationsPage.tsx
  apps/web/src/features/notifications/ChannelsSection.tsx
  apps/web/src/features/notifications/SubscriptionsSection.tsx
  apps/web/src/features/notifications/SubscriptionSheet.tsx

CREATE:
  apps/web/src/features/settings/NotificationsSettingsSection.tsx   # summary card on /settings
  apps/web/src/features/settings/NotificationsPage.tsx              # /settings/notifications list page
                                                                    #   (inlined table; no wrapper component)

MODIFY:
  apps/web/src/router/index.tsx                                     # add /settings/notifications, drop /notifications
  apps/web/src/components/sidebar/sidebar-config.tsx                # drop Bell entry
  apps/web/src/features/settings/SettingsPage.tsx                   # mount NotificationsSettingsSection
  apps/web/src/features/notifications/ChannelSheet.tsx              # add Subscriptions section + diff-and-apply
  apps/web/src/features/notifications/schemas.ts                    # split into create + edit schemas
  apps/web/src/locales/{zh-CN,en-US}/sidebar.json                   # remove "notifications" key
  apps/web/src/locales/{zh-CN,en-US}/settings.json                  # +notifications.section + page strings
  apps/web/src/locales/{zh-CN,en-US}/notifications.json             # +subscriptionsSection / events / connections / urlEditHint
```

---

## Tasks (as executed)

Each task = one commit on the branch.

### Task 1 · `refactor(web): drop /notifications top-rail entry`

Remove the `Bell` import + sidebar entry; drop the `<NotificationsPage />`
route registration and its import; remove the `notifications` key from both
locale `sidebar.json` files. Build verifies route still compiles (the
component files in `features/notifications/` stay until Task 4).

### Task 2 · `feat(web/settings): notifications summary card with channel counts`

Add `NotificationsSettingsSection` rendering a `SettingSection` with:

- Per-type channel counts (`{{slack}} Slack · {{feishu}} 飞书 · …`)
- Subscriptions coverage line (`X/Y connections have subscriptions`)
- `Manage →` button → `navigate("/settings/notifications")`

Mount it inside `SettingsPage.tsx` above the AI Diagnosis section. Add
`settings:notifications.section.*` strings to both locales.

### Task 3 · `feat(web/settings): /settings/notifications sub-route`

Add the route + dedicated page. After the design pivot (Task 4), this page
ended up as an **inlined** list — no `ChannelsSection` wrapper. The Sheet
import points at `features/notifications/ChannelSheet.tsx` directly.

Page composition (final):

- `PageHeader` with breadcrumbs `[Settings (linkable), 通知通道]` (exactly
  two entries — no redundant root)
- `rightSlot`: `+ New channel` button
- Table with cols name (clickable) · type · created · actions
- Actions: text `Test` + `<Pencil />` + `<Trash2 />` icon buttons
- Delete confirm via `AlertDialog`

### Task 4 · `feat(web/settings,notifications): embed subscriptions into ChannelSheet`

The pivot commit. Removes everything Datadog-style ("Notifications tab on
Connection", "global subscriptions section") and embeds the subscription
selectors directly into `ChannelSheet`:

- Section 1 (existing): type / name / url + tips
- Section 2 (new): event checkboxes + "All connections" Switch + scrollable
  per-connection checkbox list
- Save logic: PATCH/POST the channel, then diff intended `(connectionId, eventType)`
  pairs against existing rows, fire create + delete in parallel via `Promise.all`

Deleted orphans:

- `features/notifications/NotificationsPage.tsx`
- `features/notifications/SubscriptionsSection.tsx`
- `features/notifications/SubscriptionSheet.tsx`
- `features/notifications/ChannelsSection.tsx` (table inlined into
  `SettingsNotificationsPage` for the list-page-button-in-header pattern)
- `features/settings/GlobalSubscriptionsSection.tsx` (placeholder from the
  earlier sketch)

### Task 5 · `fix(web/notifications): channel edit form should accept blank URL`

Backend never returns the raw URL (only `urlMasked`), so edit-mode URL
input opens empty and `z.string().url()` failed on touch. Split the schema:

- `channelFormCreateSchema` — URL required, full URL validation
- `channelFormEditSchema` — URL optional, validated only if non-empty

`useForm` picks the resolver based on `!!channel`. Edit mode shows the
masked URL as placeholder + a hint that leaving the field blank keeps the
existing URL.

### Task 6 · Reviewer fixes (this turn)

Addressing #171 inline review:

- **Form-reset gating**: introduce a `useRef` that records the
  `(channel?.id, open)` tuple already seeded into the form. The reset
  effect short-circuits on subsequent re-runs, so background refetches of
  `useSubscriptions` no longer wipe user edits. Edit mode also waits for
  `subsQuery.isSuccess` before seeding, avoiding the cold-start race where
  the Sheet opens before the subs query lands.
- **Parallelise subscription mutations**: collect create + delete promises
  into arrays and `await Promise.all([...creates, ...deletes])`.
- **Breadcrumb**: drop the redundant first `Settings` entry so the
  trail reads `Settings › 通知通道` instead of `Settings › Settings › 通知通道`.
- **Docs**: rewrote this plan and the corresponding spec to match the
  shipped design.

---

## Backend impact

Zero. The same REST endpoints (`/api/notifications/...`) and MCP tools work
verbatim. The dispatcher / adapter / encryption path is unaffected.

## Test plan (manual, in PR description)

See PR #171 description. No new automated tests in this refactor — the
existing `notifications.e2e-spec.ts` exercises the dispatcher / adapter
path which is untouched.

## Risks

- **Cold-start race**: mitigated by `subsQuery.isSuccess` gate (Task 6).
- **Mutation invalidation churn**: N+M parallel mutations each invalidate
  the same query key; React-Query coalesces. Could be optimised via a
  single optimistic update in a follow-up if visibly slow.
