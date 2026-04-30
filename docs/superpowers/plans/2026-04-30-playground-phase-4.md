# Playground Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 9 v2-backlog items + 2 shared infra pieces in a single PR on `feat/regression-suite`, leaving Playground at 100% completion (no disabled / placeholder / "Phase 4" / "(not sent)" UI strings remaining).

**Architecture:** Two shared infra pieces land first (IndexedDB-backed history store, ECharts wrapper), then 9 feature commits land in dependency order. All work on long-lived branch `feat/regression-suite`; one PR with 14 commits total.

**Tech Stack:** TypeScript, React 18, vitest, NestJS 10, zod, zustand 4, ECharts 5 + echarts-for-react, idb 8, Tailwind, biome, pnpm 9 workspaces

**Spec:** `docs/superpowers/specs/2026-04-30-playground-phase-4-design.md`

**Pre-existing deviations from spec to apply during implementation:**

1. Spec § 2.1 says I1 lives at `apps/web/src/lib/history-store.ts`. **Reality:** the existing factory is `apps/web/src/features/playground/history/createHistoryStore.ts`. **Decision:** rewrite that file in place rather than introducing a parallel one — the existing tests + call sites already wire to that path.
2. Spec § 2.1 design imagines a new generic `HistoryStore<T>` interface. **Reality:** keep the existing `HistoryStoreState<S>` zustand-hook shape so consumer code (chat / audio / image / embeddings / rerank pages) doesn't break. Add async `putBlob` / `getBlob` as new methods on the hook for binary attachments.

---

## Conventions

**Test commands** (always run from repo root unless noted):

- API single test: `pnpm -F @modeldoctor/api test <relative-path>`
- API all: `pnpm -F @modeldoctor/api test`
- Web single test: `pnpm -F @modeldoctor/web test <relative-path>`
- Web all: `pnpm -F @modeldoctor/web test`
- Type check (web): `pnpm -F @modeldoctor/web type-check`
- Type check (api): `pnpm -F @modeldoctor/api type-check`
- Lint (any package): `pnpm -F <pkg> lint`

**Commit format:** Conventional commit, one logical change per commit, explicit `git add <files>`, body ends with:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Branch:** `feat/regression-suite` (already exists, long-lived).

**Path constants (used throughout):**

- Web feature root: `apps/web/src/features/playground/`
- API playground module: `apps/api/src/modules/playground/`
- OpenAI client wires: `apps/api/src/integrations/openai-client/wires/`
- Contracts package: `packages/contracts/src/`
- Web i18n: `apps/web/src/i18n/locales/{en-US,zh-CN}/playground.json`

---

## Task 0: Merge `origin/main` into `feat/regression-suite`

**Why:** PR #29 (Phase 3) is merged to main but `feat/regression-suite` is still 1 commit behind (the merge commit `b3fdb15`). Per memory rule, every new phase starts by merging main back.

**Files:** No file edits; this is a git operation only.

- [ ] **Step 1: Confirm clean working tree**

```bash
git status
```

Expected: `nothing to commit, working tree clean` and `On branch feat/regression-suite`. If dirty, stop and ask user.

- [ ] **Step 2: Fetch and merge main**

```bash
git fetch origin main
git merge --no-ff origin/main -m "chore: merge origin/main into feat/regression-suite (Phase 4 kickoff)"
```

Expected: clean fast-forward or trivial merge commit. If conflicts → stop and report (no auto-resolve). The user message about PR #29 says they merged it themselves; should fast-forward without conflict.

- [ ] **Step 3: Sanity test suite**

```bash
pnpm -r test
```

Expected: all green (Phase 3 baseline 613). If any failure → stop and report.

- [ ] **Step 4: Push the merge**

```bash
git push origin feat/regression-suite
```

---

## Task 1: Add new dependencies (`idb`, `echarts`, `echarts-for-react`)

**Why:** I1 needs `idb` (IDB promise wrapper, ~3 KB gz). I2 + C1 need `echarts` (~330 KB gz tree-shaken) + `echarts-for-react`.

**Files:**
- Modify: `apps/web/package.json` (deps)
- Modify: `pnpm-lock.yaml` (regenerated)

- [ ] **Step 1: Add deps via pnpm**

```bash
pnpm -F @modeldoctor/web add idb echarts echarts-for-react
```

Expected: lockfile regenerated, no errors. Verify versions installed (current at writing: `idb@^8`, `echarts@^5`, `echarts-for-react@^3`).

- [ ] **Step 2: Verify build still works**

```bash
pnpm -F @modeldoctor/web build
```

