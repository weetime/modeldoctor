# Compare 顺序 + 任务颜色 + DELETE 确认 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compare 页可拖拽排序(默认按 name 自然排序),同一任务在四张图中颜色一致;全站删除确认统一升级为「输入 DELETE」。

**Architecture:** 顺序唯一来源 = URL `?ids=`;颜色映射 = `assignRunColors(orderedIds, palette)` 四图共享;百分位图转置为「X=p50/p90/p99,系列=任务」。删除确认抽成 `ConfirmDeleteDialog` 共享组件替换全站 12+ 处。

**Tech Stack:** React 18 + TS, echarts(StageBarChart), @dnd-kit/core + @dnd-kit/sortable(已安装), shadcn AlertDialog, vitest + RTL。

**Worktree:** `/Users/fangyong/vllm/modeldoctor/feature-compare-order`,分支 `feat/compare-order-delete-confirm`。依赖已装、`pnpm -r build` 已跑。

规范:conventional commits;commit body 以 `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` 结尾(CLAUDE.md);显式 `git add <files>`。

---

### Task 1: 列表页「对比」按 name 自然排序

**Files:**
- Modify: `apps/web/src/features/benchmarks/BenchmarkListShell.tsx:236`

- [ ] **Step 1**: 把 `navigate(...)` 处改为:

```tsx
onClick={() => {
  if (compareDisabledReason !== null) return;
  // Stable, human-meaningful default order: natural-sort by name so
  // "L1 < L2 < L3" and "c20 < c40 < c160" — Set insertion (click) order
  // is what the user sees as "random".
  const sortedIds = [...selected].sort((a, b) => {
    const na = items.find((r) => r.id === a)?.name ?? a;
    const nb = items.find((r) => r.id === b)?.name ?? b;
    return na.localeCompare(nb, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
  });
  navigate(`/benchmarks/compare?ids=${sortedIds.join(",")}`);
}}
```

- [ ] **Step 2**: `pnpm -F @modeldoctor/web type-check && pnpm -F @modeldoctor/web test -- --run src/features/benchmarks` 全绿
- [ ] **Step 3**: `git add` + commit `feat(web): natural-sort benchmark ids when entering compare`

### Task 2: StageBarChart 支持 per-bar 颜色 + 系列型 baseline

**Files:**
- Modify: `apps/web/src/components/charts/StageBarChart.tsx`
- Test: `apps/web/src/components/charts/StageBarChart.test.tsx`

- [ ] **Step 1**: props 增加:

```ts
/** Per-datum bar colors (index-aligned with `data`). Only meaningful for
 * single-series charts (QPS / error-rate) where each bar IS a run. */
barColors?: readonly (string | undefined)[];
/** Series-key of the baseline run for run-pivoted charts (series = runs,
 * x = percentile). Mutually exclusive with `baselineIndex`. Non-baseline
 * series annotate ↑/↓ % vs the baseline series at the same x category. */
baselineSeriesKey?: string;
```

- [ ] **Step 2**: 实现。`ecSeries` map 内:
  - data:`series.length === 1 && barColors` 时 `values.map((v, i) => ({ value: v, itemStyle: barColors[i] ? { color: barColors[i] } : undefined }))`(label formatter 的 `p.value` 不受影响,ECharts 仍传原始值;注意 `markLine` 读 `values[baselineIndex]` 逻辑保留)。
  - baseline 增量:提炼 `labelFor` 为同时支持两种 baseline 模式:

```ts
const baselineSeries =
  baselineSeriesKey != null ? series.find((x) => x.key === baselineSeriesKey) : undefined;
const baselineValues = baselineSeries
  ? data.map((d) => (typeof d[baselineSeries.key] === "number" ? (d[baselineSeries.key] as number) : null))
  : null;
// labelFor(idx, value) 内:
// - baselineIndex 模式:现状不变
// - baselineSeriesKey 模式:s.key === baselineSeriesKey → `{base|baseline}` 后缀;
//   否则 baseVal = baselineValues[idx],按现有 deltaPct 公式出 ↑/↓
```

  - `markLine` 仅在 `baselineIndex` 模式保留(系列模式无意义)。
  - useMemo 依赖数组补 `barColors`、`baselineSeriesKey`。
- [ ] **Step 3**: 测试(追加到现有 describe):

```tsx
it("applies per-bar colors for single-series charts", () => { /* render + getOption 断言 data[i].itemStyle.color */ });
it("annotates delta vs baseline series in pivoted mode", () => { /* baselineSeriesKey 下 label formatter 输出含 {base|baseline} / ↑ */ });
```

  （参照该文件现有测试取 option 的方式;若现有测试只做 smoke render,则用 `echarts-for-react` mock 暴露 option 的同款手法。）