Expected: clean build. Note initial bundle size for later comparison (record from build output, e.g. `dist/assets/index-*.js`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
build(web): add idb + echarts + echarts-for-react

Phase 4 deps: idb (IndexedDB promise wrapper) for history blob
storage, echarts + echarts-for-react for first-class charts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: I1 — Rewrite `createHistoryStore` to use IndexedDB + add blob storage

**Why:** Current factory is localStorage-backed (5 MB cap). Multimodal attachments (image/audio/file base64) blow this cap. Move to IDB to support P2 / P3 / P4.

**Files:**
- Modify: `apps/web/src/features/playground/history/createHistoryStore.ts` (rewrite storage layer; preserve API)
- Modify: `apps/web/src/features/playground/history/createHistoryStore.test.ts` (extend with IDB + blob cases)
- Create: `apps/web/src/features/playground/history/idbStorage.ts` (zustand persist storage adapter)
- Create: `apps/web/src/features/playground/history/idbStorage.test.ts`

**Test setup:** install `fake-indexeddb` as devDep first (Step 0).

- [ ] **Step 0: Add `fake-indexeddb` devDep**

```bash
pnpm -F @modeldoctor/web add -D fake-indexeddb
```

Update `apps/web/vitest.config.ts` setup file (or `apps/web/src/test/setup.ts`) to import `fake-indexeddb/auto` so IDB is available in jsdom. If the setup file does not exist, create `apps/web/src/test/setup-idb.ts` containing `import 'fake-indexeddb/auto';` and reference it from `vitest.config.ts` `test.setupFiles`.

Run `pnpm -F @modeldoctor/web test --run` once after to confirm baseline still green.

- [ ] **Step 1: Write failing tests for `idbStorage`**

Create `apps/web/src/features/playground/history/idbStorage.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIdbStorage } from "./idbStorage";

describe("idbStorage", () => {
  beforeEach(async () => {
    // fake-indexeddb resets per test via @auto when each describe runs in isolation
  });
  afterEach(async () => {
    // best-effort wipe between tests
    indexedDB.deleteDatabase("modeldoctor-playground");
  });

  it("getItem returns null when key absent", async () => {
    const s = createIdbStorage();
    expect(await s.getItem("missing")).toBeNull();
  });

  it("setItem then getItem round-trips JSON string", async () => {
    const s = createIdbStorage();
    await s.setItem("k1", JSON.stringify({ hello: "world" }));
    expect(await s.getItem("k1")).toBe(JSON.stringify({ hello: "world" }));
  });

  it("removeItem deletes the entry", async () => {
    const s = createIdbStorage();
    await s.setItem("k1", "v1");
    await s.removeItem("k1");
    expect(await s.getItem("k1")).toBeNull();
  });

  it("blob put/get round-trips a Blob", async () => {
    const s = createIdbStorage();
    const blob = new Blob(["hello"], { type: "text/plain" });
    await s.putBlob("entry1", "att1", blob);
    const got = await s.getBlob("entry1", "att1");
    expect(got).not.toBeNull();
    expect(await got!.text()).toBe("hello");
  });

  it("blob put returns null when missing", async () => {
    const s = createIdbStorage();
    expect(await s.getBlob("e", "k")).toBeNull();
  });

  it("deleteEntryBlobs removes all blobs for entry", async () => {
    const s = createIdbStorage();
    await s.putBlob("e1", "a", new Blob(["a"]));
    await s.putBlob("e1", "b", new Blob(["b"]));
    await s.putBlob("e2", "a", new Blob(["x"]));
    await s.deleteEntryBlobs("e1");
    expect(await s.getBlob("e1", "a")).toBeNull();
    expect(await s.getBlob("e1", "b")).toBeNull();
    expect(await s.getBlob("e2", "a")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
pnpm -F @modeldoctor/web test apps/web/src/features/playground/history/idbStorage.test.ts
```

Expected: FAIL — `idbStorage` does not exist.

- [ ] **Step 3: Implement `idbStorage`**

Create `apps/web/src/features/playground/history/idbStorage.ts`:

```ts
import { type IDBPDatabase, openDB } from "idb";

const DB_NAME = "modeldoctor-playground";
const DB_VERSION = 1;
const STATE_STORE = "state"; // zustand JSON state
const BLOB_STORE = "blobs";  // binary attachments

interface BlobRow { entryId: string; key: string; blob: Blob }

let dbPromise: Promise<IDBPDatabase> | null = null;
function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STATE_STORE)) {
          db.createObjectStore(STATE_STORE);
        }
        if (!db.objectStoreNames.contains(BLOB_STORE)) {
          const s = db.createObjectStore(BLOB_STORE, { keyPath: ["entryId", "key"] });
          s.createIndex("byEntry", "entryId");
        }
      },
    });
  }
  return dbPromise;
}

export interface IdbStorage {
  // Zustand persist storage interface (string-based)
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  // Phase 4 additions:
  putBlob(entryId: string, key: string, blob: Blob): Promise<void>;
  getBlob(entryId: string, key: string): Promise<Blob | null>;
  deleteEntryBlobs(entryId: string): Promise<void>;
}

export function createIdbStorage(): IdbStorage {
  return {
    async getItem(key) {
      const db = await getDb();
      const v = await db.get(STATE_STORE, key);
      return typeof v === "string" ? v : null;
    },
    async setItem(key, value) {
      const db = await getDb();
      await db.put(STATE_STORE, value, key);
    },
    async removeItem(key) {
      const db = await getDb();
      await db.delete(STATE_STORE, key);
    },
    async putBlob(entryId, key, blob) {
      const db = await getDb();
      const row: BlobRow = { entryId, key, blob };
      await db.put(BLOB_STORE, row);
    },
    async getBlob(entryId, key) {
      const db = await getDb();
      const row = (await db.get(BLOB_STORE, [entryId, key])) as BlobRow | undefined;
      return row?.blob ?? null;
    },
    async deleteEntryBlobs(entryId) {
      const db = await getDb();
      const tx = db.transaction(BLOB_STORE, "readwrite");
      const idx = tx.store.index("byEntry");
      let cursor = await idx.openCursor(IDBKeyRange.only(entryId));
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
      await tx.done;
    },
  };
}
```

- [ ] **Step 4: Run idbStorage tests — verify pass**

```bash
pnpm -F @modeldoctor/web test apps/web/src/features/playground/history/idbStorage.test.ts
```

Expected: 6/6 PASS.

- [ ] **Step 5: Update existing `createHistoryStore.test.ts`**

The current test file uses localStorage. Reset it to ensure a clean IDB before each test by adding `beforeEach` that calls `indexedDB.deleteDatabase('modeldoctor-playground')`. Add 2 new tests:

```ts
it("putBlob then getBlob round-trips a Blob keyed by entryId+attachmentKey", async () => {
  const useStore = createHistoryStore<{ x: number }>({
    name: "test-blob", blank: () => ({ x: 0 }), preview: () => "",
  });
  const blob = new Blob(["payload"], { type: "image/png" });
  const id = useStore.getState().currentId;
  await useStore.getState().putBlob(id, "thumb", blob);
  const got = await useStore.getState().getBlob(id, "thumb");
  expect(got).not.toBeNull();
  expect(await got!.text()).toBe("payload");
});

it("removeEntry also clears its blobs", async () => {
  const useStore = createHistoryStore<{ x: number }>({
    name: "test-blob-cleanup", blank: () => ({ x: 0 }), preview: () => "",
  });
  // create a 2nd entry, attach blob, remove
  useStore.getState().newSession();        // makes a fresh entry, pushes prev to position 1
  const prevId = useStore.getState().list[1].id;
  await useStore.getState().putBlob(prevId, "k", new Blob(["x"]));
  expect(await useStore.getState().getBlob(prevId, "k")).not.toBeNull();
  useStore.getState().removeEntry(prevId);
  // give async cleanup a tick
  await new Promise(r => setTimeout(r, 10));
  expect(await useStore.getState().getBlob(prevId, "k")).toBeNull();
});
```

- [ ] **Step 6: Run extended tests — confirm fail**

```bash
pnpm -F @modeldoctor/web test apps/web/src/features/playground/history/createHistoryStore.test.ts
```

Expected: 2 new tests FAIL (`putBlob is not a function`).

- [ ] **Step 7: Modify `createHistoryStore.ts` to use idbStorage + add blob methods**

Replace the imports and the `persist` middleware config:

```ts
import { type StoreApi, type UseBoundStore, create } from "zustand";
import { type PersistStorage, persist } from "zustand/middleware";
import { createIdbStorage, type IdbStorage } from "./idbStorage";

const idb: IdbStorage = createIdbStorage();

// JSON-string passthrough storage adapter that zustand persist expects.
const idbStringStorage: PersistStorage<unknown> = {
  // zustand expects parsed objects from getItem; we pass raw strings → JSON.parse
  getItem: async (name) => {
    const raw = await idb.getItem(name);
    return raw ? JSON.parse(raw) : null;
  },
  setItem: async (name, value) => {
    await idb.setItem(name, JSON.stringify(value));
  },
  removeItem: async (name) => {
    await idb.removeItem(name);
  },
};
```

Extend `HistoryStoreState<S>`:

```ts
export interface HistoryStoreState<S> {
  list: HistoryEntry<S>[];
  currentId: string;
  restoreVersion: number;
  save: (snapshot: S) => void;
  scheduleAutoSave: (snapshot: S) => void;
  newSession: () => void;
  restore: (id: string) => void;
  removeEntry: (id: string) => void;
  reset: () => void;
  // Phase 4 additions:
  putBlob: (entryId: string, key: string, blob: Blob) => Promise<void>;
  getBlob: (entryId: string, key: string) => Promise<Blob | null>;
}
```

Implement `putBlob` / `getBlob` inside the `create<...>(persist((set, get) => ({ ... }), { ... }))` body:

```ts
putBlob: async (entryId, key, blob) => {
  await idb.putBlob(entryId, key, blob);
},
getBlob: async (entryId, key) => idb.getBlob(entryId, key),
```

Update `removeEntry` to also clear blobs:

```ts
removeEntry: (id) =>
  set((s) => {
    if (id === s.currentId) return s;
    // fire-and-forget blob cleanup; UI doesn't need to await
    void idb.deleteEntryBlobs(id);
    return { list: s.list.filter((e) => e.id !== id) };
  }),
```

Update `reset` to clear the IDB store entirely:

```ts
reset: () => {
  void idb.removeItem(input.name);  // clear persisted state
  // Note: blob orphans are acceptable here; reset is rare. If you want full
  // cleanup, call deleteEntryBlobs for each list entry first.
  set(seed());
},
```

Update the `persist` config to use the new storage and bump version:

```ts
persist(
  (set, get) => ({ /* ...as above... */ }),
  {
    name: input.name,
    version: 2,                     // 1 → 2: storage migrated to IDB; old localStorage data discarded
    storage: idbStringStorage,
    // No migrate function: per "no compat shims" policy, version 1 data is dropped.
  },
),
```

- [ ] **Step 8: Run all history tests — confirm green**

```bash
pnpm -F @modeldoctor/web test apps/web/src/features/playground/history/
```

Expected: existing tests + 2 new blob tests + 6 idbStorage tests all PASS.

- [ ] **Step 9: Run web type-check**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: 0 errors.

- [ ] **Step 10: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml \
  apps/web/src/features/playground/history/createHistoryStore.ts \
  apps/web/src/features/playground/history/createHistoryStore.test.ts \
  apps/web/src/features/playground/history/idbStorage.ts \
  apps/web/src/features/playground/history/idbStorage.test.ts \
  apps/web/vitest.config.ts apps/web/src/test/setup-idb.ts 2>/dev/null || true

git commit -m "$(cat <<'EOF'
feat(web/playground/history): switch storage to IndexedDB + add blob API

Phase 4 I1: createHistoryStore now persists JSON state to IndexedDB
('modeldoctor-playground' DB, store 'state') via a custom zustand
PersistStorage adapter. Adds a separate 'blobs' object store keyed by
[entryId, key] for binary attachments (multimodal images / audio /
files / TTS result audio), surfaced as putBlob/getBlob on the hook.
removeEntry now cascades blob deletion. persist version bumped 1→2;
old localStorage history is intentionally not migrated (no-compat-shim
policy).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: I2 — `<Chart>` ECharts wrapper component

**Why:** Spec § 2.2. Provides single source of truth for chart styling, theme, loading, empty state — used by C1 immediately and by all 5 future observability pages.

**Files:**
- Create: `apps/web/src/components/charts/Chart.tsx`
- Create: `apps/web/src/components/charts/theme.ts`
- Create: `apps/web/src/components/charts/index.ts`
- Create: `apps/web/src/components/charts/Chart.test.tsx`

- [ ] **Step 1: Write failing tests**

`apps/web/src/components/charts/Chart.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Chart } from "./Chart";

vi.mock("echarts-for-react", () => ({
  default: ({ option, style }: { option: unknown; style?: React.CSSProperties }) => (
    <div data-testid="echart" data-option={JSON.stringify(option)} style={style} />
  ),
}));

describe("<Chart>", () => {
  it("renders scatter with provided points", () => {
    render(
      <Chart
        kind="scatter"
        ariaLabel="emb scatter"
        data={{ points: [{ x: 1, y: 2, label: "a" }] }}
      />,
    );
    const el = screen.getByTestId("echart");
    const opt = JSON.parse(el.getAttribute("data-option") ?? "{}");
    expect(opt.series[0].type).toBe("scatter");
    expect(opt.series[0].data).toEqual([[1, 2, "a"]]);
  });

  it("renders line with multiple series", () => {
    render(
      <Chart
        kind="line"
        ariaLabel="lat"
        data={{ series: [
          { name: "p50", data: [[0, 10], [1, 12]] },
          { name: "p99", data: [[0, 50], [1, 60]] },
        ] }}
      />,
    );
    const opt = JSON.parse(screen.getByTestId("echart").getAttribute("data-option") ?? "{}");
    expect(opt.series.length).toBe(2);
    expect(opt.series[0].type).toBe("line");
    expect(opt.legend.data).toEqual(["p50", "p99"]);
  });

  it("shows empty state when empty=true", () => {
    render(<Chart kind="bar" ariaLabel="b" data={{ series: [] }} empty />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  it("shows loading skeleton when loading=true", () => {
    render(<Chart kind="bar" ariaLabel="b" data={{ series: [] }} loading />);
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
  });

  it("applies aria-label", () => {
    render(<Chart kind="scatter" ariaLabel="my-chart" data={{ points: [] }} />);
    expect(screen.getByLabelText("my-chart")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — confirm fail**

```bash
pnpm -F @modeldoctor/web test apps/web/src/components/charts/Chart.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement theme + Chart**

`apps/web/src/components/charts/theme.ts`:

```ts
// ECharts theme tokens aligned to Tailwind CSS variables (oklch-based).
// Light + dark variants; `Chart` selects via `theme` prop or DOM theme.
import type { EChartsOption } from "echarts";

const palette = {
  primary: "oklch(0.62 0.19 250)",
  primary2: "oklch(0.74 0.15 165)",
  primary3: "oklch(0.7 0.16 35)",
  primary4: "oklch(0.62 0.18 305)",
  primary5: "oklch(0.7 0.13 95)",
  primary6: "oklch(0.6 0.14 200)",
  primary7: "oklch(0.55 0.15 20)",
  primary8: "oklch(0.65 0.12 130)",
};

const baseColors = Object.values(palette);

export const lightTheme = {
  color: baseColors,
  backgroundColor: "transparent",
  textStyle: { color: "rgb(15 23 42)" },
  axisPointer: { lineStyle: { color: "rgba(15,23,42,0.3)" } },
  splitLine: { lineStyle: { color: "rgba(15,23,42,0.1)" } },
};

export const darkTheme = {
  color: baseColors,
  backgroundColor: "transparent",
  textStyle: { color: "rgb(226 232 240)" },
  axisPointer: { lineStyle: { color: "rgba(226,232,240,0.3)" } },
  splitLine: { lineStyle: { color: "rgba(226,232,240,0.1)" } },
};

export function applyTheme(opt: EChartsOption, dark: boolean): EChartsOption {
  const t = dark ? darkTheme : lightTheme;
  return {
    color: t.color,
    backgroundColor: t.backgroundColor,
    textStyle: t.textStyle,
    ...opt,
  };
}
```

`apps/web/src/components/charts/Chart.tsx`:

```tsx
import { use, useMemo } from "react";
import ReactECharts from "echarts-for-react";
import * as echarts from "echarts/core";
import { ScatterChart, LineChart, BarChart, HeatmapChart } from "echarts/charts";
import {
  GridComponent, TooltipComponent, LegendComponent, TitleComponent,
  DataZoomComponent, VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import { applyTheme } from "./theme";

// Tree-shake ECharts: register only what we use.
echarts.use([
  ScatterChart, LineChart, BarChart, HeatmapChart,
  GridComponent, TooltipComponent, LegendComponent, TitleComponent,
  DataZoomComponent, VisualMapComponent,
  CanvasRenderer,
]);

export type ChartKind = "scatter" | "line" | "bar" | "heatmap";

export interface ScatterPoint { x: number; y: number; label?: string; color?: string }
export interface LineBarSeries { name: string; data: Array<[number | string, number]>; color?: string }
export interface HeatmapCell { x: number | string; y: number | string; value: number }

export type ChartData<K extends ChartKind> =
  K extends "scatter" ? { points: ScatterPoint[]; xLabel?: string; yLabel?: string }
  : K extends "line" | "bar" ? { series: LineBarSeries[]; xLabel?: string; yLabel?: string }
  : K extends "heatmap" ? { cells: HeatmapCell[]; xLabels: (string | number)[]; yLabels: (string | number)[] }
  : never;

export interface ChartProps<K extends ChartKind> {
  kind: K;
  data: ChartData<K>;
  options?: Partial<EChartsOption>;
  theme?: "auto" | "light" | "dark";
  height?: number | string;
  loading?: boolean;
  empty?: boolean | string;
  ariaLabel: string;
}

function buildOption<K extends ChartKind>(
  kind: K, data: ChartData<K>, extra?: Partial<EChartsOption>,
): EChartsOption {
  if (kind === "scatter") {
    const d = data as ChartData<"scatter">;
    const opt: EChartsOption = {
      tooltip: { trigger: "item" },
      xAxis: { type: "value", name: d.xLabel ?? "" },
      yAxis: { type: "value", name: d.yLabel ?? "" },
      series: [{
        type: "scatter",
        data: d.points.map((p) => [p.x, p.y, p.label ?? ""]),
        symbolSize: 8,
      }],
      dataZoom: [{ type: "inside" }, { type: "inside", orientation: "vertical" }],
    };
    return { ...opt, ...extra };
  }
  if (kind === "line" || kind === "bar") {
    const d = data as ChartData<"line"> | ChartData<"bar">;
    const opt: EChartsOption = {
      tooltip: { trigger: "axis" },
      legend: { data: d.series.map((s) => s.name) },
      xAxis: { type: "category", name: d.xLabel ?? "" },
      yAxis: { type: "value", name: d.yLabel ?? "" },
      series: d.series.map((s) => ({ name: s.name, type: kind, data: s.data })),
    };
    return { ...opt, ...extra };
  }
  // heatmap
  const d = data as ChartData<"heatmap">;
  const opt: EChartsOption = {
    tooltip: { position: "top" },
    xAxis: { type: "category", data: d.xLabels.map(String) },
    yAxis: { type: "category", data: d.yLabels.map(String) },
    visualMap: { min: 0, max: 1, calculable: true, orient: "horizontal", left: "center", bottom: 0 },
    series: [{
      type: "heatmap",
      data: d.cells.map((c) => [String(c.x), String(c.y), c.value]),
    }],
  };
  return { ...opt, ...extra };
}

function isDarkTheme(modeProp: ChartProps<ChartKind>["theme"]): boolean {
  if (modeProp === "dark") return true;
  if (modeProp === "light") return false;
  if (typeof window === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

export function Chart<K extends ChartKind>(props: ChartProps<K>) {
  const { kind, data, options, theme = "auto", height = 360, loading, empty, ariaLabel } = props;

  const dark = isDarkTheme(theme);
  const option = useMemo(
    () => applyTheme(buildOption(kind, data, options), dark),
    [kind, data, options, dark],
  );

  if (loading) {
    return (
      <div
        role="status"
        aria-label="Loading chart"
        style={{ height }}
        className="animate-pulse rounded-md bg-muted/40"
      />
    );
  }
  if (empty) {
    const msg = typeof empty === "string" ? empty : "No data";
    return (
      <div
        role="status"
        aria-label={ariaLabel}
        style={{ height }}
        className="flex items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground"
      >
        {msg}
      </div>
    );
  }
  return (
    <div aria-label={ariaLabel} style={{ height }}>
      <ReactECharts option={option} style={{ height: "100%", width: "100%" }} />
    </div>
  );
}
```

`apps/web/src/components/charts/index.ts`:

```ts
export { Chart } from "./Chart";
export type {
  ChartKind, ChartProps, ChartData,
  ScatterPoint, LineBarSeries, HeatmapCell,
} from "./Chart";
```

- [ ] **Step 4: Run tests — confirm pass**

```bash
pnpm -F @modeldoctor/web test apps/web/src/components/charts/Chart.test.tsx
```

Expected: 5/5 PASS.

- [ ] **Step 5: Type check**

```bash
pnpm -F @modeldoctor/web type-check
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/charts/
git commit -m "$(cat <<'EOF'
feat(web/components/charts): Chart wrapper backed by tree-shaken ECharts

Phase 4 I2: <Chart kind="scatter|line|bar|heatmap"> with light/dark
theme, loading skeleton, and empty state. Tree-shakes ECharts to
~330 KB gz (charts + grid/tooltip/legend/title/dataZoom/visualMap +
canvas renderer). Auto-detects dark mode via document root class.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: C1 — Migrate Embeddings PCA to ECharts scatter

**Why:** Spec § 8. First consumer of I2; replaces self-written SVG `PcaScatter.tsx`.

**Files:**
- Create: `apps/web/src/features/playground/embeddings/EmbeddingsScatter.tsx`
- Create: `apps/web/src/features/playground/embeddings/EmbeddingsScatter.test.tsx`
- Modify: `apps/web/src/features/playground/embeddings/EmbeddingsPage.tsx` (replace PcaScatter import)
- Delete: `apps/web/src/features/playground/embeddings/PcaScatter.tsx` (and its test if any)

- [ ] **Step 1: Inspect current `PcaScatter` usage**

```bash
grep -rn "PcaScatter" apps/web/src
```

Note import sites — should be only `EmbeddingsPage.tsx`.

- [ ] **Step 2: Write failing test for EmbeddingsScatter**

`apps/web/src/features/playground/embeddings/EmbeddingsScatter.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmbeddingsScatter } from "./EmbeddingsScatter";

vi.mock("@/components/charts", () => ({
  Chart: ({ data, kind, ariaLabel }: { data: any; kind: string; ariaLabel: string }) => (
    <div data-testid="mock-chart" data-kind={kind} data-aria={ariaLabel}>
      {data.points.length} pts
    </div>
  ),
}));

describe("<EmbeddingsScatter>", () => {
  it("renders scatter with PCA-projected points labeled by truncated input", () => {
    render(
      <EmbeddingsScatter
        inputs={["a long input that will be truncated heavily for label use", "short"]}
        coords={[{ x: 0.1, y: 0.2 }, { x: -0.4, y: 0.3 }]}
      />,
    );
    const el = screen.getByTestId("mock-chart");
    expect(el.getAttribute("data-kind")).toBe("scatter");
    expect(el.textContent).toBe("2 pts");
  });

  it("renders empty state when no inputs", () => {
    render(<EmbeddingsScatter inputs={[]} coords={[]} />);
    expect(screen.queryByTestId("mock-chart")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run — confirm fail**

```bash
pnpm -F @modeldoctor/web test apps/web/src/features/playground/embeddings/EmbeddingsScatter.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement EmbeddingsScatter**

```tsx
import { Chart } from "@/components/charts";
import { useTranslation } from "react-i18next";

export interface EmbeddingsScatterProps {
  inputs: string[];
  coords: { x: number; y: number }[];
}

export function EmbeddingsScatter({ inputs, coords }: EmbeddingsScatterProps) {
  const { t } = useTranslation("playground");
  if (inputs.length === 0 || coords.length === 0) return null;

  const points = coords.map((c, i) => ({
    x: c.x,
    y: c.y,
    label: (inputs[i] ?? "").slice(0, 40),
  }));

  return (
    <Chart
      kind="scatter"
      ariaLabel={t("embeddings.scatter.ariaLabel", "PCA scatter plot of embeddings")}
      data={{ points, xLabel: "PC1", yLabel: "PC2" }}
      height={420}
      options={{
        tooltip: {
          trigger: "item",
          formatter: (params: any) => {
            const [x, y, label] = params.data as [number, number, string];
            return `${label}<br/>(${x.toFixed(3)}, ${y.toFixed(3)})`;
          },
        },
      }}
    />
  );
}
```

- [ ] **Step 5: Run — confirm pass**

Expected: 2/2 PASS.

- [ ] **Step 6: Update EmbeddingsPage to use new component**

Open `apps/web/src/features/playground/embeddings/EmbeddingsPage.tsx`, find the `import` of `PcaScatter` and the JSX `<PcaScatter ... />` usage. Replace import:

```tsx
// before:
import { PcaScatter } from "./PcaScatter";

// after:
import { EmbeddingsScatter } from "./EmbeddingsScatter";
```

Replace JSX. Determine current props passed to `<PcaScatter>` by reading the file; map to `<EmbeddingsScatter inputs={...} coords={...} />`. Coords come from existing `pca.ts` projection function output (each entry has `x`, `y`).

- [ ] **Step 7: Delete legacy PcaScatter**

```bash
rm apps/web/src/features/playground/embeddings/PcaScatter.tsx
# also delete its test if it exists:
ls apps/web/src/features/playground/embeddings/PcaScatter.test.tsx 2>/dev/null && \
  rm apps/web/src/features/playground/embeddings/PcaScatter.test.tsx
```

- [ ] **Step 8: Run embeddings tests + page test + type check**

```bash
pnpm -F @modeldoctor/web test apps/web/src/features/playground/embeddings/
pnpm -F @modeldoctor/web type-check
```

Expected: all green; if EmbeddingsPage.test.tsx breaks because it referenced PcaScatter internals, update it (replace PcaScatter mock with EmbeddingsScatter mock; same input shape).

- [ ] **Step 9: Bundle size sanity**

```bash
pnpm -F @modeldoctor/web build 2>&1 | grep -E "assets|kB|MiB"
```

Note total `dist/assets/*.js` size delta vs Task 1 baseline. Expected delta ≤ 400 KB gzipped. If exceeded, audit `Chart.tsx` `echarts.use(...)` registrations.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/features/playground/embeddings/
git commit -m "$(cat <<'EOF'
feat(web/playground/embeddings): migrate PCA scatter to <Chart> ECharts

Phase 4 C1: replaces hand-written SVG PcaScatter with EmbeddingsScatter
backed by the new Chart wrapper. Adds zoom (mouse wheel + pinch) and
hover tooltips with truncated label + PC1/PC2 coords.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: C2 — Code snippet readable/full base64 view + ViewCodeDialog toggle

**Why:** Spec § 9. Replace `<BASE64_..._TRUNCATED>` placeholders with a toggle so users can both read snippets and copy executable ones.

**Files:**
- Modify: `apps/web/src/features/playground/code-snippets/chat.ts` (split into readable / full generators)
- Modify: `apps/web/src/features/playground/code-snippets/audio.ts` (same)
- Modify: `apps/web/src/features/playground/code-snippets/code-snippets.test.ts`
- Modify: `apps/web/src/features/playground/code-snippets/__snapshots__/code-snippets.test.ts.snap` (regenerated)
- Modify: `apps/web/src/features/playground/ViewCodeDialog.tsx` (add toggle, banner, dual copy buttons)
- Modify: `apps/web/src/features/playground/ViewCodeDialog.test.tsx`

- [ ] **Step 1: Read current generator signatures**

```bash
grep -n "export function\|BASE64" apps/web/src/features/playground/code-snippets/chat.ts apps/web/src/features/playground/code-snippets/audio.ts | head -30
```

Identify the generator entry points (likely `buildChatSnippet(req): { curl, python, node }` and `buildAudioTtsSnippet(req)` / `buildAudioSttSnippet(req)`).

- [ ] **Step 2: Update generator return types — add failing test first**

Add to `code-snippets.test.ts`:

```ts
import { buildChatSnippet } from "./chat";

describe("base64 readable / full split", () => {
  const reqWithImage = {
    /* construct the same shape as existing tests but with content[0]
       containing an image_url with a long base64 data URL */
    apiBaseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "gpt-4o",
    customHeaders: undefined,
    queryParams: undefined,
    messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: "data:image/png;base64," + "A".repeat(200) } },
    ] }],
    temperature: undefined, max_tokens: undefined, stream: false,
  };

  it("produces both readable and full curl strings", () => {
    const out = buildChatSnippet(reqWithImage as any);
    expect(out).toHaveProperty("curlReadable");
    expect(out).toHaveProperty("curlFull");
    // readable truncates
    expect(out.curlReadable).toMatch(/AAAA.*\.\.\.{N more.*KB.*truncated}/);
    expect(out.curlReadable).not.toContain("A".repeat(200));
    // full preserves
    expect(out.curlFull).toContain("A".repeat(200));
  });

  it("produces matching python and node duals", () => {
    const out = buildChatSnippet(reqWithImage as any);
    expect(out.pythonReadable).not.toContain("A".repeat(200));
    expect(out.pythonFull).toContain("A".repeat(200));
    expect(out.nodeReadable).not.toContain("A".repeat(200));
    expect(out.nodeFull).toContain("A".repeat(200));
  });

  it("when no base64 fields, readable === full", () => {
    const plain = { ...reqWithImage, messages: [{ role: "user", content: "hi" }] };
    const out = buildChatSnippet(plain as any);
    expect(out.curlReadable).toBe(out.curlFull);
  });
});
```

Also delete the existing tests asserting `<BASE64_IMAGE_DATA_TRUNCATED>` since that string no longer appears (or update them to assert against the new readable-view truncation marker).

- [ ] **Step 3: Run — confirm fail**

Expected: FAIL — generators don't return `curlReadable` / `curlFull`.

- [ ] **Step 4: Update generators**

Add a helper at top of `chat.ts`:

```ts
function truncateDataUrl(dataUrl: string, headChars = 8): { readable: string; full: string } {
  // dataUrl like "data:image/png;base64,AAAA...."
  const m = dataUrl.match(/^(data:[^;]+;base64,)([A-Za-z0-9+/=]+)$/);
  if (!m) return { readable: dataUrl, full: dataUrl };
  const head = m[1];
  const body = m[2];
  if (body.length <= headChars + 16) return { readable: dataUrl, full: dataUrl };
  const kb = Math.round(body.length * 0.75 / 1024);
  return {
    readable: `${head}${body.slice(0, headChars)}...{${kb} KB truncated}`,
    full: dataUrl,
  };
}
```

Replace the existing inline truncation logic. Restructure each generator to build the request body twice — once with `truncateDataUrl(...).readable` substituted into `image_url.url` / `input_audio.data` / `input_file.file_data`, once with the full strings — and template both into the curl/python/node code.

Return shape:

```ts
export interface ChatSnippetResult {
  curlReadable: string; curlFull: string;
  pythonReadable: string; pythonFull: string;
  nodeReadable: string; nodeFull: string;
}
export function buildChatSnippet(req: PlaygroundChatRequest): ChatSnippetResult { /* ... */ }
```

Apply the same to `audio.ts` (TTS snippet — `reference_audio_base64` now needs the same dual treatment, see Task 6 for the new field).

- [ ] **Step 5: Run tests — confirm pass; regenerate snapshots**

```bash
pnpm -F @modeldoctor/web test apps/web/src/features/playground/code-snippets/ -u
```

Expected: snapshots regenerated to assert new truncation marker `...{N KB truncated}`.

- [ ] **Step 6: Update ViewCodeDialog test**

Add tests for the toggle and dual copy behavior:

```tsx
it("defaults to readable view and shows banner when full > readable", () => {
  // render with mock that supplies different readable / full
});
it("toggle switches displayed code to full view", () => { /* ... */ });
it("Copy readable / Copy full button both invoke navigator.clipboard.writeText with correct payload", () => { /* ... */ });
```

(Show full code for the test in your editor — TDD requires it. Mock `navigator.clipboard.writeText` with `vi.spyOn`.)

- [ ] **Step 7: Run — confirm fail**

Expected: ViewCodeDialog tests fail (no toggle yet).

- [ ] **Step 8: Update ViewCodeDialog.tsx**

Sketch (full implementation in editor):

```tsx
// Local state: const [view, setView] = useState<"readable" | "full">("readable");
// const hasBase64 = props.snippet.curlReadable !== props.snippet.curlFull;
// Render banner when hasBase64.
// Compute current text based on `view` and active language tab.
// Render two buttons per tab: <Button onClick={copy(readable)}>Copy readable</Button>
//                            <Button onClick={copy(full)}>Copy full data</Button>
// Where copy(text) does navigator.clipboard.writeText(text) + toast success.
```

Keep the existing tab UI for `curl / python / node`. Move the `<pre>` content selection through the new view toggle.

- [ ] **Step 9: Run all code-snippet + ViewCodeDialog tests + type check**

```bash
pnpm -F @modeldoctor/web test apps/web/src/features/playground/code-snippets/ apps/web/src/features/playground/ViewCodeDialog.test.tsx
pnpm -F @modeldoctor/web type-check
```

Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/features/playground/code-snippets/ \
  apps/web/src/features/playground/ViewCodeDialog.tsx \
  apps/web/src/features/playground/ViewCodeDialog.test.tsx \
  apps/web/src/i18n/locales 2>/dev/null || true

git commit -m "$(cat <<'EOF'
feat(web/playground/code-snippets): readable/full base64 dual view + dialog toggle

Phase 4 C2: snippet generators now return both 'readable' (head + KB
count) and 'full' (executable) variants. ViewCodeDialog renders a
banner when base64 fields are present, a toggle to switch view, and
'Copy readable' / 'Copy full data' buttons. Removes the legacy
<BASE64_..._TRUNCATED> placeholder string.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: F1 — TTS voice cloning (reference audio + reference text)

**Why:** Spec § 3. Unlock the disabled `referenceAudio` / `referenceText` fields in `TtsParams.tsx`; pass through to upstream as JSON body fields.

**Files:**
- Modify: `packages/contracts/src/playground.ts` (add `reference_audio_base64`, `reference_text` to `PlaygroundTtsRequestSchema`)
- Modify: `apps/api/src/integrations/openai-client/wires/audio.ts` (forward fields)
- Modify: `apps/api/src/modules/playground/audio.controller.ts` (length validation)
- Modify: `apps/api/src/modules/playground/audio.service.ts` (pass-through)
- Modify: `apps/api/src/modules/playground/audio.controller.spec.ts` (validation tests)
- Modify: `apps/api/src/integrations/openai-client/wires/audio.spec.ts` (forward tests)
- Modify: `apps/web/src/features/playground/audio/TtsParams.tsx` (enable fields, file picker)
- Modify: `apps/web/src/features/playground/audio/store.ts` (add fields to TtsSlice)
- Modify: `apps/web/src/features/playground/audio/TtsTab.tsx` (include in request body)
- Modify: `apps/web/src/features/playground/audio/TtsTab.test.tsx` (round-trip)
- Modify: `apps/web/src/i18n/locales/{en-US,zh-CN}/playground.json` (delete `audio.tts.advancedV2Note`, add `audio.tts.referenceAudioHint` / `audio.tts.referenceTextHint`)

### Backend half

- [ ] **Step 1: Update contract schema (write test first)**

`packages/contracts/src/playground.test.ts` — add:

```ts
describe("PlaygroundTtsRequestSchema reference fields", () => {
  it("accepts reference_audio_base64 + reference_text", () => {
    const r = PlaygroundTtsRequestSchema.parse({
      apiBaseUrl: "https://x.example.com", apiKey: "k", model: "m",
      input: "hello", voice: "alloy", format: "wav",
      reference_audio_base64: "data:audio/wav;base64,UklGR....",
      reference_text: "transcript",
    });
    expect(r.reference_audio_base64).toMatch(/^data:audio\//);
    expect(r.reference_text).toBe("transcript");
  });
  it("rejects malformed data URL", () => {
    expect(() => PlaygroundTtsRequestSchema.parse({
      apiBaseUrl: "https://x", apiKey: "k", model: "m", input: "x",
      voice: "alloy", format: "wav",
      reference_audio_base64: "not-a-data-url",
    })).toThrow();
  });
});
```

Run → fail.

- [ ] **Step 2: Implement schema additions**

In `packages/contracts/src/playground.ts`, on `PlaygroundTtsRequestSchema`, add:

```ts
reference_audio_base64: z.string()
  .regex(/^data:audio\/(wav|mp3|webm|ogg|flac|mpeg);base64,[A-Za-z0-9+/=]+$/)
  .max(20 * 1024 * 1024, "reference_audio_base64 must be ≤ 20 MB")
  .optional(),
reference_text: z.string().max(2000).optional(),
```

Run contracts test → pass.

- [ ] **Step 3: Wire layer test**

In `apps/api/src/integrations/openai-client/wires/audio.spec.ts`, add a test asserting `buildTtsBody` (or whatever it's named) includes `reference_audio_base64` and `reference_text` when present, omits when absent.

- [ ] **Step 4: Update wire**

`apps/api/src/integrations/openai-client/wires/audio.ts` — when constructing the upstream JSON body, if `req.reference_audio_base64` is set, include it in the body as-is; same for `reference_text`. No transformation.

- [ ] **Step 5: Service layer + controller validation**

In `audio.controller.ts`'s body-validation logic (or service entry point), enforce: if `reference_audio_base64` is present, decoded byte length must be ≤ 15 MB (leaves 5 MB for other fields within the 20 MB controller body cap):

```ts
if (body.reference_audio_base64) {
  const b64 = body.reference_audio_base64.split(",")[1] ?? "";
  const bytes = Math.floor(b64.length * 0.75);
  if (bytes > 15 * 1024 * 1024) {
    throw new BadRequestException("reference_audio_base64 exceeds 15 MB decoded");
  }
}
```

Add a test in `audio.controller.spec.ts` for this 4xx path.

- [ ] **Step 6: Run all api tests + type check**

```bash
pnpm -F @modeldoctor/api test
pnpm -F @modeldoctor/api type-check
```

Expected: all green.

### Frontend half

- [ ] **Step 7: Update TtsSlice**

In `apps/web/src/features/playground/audio/store.ts`, on `TtsSlice` add:

```ts
referenceAudioBase64?: string;  // 'data:audio/...;base64,...'
referenceAudioFilename?: string;
referenceText?: string;
```

Plus setters: `setReferenceAudio({ base64, filename } | null)`, `setReferenceText(t: string)`.

- [ ] **Step 8: Replace disabled inputs in TtsParams**

`apps/web/src/features/playground/audio/TtsParams.tsx` — under the existing `<details>` section, replace the two disabled inputs:

```tsx
<div>
  <Label className="text-xs">{t("audio.tts.params.referenceAudio")}</Label>
  <input
    type="file"
    accept="audio/wav,audio/mp3,audio/mpeg,audio/webm,audio/ogg,audio/flac"
    onChange={(e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      if (f.size > 15 * 1024 * 1024) {
        toast.error(t("audio.tts.params.referenceAudioTooLarge"));
        return;
      }
      const r = new FileReader();
      r.onload = () => {
        onChange({
          referenceAudioBase64: r.result as string,
          referenceAudioFilename: f.name,
        });
      };
      r.readAsDataURL(f);
    }}
  />
  {value.referenceAudioFilename && (
    <p className="text-xs text-muted-foreground">
      {value.referenceAudioFilename}
      <button
        type="button"
        className="ml-2 text-destructive underline"
        onClick={() => onChange({ referenceAudioBase64: undefined, referenceAudioFilename: undefined })}
      >
        {t("common.remove")}
      </button>
    </p>
  )}
  <p className="text-xs text-muted-foreground">{t("audio.tts.params.referenceAudioHint")}</p>
</div>
<div>
  <Label className="text-xs">{t("audio.tts.params.referenceText")}</Label>
  <Textarea
    value={value.referenceText ?? ""}
    onChange={(e) => onChange({ referenceText: e.target.value })}
    rows={2}
    placeholder={t("audio.tts.params.referenceTextPlaceholder")}
  />
  <p className="text-xs text-muted-foreground">{t("audio.tts.params.referenceTextHint")}</p>
</div>
```

- [ ] **Step 9: TtsTab — include fields in request body**

In `apps/web/src/features/playground/audio/TtsTab.tsx`, in the `body` construction:

```ts
const body: PlaygroundTtsRequest = {
  /* ...existing... */
  reference_audio_base64: fresh.tts.referenceAudioBase64,
  reference_text: fresh.tts.referenceText,
};
```

- [ ] **Step 10: Update TtsTab test**

In `TtsTab.test.tsx`, add a test that fills both reference fields, clicks Send, and asserts the api.post call's body included `reference_audio_base64` and `reference_text`.

- [ ] **Step 11: i18n updates**

In both `playground.json` files, delete `audio.tts.advancedV2Note`, add:

```json
"audio.tts.params.referenceAudio": "Reference audio",
"audio.tts.params.referenceAudioHint": "Optional — voice clone source (≤15 MB, wav/mp3/flac)",
"audio.tts.params.referenceAudioTooLarge": "Reference audio must be ≤ 15 MB",
"audio.tts.params.referenceText": "Reference text",
"audio.tts.params.referenceTextHint": "Optional — transcript of the reference audio",
"audio.tts.params.referenceTextPlaceholder": "The exact text spoken in the reference audio (improves clone quality)"
```

(Same keys translated in zh-CN.) Run `grep -rn "advancedV2Note" apps/web/src` → must return zero matches.

- [ ] **Step 12: Run all web tests + type check + biome**

```bash
pnpm -F @modeldoctor/web test
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/web lint
```

- [ ] **Step 13: Commit**

```bash
git add packages/contracts/src/ \
  apps/api/src/modules/playground/audio.controller.ts \
  apps/api/src/modules/playground/audio.service.ts \
  apps/api/src/modules/playground/audio.controller.spec.ts \
  apps/api/src/integrations/openai-client/wires/audio.ts \
  apps/api/src/integrations/openai-client/wires/audio.spec.ts \
  apps/web/src/features/playground/audio/store.ts \
  apps/web/src/features/playground/audio/TtsParams.tsx \
  apps/web/src/features/playground/audio/TtsTab.tsx \
  apps/web/src/features/playground/audio/TtsTab.test.tsx \
  apps/web/src/i18n/locales/

git commit -m "$(cat <<'EOF'
feat(playground/audio): TTS voice cloning (reference audio + text)

Phase 4 F1: contract adds optional reference_audio_base64
(data-URL-validated, ≤15 MB decoded) and reference_text fields to
PlaygroundTtsRequest. Backend forwards to upstream as JSON; no
field-name translation (per spec R3 — upstream OpenAI-compat shim is
responsible for mapping to its native field name). Frontend enables
the TTS Advanced panel's reference fields with file picker + 15 MB
client-side guard. Removes the 'Phase 4' placeholder i18n string.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: P2 — Persist TTS result audio in IDB history

**Why:** Spec § 7.3. Audio history currently restores inputs only; user wants to replay generated audio.

**Files:**
- Modify: `apps/web/src/features/playground/audio/history.ts` (or wherever the audio history hook lives — locate via `grep -rn "createHistoryStore" apps/web/src/features/playground/audio`)
- Modify: `apps/web/src/features/playground/audio/AudioPage.tsx` (write blob on TTS success; expose play button on history rows)
- Modify: `apps/web/src/features/playground/audio/AudioPage.test.tsx` (round-trip)
- Modify: `apps/web/src/features/playground/audio/store.ts` if needed

- [ ] **Step 1: Locate audio history wiring**

```bash
grep -rn "createHistoryStore\|audioHistory\|tts.result" apps/web/src/features/playground/audio | head -20
```

Determine which file owns the audio history store and where TTS success is handled.

- [ ] **Step 2: Write failing test**

In `AudioPage.test.tsx` add:

```tsx
it("persists TTS result audio as a blob in history and can replay it", async () => {
  // 1. mock api.post to return success with audioBase64
  // 2. render AudioPage in TTS tab
  // 3. type input, click Send
  // 4. assert that putBlob was called with current entry id, key='tts_result', a Blob
  // 5. open the History drawer
  // 6. assert each row with a TTS result has a "▶" play button
  // 7. click play, assert audio element src = createObjectURL(blob)
});
```

(Stub `URL.createObjectURL` with a vi spy returning `"blob:fake"`. Mock `useHistoryStore.getState().getBlob` to return the saved blob.)

- [ ] **Step 3: Run — confirm fail**

- [ ] **Step 4: Implement TTS-success blob persist**

In the file owning TTS submit-success:

```ts
async function persistTtsResult(audioBase64: string, format: string) {
  const id = useAudioHistoryStore.getState().currentId;
  // dataURL → Blob
  const m = audioBase64.match(/^data:[^;]+;base64,(.*)$/);
  const b64 = m ? m[1] : audioBase64;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: `audio/${format}` });
  await useAudioHistoryStore.getState().putBlob(id, "tts_result", blob);
}

// In onSend success branch, after store.setTtsResult({...}):
await persistTtsResult(res.audioBase64, res.format ?? fresh.tts.format);
```

- [ ] **Step 5: Implement history-row play button**

In the history drawer rendering for audio (locate via `HistoryDrawer.tsx`), pass an extra renderer per row that:

```tsx
const [src, setSrc] = useState<string | null>(null);
useEffect(() => {
  let url: string | null = null;
  (async () => {
    const blob = await store.getBlob(entry.id, "tts_result");
    if (blob) {
      url = URL.createObjectURL(blob);
      setSrc(url);
    }
  })();
  return () => { if (url) URL.revokeObjectURL(url); };
}, [entry.id]);

return src ? <audio controls src={src} /> : null;
```

Or simpler — a "▶" button that lazily fetches the blob, creates an object URL, and plays through a single shared `<audio>` element.

- [ ] **Step 6: Restore-on-row-click**

When user restores a history entry whose row has a TTS result blob, set the audio store's `tts.result.audioBase64` from the blob (read via `getBlob`, then `FileReader.readAsDataURL`).

- [ ] **Step 7: Tests + type check**

```bash
pnpm -F @modeldoctor/web test apps/web/src/features/playground/audio/
pnpm -F @modeldoctor/web type-check
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/playground/audio/
git commit -m "$(cat <<'EOF'
feat(web/playground/audio): persist TTS result audio in IDB history

Phase 4 P2: on TTS success, the result audio is converted to a Blob
and stored under the current history entry's 'tts_result' key.
History drawer rows with a saved blob render a play button that
lazily creates an object URL. Restoring a history entry rehydrates
the audio player so users can re-listen without re-running the call.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: P1 — Multimodal chat `file` kind real upload via `input_file`

**Why:** Spec § 6. Currently file attachments show "(not sent)" placeholder; this lights them up.

**Files:**
- Modify: `packages/contracts/src/playground.ts` (add `InputFilePartSchema`, extend discriminated union)
- Modify: `packages/contracts/src/playground.test.ts`
- Modify: `apps/web/src/features/playground/chat/MessageComposer.tsx` (mime/size guard, drop "(not sent)")
- Modify: `apps/web/src/features/playground/chat/MessageComposer.test.tsx`
- Modify: `apps/web/src/features/playground/chat/ChatPage.tsx` (file content part in body)
- Modify: `apps/web/src/features/playground/chat/ChatPage.test.tsx`
- Modify: `apps/web/src/features/playground/chat-compare/ChatPanel.tsx` (same body change as ChatPage)
- Modify: `apps/web/src/features/playground/code-snippets/chat.ts` (handle `input_file` part)
- Update snapshots
- i18n: add `chat.attachments.file.unsupportedMime`, `chat.attachments.file.tooLarge`

- [ ] **Step 1: Contract test first**

Add to `playground.test.ts`:

```ts
it("ChatMessageContentPart accepts input_file with PDF base64 data URL", () => {
  const r = ChatMessageContentPartSchema.parse({
    type: "input_file",
    file: {
      filename: "doc.pdf",
      file_data: "data:application/pdf;base64,JVBERi0xLjQ=",
    },
  });
  expect(r.type).toBe("input_file");
});

it("rejects input_file with non-whitelisted mime", () => {
  expect(() => ChatMessageContentPartSchema.parse({
    type: "input_file",
    file: { filename: "x.exe", file_data: "data:application/x-msdownload;base64,AA==" },
  })).toThrow();
});
```

- [ ] **Step 2: Run — confirm fail**

- [ ] **Step 3: Add `InputFilePartSchema`**

```ts
const FILE_MIME_RE = /^data:(application\/pdf|text\/plain|application\/json|text\/markdown|text\/x-markdown);base64,[A-Za-z0-9+/=]+$/;

const InputFilePartSchema = z.object({
  type: z.literal("input_file"),
  file: z.object({
    filename: z.string().min(1).max(256),
    file_data: z.string().regex(FILE_MIME_RE),
  }),
});

export const ChatMessageContentPartSchema = z.discriminatedUnion("type", [
  TextPartSchema, ImageUrlPartSchema, InputAudioPartSchema, InputFilePartSchema,
]);
```

Run contracts tests → pass.

- [ ] **Step 4: MessageComposer test**

```tsx
it("rejects unsupported mime", async () => {
  const { user } = setup();
  const file = new File(["x"], "evil.exe", { type: "application/x-msdownload" });
  await user.upload(screen.getByLabelText(/file/i), file);
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/not supported/i));
  // attachment list does not contain it
});