- [ ] **Step 4**: `pnpm -F @modeldoctor/web test -- --run src/components/charts/StageBarChart.test.tsx` 全绿
- [ ] **Step 5**: commit `feat(web): per-bar colors + series-baseline mode in StageBarChart`

### Task 3: StageBarChartsSection 共享色 + 百分位图转置

**Files:**
- Modify: `apps/web/src/features/benchmarks/compare/StageBarChartsSection.tsx`
- Test: `apps/web/src/features/benchmarks/compare/StageBarChartsSection.test.tsx`

- [ ] **Step 1**: 重写数据装配:

```tsx
import { assignRunColors, useChartTokens } from "@/components/charts/_shared";

const tokens = useChartTokens();
const colorMap = useMemo(
  () => assignRunColors(runs.map((r) => r.id), tokens.palette),
  [runs, tokens],
);

// QPS / Error:保持 x=任务,每根柱子用任务色
const barColors = summaries.map(({ r }) => colorMap[r.id]);
// series color 传调色板第一色仅作 legend 兜底,实际由 barColors 覆盖

// TTFT / e2e:转置 — x=percentile,series=任务
const PCTS = ["p50", "p90", "p99"] as const;
const ttftRuns = summaries.filter(({ s }) => s.ttft);
const ttftData: StageBarDatum[] = PCTS.map((p) => ({
  stage: p,
  ...Object.fromEntries(ttftRuns.map(({ r, s }) => [r.id, s.ttft?.[p] ?? 0])),
}));
const ttftSeries = ttftRuns.map(({ r }) => ({
  key: r.id, label: r.stageLabel, color: colorMap[r.id],
}));
// e2e 同构
```

  QPS 图传 `series={[{ key: "qps", label: "QPS", color: tokens.palette[0] }]} barColors={barColors}`;Error 图同理。TTFT/e2e 传转置后的 data/series。
- [ ] **Step 2**: 更新测试:断言 TTFT 面板图例含任务名(`A`/`B`)、QPS 面板仍渲染;沿用现有 i18n + RTL 模式。
- [ ] **Step 3**: `pnpm -F @modeldoctor/web test -- --run src/features/benchmarks/compare` 全绿
- [ ] **Step 4**: commit `feat(web): consistent per-run colors across compare charts (pivot percentile charts)`

### Task 4: FigureRenderer(AI 报告图)同步

**Files:**
- Modify: `apps/web/src/features/benchmarks/compare/FigureRenderer.tsx`

- [ ] **Step 1**: 定义固定浅色调色板(报告纸面恒浅色,不随主题):

```ts
/** Fixed light palette for the always-light report paper — mirrors
 * FALLBACK_CHART_TOKENS.palette (theme.ts) so report figures match the
 * in-app light theme. */
const REPORT_PALETTE = [
  "hsl(98, 38%, 46%)", "hsl(43, 81%, 47%)", "hsl(190, 65%, 50%)",
  "hsl(22, 85%, 48%)", "hsl(4, 75%, 47%)", "hsl(208, 73%, 44%)",
  "hsl(308, 47%, 45%)", "hsl(260, 28%, 42%)",
] as const;
const colorMap = assignRunColors(summaries.map(({ r }) => r.id), REPORT_PALETTE);
```

- [ ] **Step 2**: `stage-bars-throughput` / `stage-bars-error-rate`:保持 x=stage + `baselineIndex`,加 `barColors={summaries.map(({ r }) => colorMap[r.id])}`。
- [ ] **Step 3**: `stage-bars-ttft-p95` / `stage-bars-e2e-p95`:转置(同 Task 3 结构),series=runs(`higherIsBetter: false, decimals: 0`),baseline 用 `baselineSeriesKey={baselineId 在 rows 中存在 ? baselineId : rows[0].r.id}`(沿用 `baselineIndexOf` 的回退语义,改写为返回 run id 的 `baselineKeyOf(rows, baselineId)`)。
- [ ] **Step 4**: `pnpm -F @modeldoctor/web test -- --run src/features/benchmarks/compare && pnpm -F @modeldoctor/web type-check`
- [ ] **Step 5**: commit `feat(web): per-run colors + pivoted percentile figures in AI report`

### Task 5: Test matrix 拖拽排序 → 写回 URL

**Files:**
- Modify: `apps/web/src/features/benchmarks/compare/ReportSections.tsx`
- Modify: `apps/web/src/features/benchmarks/compare/BenchmarkComparePage.tsx`
- Modify: `apps/web/src/locales/{zh-CN,en-US}/benchmarks.json`
- Test: `apps/web/src/features/benchmarks/compare/__tests__/BenchmarkComparePage.test.tsx`