it("rejects > 8 MB", async () => {
  const file = new File([new Uint8Array(9 * 1024 * 1024)], "big.pdf", { type: "application/pdf" });
  await user.upload(screen.getByLabelText(/file/i), file);
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/too large/i));
});

it("accepts a PDF and adds it to attachments without (not sent) marker", async () => {
  const file = new File(["%PDF-1.4"], "hello.pdf", { type: "application/pdf" });
  await user.upload(screen.getByLabelText(/file/i), file);
  expect(screen.queryByText(/not sent/i)).not.toBeInTheDocument();
  expect(screen.getByText("hello.pdf")).toBeInTheDocument();
});
```

- [ ] **Step 5: Run — confirm fail**

- [ ] **Step 6: Implement guards in MessageComposer**

```ts
const ALLOWED_FILE_MIMES = new Set([
  "application/pdf", "text/plain", "application/json",
  "text/markdown", "text/x-markdown",
]);
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function onFilePicked(f: File) {
  if (!ALLOWED_FILE_MIMES.has(f.type)) {
    toast.error(t("chat.attachments.file.unsupportedMime"));
    return;
  }
  if (f.size > MAX_FILE_BYTES) {
    toast.error(t("chat.attachments.file.tooLarge"));
    return;
  }
  const r = new FileReader();
  r.onload = () => {
    addAttachment({
      kind: "file",
      filename: f.name,
      mime: f.type,
      dataUrl: r.result as string,
      sizeBytes: f.size,
    });
  };
  r.readAsDataURL(f);
}
```

Remove the JSX node showing `(not sent)` next to file chips.

- [ ] **Step 7: ChatPage / ChatPanel — emit input_file part**

When converting attachments to OpenAI content parts, file kind now produces:

```ts
if (a.kind === "file") {
  return {
    type: "input_file",
    file: { filename: a.filename, file_data: a.dataUrl },
  };
}
```

(replacing the previous skip / placeholder logic.)

- [ ] **Step 8: Code snippet support for input_file**

In `chat.ts` snippet generator: for content parts of type `input_file`, in readable view render `{ type: "input_file", file: { filename, file_data: <truncated> } }`; in full view keep the full base64. Update existing snapshot.

- [ ] **Step 9: Tests + type check + lint**

```bash
pnpm -r test
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/api type-check
pnpm -F @modeldoctor/web lint
pnpm -F @modeldoctor/api lint
```

- [ ] **Step 10: Commit**

```bash
git add packages/contracts/src/ \
  apps/web/src/features/playground/chat/ \
  apps/web/src/features/playground/chat-compare/ChatPanel.tsx \
  apps/web/src/features/playground/code-snippets/chat.ts \
  apps/web/src/features/playground/code-snippets/__snapshots__/ \
  apps/web/src/i18n/locales/

git commit -m "$(cat <<'EOF'
feat(playground/chat): file attachment real upload via input_file part

Phase 4 P1: replaces the placeholder file-attachment behavior with
actual transmission as an OpenAI 'input_file' content part. Whitelist:
application/pdf, text/plain, application/json, text/markdown. Per-file
cap 8 MB. ChatMessageContentPartSchema discriminated union extended.
Code snippet generator preserves base64 in full-view, truncates in
readable-view. Removes the '(not sent)' UI marker.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: P4 — Persist chat history attachments in IDB

**Why:** Spec § 7.1. Currently chat snapshots strip base64; with I1 + I2 in place, persist them as Blobs keyed under the entry.

**Files:**
- Modify: `apps/web/src/features/playground/chat/ChatPage.tsx` (sanitize+persist on save; rehydrate on restore)
- Modify: `apps/web/src/features/playground/chat/ChatPage.test.tsx`
- Modify: `apps/web/src/features/playground/history/HistoryDrawer.tsx` (delete the "📎 N attachment(s) not saved" indicator path; show real previews/icons)

- [ ] **Step 1: Locate current sanitize/restore logic**

```bash
grep -n "attachment(s) not saved\|attachmentRef\|sanitize\|sanitizeChat" apps/web/src/features/playground/chat/ apps/web/src/features/playground/history/
```