- [ ] **Step 1**: `ReportSections` 加可选 prop `onReorder?: (orderedIds: string[]) => void`。提供时:
  - Test matrix 行最左加表头空列 + 每行 `GripVertical` 手柄(`aria-label={t("compare.dragHandle")}`,新 i18n key `compare.dragHandle`: zh "拖拽调整顺序" / en "Drag to reorder")。
  - 用 `DndContext`(`closestCenter`,`PointerSensor` + `KeyboardSensor`)+ `SortableContext(items=runs.map(r=>r.id), verticalListSortingStrategy)`;行组件抽 `SortableMatrixRow`(`useSortable({ id })`,transform/transition 套用到 `<tr>`,手柄绑 `{...attributes} {...listeners}`)。
  - `onDragEnd`:`active.id !== over?.id` 时 `arrayMove` 后回调 `onReorder(newIds)`。
- [ ] **Step 2**: `BenchmarkComparePage` 传入:

```tsx
onReorder={(newIds) => {
  const sp = new URLSearchParams(searchParams);
  sp.set("ids", newIds.join(","));
  setSearchParams(sp, { replace: true });
}}
```

  注意:`reportRuns`/`successfulBenchmarks` 顺序源自 `ids`→`useQueries`,URL 一变全页跟随,无需本地 state。
- [ ] **Step 3**: 测试:BenchmarkComparePage.test 增加「matrix 行渲染拖拽手柄」断言;jsdom 不做真实 DnD,补一个 ReportSections 单测直接调 `onDragEnd` 回调验证 `onReorder` 收到 `arrayMove` 结果(导出 onDragEnd 处理或通过 fireEvent.keyDown 空格+方向键走 KeyboardSensor——取实现成本低者)。
- [ ] **Step 4**: `pnpm -F @modeldoctor/web test -- --run src/features/benchmarks/compare` 全绿
- [ ] **Step 5**: commit `feat(web): drag-to-reorder compare runs, order persisted in url ids`

### Task 6: ConfirmDeleteDialog 共享组件

**Files:**
- Create: `apps/web/src/components/common/confirm-delete-dialog.tsx`
- Create: `apps/web/src/components/common/confirm-delete-dialog.test.tsx`
- Modify: `apps/web/src/locales/{zh-CN,en-US}/common.json`

- [ ] **Step 1**: i18n,`common.json` 增加(zh):

```json
"deleteConfirm": {
  "hint": "此操作不可撤销。请输入 {{keyword}} 以确认。",
  "keyword": "DELETE",
  "placeholder": "DELETE"
}
```

  en:`"hint": "This action cannot be undone. Type {{keyword}} to confirm."`,其余同。
- [ ] **Step 2**: 组件(完整实现):

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  /** Destructive action label; defaults to common actions.delete. */
  confirmLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
}

const KEYWORD = "DELETE";

/** Type-to-confirm destructive dialog. The confirm button stays disabled
 * until the user types DELETE (case-insensitive, trimmed) — uniform lock
 * for every delete across the app. Uses a plain Button instead of
 * AlertDialogAction so the dialog does NOT auto-close on click; the caller
 * closes it (or unmounts) when the mutation settles. */