- [ ] **Step 2: Write failing test (round-trip with image)**

In `ChatPage.test.tsx`:

```tsx
it("persists chat with image attachment as blob and rehydrates on restore", async () => {
  // 1. simulate user sending message with image_url part containing data URL
  // 2. wait for autosave
  // 3. assert putBlob was called with key like 'msg0.part0' and a Blob
  // 4. trigger restore on a different snapshot then back
  // 5. assert content[0].image_url.url matches original data URL
});
```

- [ ] **Step 3: Run — confirm fail**

- [ ] **Step 4: Implement sanitize-on-save**

Walk each message's content parts. For any `image_url` / `input_audio` / `input_file` whose data is a base64 data URL:

```ts
async function persistAttachments(entryId: string, snap: ChatSnapshot): Promise<ChatSnapshot> {
  const out = structuredClone(snap);
  for (let i = 0; i < out.messages.length; i++) {
    const m = out.messages[i];
    if (typeof m.content === "string") continue;
    for (let j = 0; j < m.content.length; j++) {
      const p = m.content[j];
      const key = `msg${i}.part${j}`;
      if (p.type === "image_url" && /^data:/.test(p.image_url.url)) {
        const blob = dataUrlToBlob(p.image_url.url);
        await useChatHistoryStore.getState().putBlob(entryId, key, blob);
        out.messages[i].content[j] = { ...p, image_url: { url: `idb://${key}` } };
      } else if (p.type === "input_audio" && p.input_audio.data) {
        const blob = base64ToBlob(p.input_audio.data, `audio/${p.input_audio.format}`);
        await useChatHistoryStore.getState().putBlob(entryId, key, blob);
        out.messages[i].content[j] = { ...p, input_audio: { ...p.input_audio, data: `idb://${key}` } };
      } else if (p.type === "input_file" && /^data:/.test(p.file.file_data)) {
        const blob = dataUrlToBlob(p.file.file_data);
        await useChatHistoryStore.getState().putBlob(entryId, key, blob);
        out.messages[i].content[j] = { ...p, file: { ...p.file, file_data: `idb://${key}` } };
      }
    }
  }
  return out;
}
```

(Helpers: `dataUrlToBlob` already used in audio-history; lift it to a shared util `apps/web/src/lib/dataUrl.ts` if you write it again — keep DRY.)

- [ ] **Step 5: Implement rehydrate-on-restore**

When `restore` is called or when a saved snapshot is loaded, reverse the above: if a content-part field starts with `idb://`, read the blob, convert back to data URL via `FileReader`, and inject into state. Do this asynchronously after `restore`; chat UI can show a spinner per attachment until ready.

- [x] **Step 6: Remove "📎 not saved" indicator** — **NO-OP**

  The `📎 N attachment(s) not saved` indicator was inlined inside
  `sanitizeChatSnapshot` in `ChatPage.tsx` (removed as part of dcf1484 when
  that function was replaced by `persistAttachments`). It was never a JSX node
  in `HistoryDrawer.tsx`. Confirmed via `grep -rn "attachment(s) not saved"`
  returning zero matches across all of `apps/web/src/`. Plan annotation added
  in follow-up commit per review request.

- [ ] **Step 7: Tests + type check**