export function ConfirmDeleteDialog({
  open, onOpenChange, title, description, confirmLabel, pending = false, onConfirm,
}: ConfirmDeleteDialogProps) {
  const { t } = useTranslation("common");
  const [text, setText] = useState("");
  useEffect(() => {
    if (!open) setText("");
  }, [open]);
  const armed = text.trim().toUpperCase() === KEYWORD;
  return (
    <AlertDialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {t("deleteConfirm.hint", { keyword: KEYWORD })}
          </p>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("deleteConfirm.placeholder")}
            autoComplete="off"
            spellCheck={false}
            aria-label={t("deleteConfirm.placeholder")}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("actions.cancel")}</AlertDialogCancel>
          <Button variant="destructive" disabled={!armed || pending} onClick={onConfirm}>
            {confirmLabel ?? t("actions.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 3**: 测试:确认键初始 disabled;输入 `delete `(小写带空格)后 enabled;点击触发 `onConfirm` 且不自动关闭;重开后输入清空;`pending` 时取消/确认禁用。
- [ ] **Step 4**: `pnpm -F @modeldoctor/web test -- --run src/components/common/confirm-delete-dialog.test.tsx` 全绿
- [ ] **Step 5**: commit `feat(web): shared type-DELETE confirm dialog`

### Task 7-9: 全站替换(机械变换,三批提交)

每处的统一变换:删掉 `AlertDialog*` 删除确认 JSX → `<ConfirmDeleteDialog open=… onOpenChange=… title={原 title} description={原 body} confirmLabel={原确认文案} pending={mutation.isPending} onConfirm={原 action 逻辑 + 成功后关窗}/>`。标题/正文 i18n key 全部沿用现状;不再需要的 `AlertDialog*` import 清理。**onConfirm 内不再无条件关窗——成功回调里关**(原先多处 `mutate(...); setPending(null)` 立即关,保留原行为亦可接受:与现状等价时按原样关窗,有 onSuccess 回调的按回调关)。

**Task 7(benchmarks 域):**
- `BenchmarkListShell.tsx:471`(state `pendingDeleteId`,`deleteBenchmark.mutate`,keys `detail.delete.confirmTitle/confirmBody/confirmAction`)
- `BenchmarkDetailPage.tsx:541`(`deleteOpen`,同上 keys;**不动** unset-baseline 与 cancel 两个 AlertDialog)
- `benchmark-templates/DeleteTemplateDialog.tsx`(整个内部实现换成 ConfirmDeleteDialog,对外 props 不变;keys `edit.deleteConfirm.*`)
- [ ] 改完跑 `pnpm -F @modeldoctor/web test -- --run src/features/benchmarks src/features/benchmark-templates`,修受影响测试(确认流程加「输入 DELETE」步骤:`fireEvent.change(screen.getByPlaceholderText("DELETE"), { target: { value: "DELETE" } })`)
- [ ] commit `feat(web): type-DELETE confirm for benchmark/template deletes`

**Task 8(compare/connections/datasources 域):**
- `compare/SavedComparesListPage.tsx:179`(`pendingDeleteId`,`del.mutate`,keys `savedCompare.detail.deleteTitle/deleteBody`)
- `compare/ReportDetailPage.tsx:188`(uncontrolled AlertDialog + Trigger → 受控:新 state `deleteOpen`,Button onClick 打开;`onDelete`、`del.isPending`)
- `connections/ConnectionsPage.tsx:275`(`pendingDelete`,`deleteMut.mutate`,keys `delete.title/body/confirm`)
- `prometheus-datasources/DatasourcesPage.tsx:218`(同 Connections 模式)
- [ ] 跑对应目录测试并修(SavedComparesListPage.test、DatasourcesPage.test 等)
- [ ] commit `feat(web): type-DELETE confirm for compare/connection/datasource deletes`

**Task 9(quality-gate / me / settings / playground 历史):**
- `quality-gate/EvaluationsListPage.tsx:167`、`RunsListPage.tsx:203`(keys `detail.delete.*`)
- `me/MeNotificationsPage.tsx:124`(`toDelete`,`del.mutateAsync`)
- `settings/SettingsPage.tsx:168`(clearTestData)与 `:183`(resetState)——两处都是数据清除语义,统一加锁;确认文案沿用 `data.clearTestDataConfirm` / `data.resetConfirm`
- `playground/history/HistoryDrawer.tsx`:行内删除按钮现状**无确认**直接 `removeEntry(e.id)` → 新 state `pendingDeleteId`,按钮只 set;Drawer 外层挂一个 ConfirmDeleteDialog(title 用现有 `history.delete`,description 用条目 preview);**不动**恢复确认
- [ ] 跑 `pnpm -F @modeldoctor/web test -- --run src/features/quality-gate src/features/me src/features/settings src/features/playground` 并修
- [ ] commit `feat(web): type-DELETE confirm for quality-gate/channel/settings/history deletes`

### Task 10: 全量验证 + PR

- [ ] `pnpm -F @modeldoctor/web lint && pnpm -F @modeldoctor/web type-check && pnpm -F @modeldoctor/web test -- --run`(一次性模式,跑完即退,不留 watch 进程)
- [ ] `pnpm dev` 起一次(单实例),Playwright MCP 走查:列表勾选→对比(顺序按 name)→拖拽→颜色跨图一致→保存对比顺序保留;随机抽两处删除验证 DELETE 锁。完成后杀掉 dev 进程
- [ ] commit 文档(spec + plan)、`git push -u origin feat/compare-order-delete-confirm`、`gh pr create`(正文 `addresses` 相关 issue 如有);按 CLAUDE.md 跟进 CI + review 信号

## Self-review 记录

- spec 三块(排序/颜色/删除锁)均有对应 Task(1+5 / 2-4 / 6-9)✓
- 占位符:Task 2 Step 3 与 Task 5 Step 3 的测试写法给了两种实现路径由执行者择一——其余无 TBD ✓
- 类型一致:`barColors`/`baselineSeriesKey`/`onReorder`/`ConfirmDeleteDialogProps` 各任务引用一致 ✓