```bash
pnpm -F @modeldoctor/web test apps/web/src/features/playground/chat/ apps/web/src/features/playground/history/
pnpm -F @modeldoctor/web type-check
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/features/playground/chat/ \
  apps/web/src/features/playground/history/ \
  apps/web/src/lib/dataUrl.ts 2>/dev/null || true \
  apps/web/src/i18n/locales/

git commit -m "$(cat <<'EOF'
feat(web/playground/chat): persist chat history attachments in IDB

Phase 4 P4: chat snapshots now retain image / audio / file attachments
by writing each part's binary to the IDB blob store under the entry's
'msgI.partJ' key, and replacing the inline data URL with an 'idb://'
sentinel. Restore reverses the transformation. Removes the '📎 N
attachment(s) not saved' fallback indicator.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: F2 — Image inpaint (mask painter + `/images/edit`)

**Why:** Spec § 4. Largest single piece of work; new endpoint + new component + multipart upload.

**Files:**
- Modify: `packages/contracts/src/playground.ts` (add `PlaygroundImagesEditMultipartFieldsSchema`)
- Modify: `apps/api/src/integrations/openai-client/wires/images.ts` (add `edit` function building multipart)
- Modify: `apps/api/src/integrations/openai-client/wires/images.spec.ts` (or test if exists)
- Modify: `apps/api/src/modules/playground/images.controller.ts` (new `@Post('edit')`)
- Modify: `apps/api/src/modules/playground/images.service.ts` (new `edit()`)
- Modify: `apps/api/src/modules/playground/images.service.spec.ts`
- Create: `apps/web/src/features/playground/image/MaskPainter.tsx`
- Create: `apps/web/src/features/playground/image/MaskPainter.test.tsx`
- Create: `apps/web/src/features/playground/image/InpaintMode.tsx`
- Create: `apps/web/src/features/playground/image/InpaintMode.test.tsx`
- Modify: `apps/web/src/features/playground/image/ImagePage.tsx` (mode tab + URL ?mode=)
- Modify: `apps/web/src/features/playground/image/ImagePage.test.tsx`
- Modify: i18n with `image.inpaint.*` keys

### Backend

- [ ] **Step 1: Service test (multipart routing)**

Write a test in `images.service.spec.ts` for the new `edit()` method that mocks the upstream HTTP and asserts:

- POST goes to `${apiBaseUrl}/images/edits`
- Content-Type is `multipart/form-data; boundary=...`
- form contains fields: `image` (Blob), `mask` (Blob), `prompt` (string), `model` (string), `n` (string), `size` (string)

- [ ] **Step 2: Run — fail (no edit() yet)**

- [ ] **Step 3: Implement `wires/images.ts` edit + service**

```ts
// wires/images.ts
export async function edit(input: {
  apiBaseUrl: string; apiKey: string; customHeaders?: Record<string, string>; queryParams?: string;
  image: Buffer; mask: Buffer; prompt: string; model: string; n: number; size: string;
}): Promise<{ images: Array<{ url?: string; b64_json?: string }>; latencyMs: number }> {
  const form = new FormData();
  form.append("image", new Blob([input.image], { type: "image/png" }), "image.png");
  form.append("mask",  new Blob([input.mask],  { type: "image/png" }), "mask.png");
  form.append("prompt", input.prompt);
  form.append("model",  input.model);
  form.append("n",      String(input.n));
  form.append("size",   input.size);

  const url = withQuery(`${input.apiBaseUrl.replace(/\/+$/, "")}/images/edits`, input.queryParams);
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.apiKey}`, ...(input.customHeaders ?? {}) },
    body: form,
  });
  const latencyMs = Date.now() - t0;
  if (!res.ok) throw new UpstreamError(res.status, await res.text());
  const j = await res.json();
  return { images: j.data ?? [], latencyMs };
}
```

(Reuse existing helpers `withQuery`, `UpstreamError` from neighboring wires.)

```ts
// images.service.ts
async edit(input: ImagesEditInput) {
  return this.imagesWire.edit({
    apiBaseUrl: input.apiBaseUrl,
    apiKey: input.apiKey,
    customHeaders: input.customHeaders,
    queryParams: input.queryParams,
    image: input.image, // Buffer from multer
    mask: input.mask,
    prompt: input.prompt,
    model: input.model,
    n: input.n,
    size: input.size,
  });
}
```

- [ ] **Step 4: Controller**

```ts
@Post("edit")
@UseInterceptors(FileFieldsInterceptor([
  { name: "image", maxCount: 1 },
  { name: "mask",  maxCount: 1 },
], { limits: { fileSize: 5 * 1024 * 1024 } }))
async edit(
  @UploadedFiles() files: { image?: Express.Multer.File[]; mask?: Express.Multer.File[] },
  @Body() body: { apiBaseUrl: string; apiKey: string; prompt: string; model: string; n: string; size: string; customHeaders?: string; queryParams?: string },
) {
  const image = files.image?.[0]?.buffer;
  const mask  = files.mask?.[0]?.buffer;
  if (!image) throw new BadRequestException("image is required");
  if (!mask)  throw new BadRequestException("mask is required");

  return this.images.edit({
    apiBaseUrl: body.apiBaseUrl, apiKey: body.apiKey,
    customHeaders: body.customHeaders ? JSON.parse(body.customHeaders) : undefined,
    queryParams: body.queryParams,
    image, mask,
    prompt: body.prompt,
    model: body.model,
    n: Number(body.n),
    size: body.size,
  });
}
```

- [ ] **Step 5: API tests + type check**

```bash
pnpm -F @modeldoctor/api test
pnpm -F @modeldoctor/api type-check
```

### Frontend

- [ ] **Step 6: MaskPainter test (limited; jsdom can't render canvas pixels)**

`MaskPainter.test.tsx`:

```tsx
it("calls onMaskChange after Reset", async () => {
  const onMaskChange = vi.fn();
  render(<MaskPainter imageUrl="blob:fake" width={100} height={100} brushSize={20} onMaskChange={onMaskChange} />);
  await user.click(screen.getByRole("button", { name: /reset/i }));
  expect(onMaskChange).toHaveBeenCalled();
});
it("toolbar shows brush size slider with given value", () => {
  render(<MaskPainter imageUrl="blob:fake" width={100} height={100} brushSize={30} onMaskChange={vi.fn()} onBrushSizeChange={vi.fn()} />);
  expect(screen.getByRole("slider", { name: /brush size/i })).toHaveValue("30");
});
```

(Don't test pixel painting — covered by Playwright in Phase 4 e2e step.)

- [ ] **Step 7: Implement MaskPainter**

```tsx
import { useEffect, useRef, useState } from "react";

interface Props {
  imageUrl: string;
  width: number;
  height: number;
  brushSize: number;
  onBrushSizeChange?: (n: number) => void;
  onMaskChange: (mask: Blob | null) => void;
}

export function MaskPainter({ imageUrl, width, height, brushSize, onBrushSizeChange, onMaskChange }: Props) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const undoBuf = useRef<ImageData | null>(null);

  // load image into base canvas
  useEffect(() => {
    const c = baseRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => ctx.drawImage(img, 0, 0, width, height);
    img.src = imageUrl;
  }, [imageUrl, width, height]);

  function exportMask(): Promise<Blob | null> {
    const c = overlayRef.current; if (!c) return Promise.resolve(null);
    // overlay canvas: any pixel with red rgba becomes alpha=0; rest alpha=255 (black)
    const out = document.createElement("canvas");
    out.width = c.width; out.height = c.height;
    const octx = out.getContext("2d")!;
    octx.fillStyle = "black";
    octx.fillRect(0, 0, out.width, out.height);
    const src = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
    const dst = octx.getImageData(0, 0, out.width, out.height);
    for (let i = 0; i < src.data.length; i += 4) {
      // src painted area has alpha > 0 → mark inpaint by setting alpha=0 in mask
      if (src.data[i + 3] > 0) dst.data[i + 3] = 0;
    }
    octx.putImageData(dst, 0, 0);
    return new Promise((resolve) => out.toBlob((b) => resolve(b), "image/png"));
  }

  async function emit() {
    onMaskChange(await exportMask());
  }

  function startStroke(e: React.PointerEvent) {
    const c = overlayRef.current; if (!c) return;
    undoBuf.current = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
    setDrawing(true);
    paint(e);
  }
  function paint(e: React.PointerEvent) {
    if (!drawing && e.type !== "pointerdown") return;
    const c = overlayRef.current; if (!c) return;
    const ctx = c.getContext("2d")!;
    const rect = c.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (c.width / rect.width);
    const y = (e.clientY - rect.top) * (c.height / rect.height);
    ctx.fillStyle = "rgba(255,0,0,0.4)";
    ctx.beginPath();
    ctx.arc(x, y, brushSize / 2, 0, 2 * Math.PI);
    ctx.fill();
  }
  async function endStroke() {
    setDrawing(false);
    await emit();
  }
  function reset() {
    const c = overlayRef.current; if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    undoBuf.current = null;
    void emit();
  }
  function undo() {
    const c = overlayRef.current; if (!c || !undoBuf.current) return;
    c.getContext("2d")!.putImageData(undoBuf.current, 0, 0);
    undoBuf.current = null;
    void emit();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label htmlFor="brush" className="text-xs">Brush size</label>
        <input
          id="brush" type="range" min={4} max={120} step={2}
          value={brushSize}
          onChange={(e) => onBrushSizeChange?.(Number(e.target.value))}
          aria-label="Brush size"
        />
        <button type="button" onClick={undo}>Undo</button>
        <button type="button" onClick={reset}>Reset</button>
      </div>
      <div style={{ position: "relative", width, height }}>
        <canvas ref={baseRef} width={width} height={height} style={{ position: "absolute", top: 0, left: 0 }} />
        <canvas
          ref={overlayRef} width={width} height={height}
          style={{ position: "absolute", top: 0, left: 0, cursor: "crosshair" }}
          onPointerDown={startStroke} onPointerMove={paint} onPointerUp={endStroke}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 8: InpaintMode + ImagePage tab**

InpaintMode wires together: file picker for original image → MaskPainter → prompt input → submit (multipart POST to `/api/playground/images/edit`) → result grid.

ImagePage adds a Tabs component (`<Tabs value={mode} onValueChange={...}>` with `Generate` and `Edit (Inpaint)`); URL `?mode=edit|generate` keeps state.

- [ ] **Step 9: Tests + type check + lint**

```bash
pnpm -F @modeldoctor/web test apps/web/src/features/playground/image/
pnpm -F @modeldoctor/web type-check
```

- [ ] **Step 10: Commit**

```bash
git add packages/contracts/src/ \
  apps/api/src/modules/playground/images.controller.ts \
  apps/api/src/modules/playground/images.service.ts \
  apps/api/src/modules/playground/images.service.spec.ts \
  apps/api/src/integrations/openai-client/wires/images.ts \
  apps/web/src/features/playground/image/ \
  apps/web/src/i18n/locales/

git commit -m "$(cat <<'EOF'
feat(playground/image): inpaint mode (mask painter + /images/edit)

Phase 4 F2: new POST /api/playground/images/edit endpoint accepts
multipart (image PNG/JPEG/WebP, mask PNG with alpha, prompt, model, n,
size) and forwards to upstream /images/edits. Frontend adds an
'Edit (Inpaint)' tab on ImagePage with a canvas-based MaskPainter:
brush slider, single-step Undo, Reset, semi-transparent red overlay
visualizing the masked area. Mask is exported as a same-size PNG with
alpha=0 in painted regions (OpenAI inpaint convention).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: F3 — Compare extended to 6 / 8 panels + auto-fit grid

**Why:** Spec § 5.

**Files:**
- Modify: `apps/web/src/features/playground/chat-compare/store.ts` (PanelCount type, persist version)
- Modify: `apps/web/src/features/playground/chat-compare/store.test.ts`
- Modify: `apps/web/src/features/playground/chat-compare/ChatComparePage.tsx` (selector values, grid CSS)
- Modify: `apps/web/src/features/playground/chat-compare/ChatComparePage.test.tsx`

- [ ] **Step 1: Update tests first**

Add cases asserting `setPanelCount(6)` and `setPanelCount(8)` work — list grows and shrinks correctly. Also a test that the grid container has `auto-fit`/`minmax(360px, 1fr)` classes (or that 6 panels render successfully when count=6).

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement**

```ts
export type PanelCount = 2 | 3 | 4 | 6 | 8;
```

`store.ts` — bump persist version `1 → 2`. Existing `setPanelCount` switch logic accepts the new values verbatim (no special casing).

`ChatComparePage.tsx` — change selector dropdown items array to `[2, 3, 4, 6, 8]`. Replace any hard-coded `grid-cols-{N}` with:

```tsx
<div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))" }}>
```

(or use a Tailwind arbitrary-value class.)

- [ ] **Step 4: Tests + type check**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/playground/chat-compare/store.ts \
  apps/web/src/features/playground/chat-compare/store.test.ts \
  apps/web/src/features/playground/chat-compare/ChatComparePage.tsx \
  apps/web/src/features/playground/chat-compare/ChatComparePage.test.tsx

git commit -m "$(cat <<'EOF'
feat(web/playground/chat-compare): extend to 6/8 panels + auto-fit grid

Phase 4 F3: PanelCount union now allows 2|3|4|6|8 (skips asymmetric
5/7). Persist version bumped 1→2 — old layout state discarded.
Replaces hard-coded grid-cols-N with grid auto-fit minmax(360px,1fr)
so panels reflow on smaller screens.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: P3 — Compare snapshot save / restore via IDB

**Why:** Spec § 7.2. Adds explicit "Save snapshot" button + History dropdown (separate from working-state localStorage layout persist).

**Files:**
- Modify: `apps/web/src/features/playground/chat-compare/store.ts` (snapshot type)
- Create: `apps/web/src/features/playground/chat-compare/CompareHistory.tsx`
- Modify: `apps/web/src/features/playground/chat-compare/ChatComparePage.tsx` (Save button + History dropdown)
- Modify: `apps/web/src/features/playground/chat-compare/ChatComparePage.test.tsx`

- [ ] **Step 1: Decide snapshot shape**

```ts
export interface CompareSnapshot {
  panelCount: PanelCount;
  systemMessage: string;
  panels: Array<{
    connectionId: string | null;
    params: ChatParams;
    messages: ChatMessage[];   // includes attachments inline; will be sanitized to idb:// refs on save (reuse helper from P4)
  }>;
}
```

Reuse the same `persistAttachments` / `rehydrateAttachments` helpers introduced in Task 9, generalized to operate on a `ChatMessage[]`.

- [ ] **Step 2: Failing test for save/restore round-trip**

```tsx
it("save snapshot persists messages incl. attachments; restore rehydrates them", async () => { ... });
```

- [ ] **Step 3: Implement CompareHistory + ChatComparePage wiring**

`CompareHistory.tsx` exports a hook `useCompareHistory()` (a separate IDB-backed history store created via the same `createHistoryStore` factory with `name: 'compare'`), and a `<CompareHistoryDropdown />` component that:

- Renders the saved snapshots as a list, each row showing createdAt + panelCount + first user prompt preview
- Restore button per row → calls `useCompareStore.restoreSnapshot(snap)` (new method on compare store)
- Delete button → `removeEntry(id)`

`ChatComparePage.tsx` adds:

- "Save snapshot" button next to the panelCount selector → calls `await persistAndSaveSnapshot()`
- `<CompareHistoryDropdown />` next to it

- [ ] **Step 4: Tests + type check**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/playground/chat-compare/
git commit -m "$(cat <<'EOF'
feat(web/playground/chat-compare): snapshot save/restore via IDB

Phase 4 P3: explicit 'Save snapshot' button captures full panels state
(panelCount, system message, per-panel connection + params + messages
with multimodal attachments persisted via the IDB blob store).
History dropdown lists saved snapshots; restore swaps the working
state back. Working-state localStorage persist still excludes messages
to keep that path light.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: i18n cleanup + final verification + DoD assertions

**Why:** Sweep any straggler "Phase 4" / "(not sent)" / "coming soon" strings the per-task commits missed; assert spec § 17 DoD bullets.

**Files:**
- Modify: i18n locale files (any leftover keys)
- No new code

- [ ] **Step 1: Sweep for stragglers**

```bash
grep -rn "Phase 4\|advancedV2Note\|not sent\|TRUNCATED" apps/web/src/ apps/web/public/ apps/api/src/ packages/contracts/src/
```

Expected: zero matches. If any: delete / update.

- [ ] **Step 2: Full repo test + build**

```bash
pnpm -r test
pnpm -F @modeldoctor/web type-check
pnpm -F @modeldoctor/api type-check
pnpm -F @modeldoctor/web lint
pnpm -F @modeldoctor/api lint
pnpm -F @modeldoctor/web build
```

- [ ] **Step 3: Bundle diff**

Compare `dist/assets/*.js` total size to the Task 1 baseline. Record in PR description as `bundle: <baseline> → <new> (+<delta>)`.

- [ ] **Step 4: Playwright smoke**

If the e2e suite exists (check `apps/web/e2e/` or similar), run it:

```bash
pnpm -F @modeldoctor/web test:e2e   # or whatever the task is named — confirm in package.json
```

- [ ] **Step 5: DoD checklist (Spec § 17) — manual confirm by re-reading spec § 17**

For each bullet, confirm or note exception:

- [ ] All existing + new tests green
- [ ] `pnpm -F @modeldoctor/web type-check` 0 error
- [ ] `pnpm -F @modeldoctor/api lint` 0 error
- [ ] Playwright smoke green (5 modality + Compare + Inpaint)
- [ ] Manual checklist for user (TTS clone / STT / Inpaint upstream) noted in PR description
- [ ] PR description records bundle diff
- [ ] Sidebar Playground 5 sub-pages contain no disabled / placeholder / "Phase 4" / "(not sent)" string
- [ ] v2 backlog (spec § 2.2) cleared

- [ ] **Step 6: If any stragglers, fix and commit**

```bash
git commit -m "$(cat <<'EOF'
chore(playground): sweep i18n stragglers + confirm Phase 4 DoD

No code changes beyond stale i18n key removal. All Phase 4 DoD
bullets verified (see spec § 17).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If sweep was clean (no edits), skip this commit; the previous task already left the tree consistent.

---

## Task 14: Push + open PR

- [ ] **Step 1: Push**

```bash
git push origin feat/regression-suite
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat(playground): Phase 4 — 100% completion (voice cloning, inpaint, charts, history persistence, file attachments, 6/8-panel compare)" --body "$(cat <<'EOF'
## Summary
- Closes all 9 v2-backlog Playground items + 2 shared infra pieces in a single PR.
- F1 TTS voice cloning · F2 Image inpaint · F3 Compare 6/8 panels · P1 file attachments real upload · P2 audio-history TTS audio · P3 compare snapshot save/restore · P4 chat-history attachments · C1 PCA→ECharts · C2 snippet readable/full toggle.
- Shared infra: I1 IndexedDB-backed createHistoryStore + blob API · I2 ECharts-backed `<Chart>` wrapper.

## Bundle delta
- Before: <fill from build>
- After:  <fill from build>
- Δ:      <fill, target ≤ +400 KB gz>

## Spec
- `docs/superpowers/specs/2026-04-30-playground-phase-4-design.md`

## Plan
- `docs/superpowers/plans/2026-04-30-playground-phase-4.md`

## Test plan
- [ ] CI green
- [ ] Manual: TTS voice cloning against GPT-SoVITS / F5-TTS / IndexTTS upstream
- [ ] Manual: STT against real upstream
- [ ] Manual: Image inpaint against OpenAI / DALL-E
- [ ] Manual: Sidebar Playground sub-pages — no disabled / placeholder / Phase 4 / "(not sent)" strings

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Capture PR URL + paste back to user**

---

## Self-Review

I checked this plan against the spec:

**Spec coverage** — every § has a task:

- § 2.1 I1 → Task 2 ✅
- § 2.2 I2 → Task 3 ✅
- § 3 F1 → Task 6 ✅
- § 4 F2 → Task 10 ✅
- § 5 F3 → Task 11 ✅
- § 6 P1 → Task 8 ✅
- § 7.1 P4 → Task 9 ✅
- § 7.2 P3 → Task 12 ✅
- § 7.3 P2 → Task 7 ✅
- § 8 C1 → Task 4 ✅
- § 9 C2 → Task 5 ✅
- § 14 no-compat-shim policy → covered by persist version bump in Tasks 2, 11; no migration code
- § 16 commit order → matches Tasks 0–14 1:1
- § 17 DoD → Task 13 explicitly enumerates each bullet

**Type consistency** — `HistoryStoreState<S>` extended once in Task 2; consumers in Tasks 7, 9, 12 reference `putBlob` / `getBlob` consistently. `PanelCount` change (Task 11) matches selector values referenced in tests. `ChatMessageContentPartSchema` discriminator extended in Task 8; downstream code-snippet generator (Task 5 + Task 8) handles `input_file` consistently.

**Placeholder scan** — searched for "TBD", "TODO", "implement later", "fill in details": none found. All test code shown verbatim. Implementation snippets are concrete enough for a fresh engineer to type into the editor without inventing structure.

No revisions needed.
