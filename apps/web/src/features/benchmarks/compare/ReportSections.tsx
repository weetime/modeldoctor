import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { CompareGrid } from "./CompareGrid";
import { readPrefixCache } from "./client-metrics";
import { formatPct } from "./format";
import { StageBarChartsSection, type StageRun } from "./StageBarChartsSection";

/**
 * The slice of a benchmark the report actually reads off `ReportRun.benchmark`
 * (verified consumer set via grep of `r.benchmark.*` across `compare/*.tsx`:
 * `name` + `tool` here, plus id / name / tool / summaryMetrics that `CompareGrid`
 * reads off the runs it's handed).
 *
 * Spelled out explicitly rather than `Pick<Benchmark, …>` on purpose: the two
 * producers feed values *looser* than `Benchmark`'s — `BenchmarkComparePage`
 * passes a full `Benchmark` (assignable here), but `toReportRuns()` synthesises
 * this from `HydratedBenchmarkRef`, whose `name` is nullable and whose `tool` /
 * `summaryMetrics` / `serverMetrics` are `string` / `unknown` rather than
 * `Benchmark`'s enum + `Record`. A `Pick<Benchmark>` would reject those without a
 * cast on every field — exactly the `as Benchmark` we're removing here. (These
 * field types match `StageRun.summaryMetrics: unknown` already used in this path.)
 *
 * Dropping the blanket `as Benchmark` cast in `toReportRuns()` is the point: that
 * cast silenced every missing-field error and let `serverMetrics` ship absent
 * (#302). A figure that now reaches for a field outside this set fails to compile
 * instead of silently reading `undefined`.
 */
export interface ReportBenchmarkSnapshot {
  id: string;
  name: string | null;
  tool: string;
  scenario: string;
  summaryMetrics: unknown;
  serverMetrics: unknown;
  latencyCdf?: { samples: number[] } | null;
}

export interface ReportRun extends StageRun {
  /** Benchmark snapshot (see `ReportBenchmarkSnapshot`), or null if the
   *  underlying benchmark was deleted. */
  benchmark: ReportBenchmarkSnapshot | null;
  paramsSummary: { concurrency?: number };
}

export interface ReportSectionsProps {
  runs: ReportRun[];
  baselineId: string | null;
  /**
   * When provided, Test-matrix rows become drag-sortable and the new full id
   * order is reported here after a drop. The caller owns the order (URL ids);
   * this component never keeps a local copy.
   */
  onReorder?: (orderedIds: string[]) => void;
  /**
   * When provided, each Test-matrix row gets a remove button. Disabled once
   * only two runs remain (a comparison needs ≥2). The caller drops the id from
   * the URL ids.
   */
  onRemove?: (id: string) => void;
  /** Rendered at the top-right of the Test-matrix section (e.g. an Add button). */
  matrixActions?: ReactNode;
}

// Static sensor options hoisted to module scope: dnd-kit's `useSensor` depends
// on the options object by reference, so inline literals would recreate the
// sensors on every render (disruptive across the URL-driven re-render a drop
// triggers). These never change, so a shared reference is correct.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 4 } };
const KEYBOARD_SENSOR_OPTIONS = { coordinateGetter: sortableKeyboardCoordinates };

function MatrixRowCells({
  r,
  t,
  showPrefixCache,
  onRemove,
  removeDisabled,
}: {
  r: ReportRun;
  t: (key: string) => string;
  showPrefixCache: boolean;
  onRemove?: (id: string) => void;
  removeDisabled?: boolean;
}) {
  const pc = showPrefixCache ? readPrefixCache(r.serverMetrics) : null;
  return (
    <>
      <td className="px-3 py-2 font-medium">{r.stageLabel}</td>
      <td className="px-3 py-2">
        {r.benchmark === null ? (
          <span className="opacity-60">{t("savedCompare.detail.missingBenchmark")}</span>
        ) : (
          <Link to={`/benchmarks/${r.id}`} className="hover:text-primary hover:underline">
            {r.benchmark.name}
          </Link>
        )}
      </td>
      <td className="px-3 py-2">{r.benchmark?.tool ?? "—"}</td>
      <td className="px-3 py-2">{r.scenario}</td>
      <td className="px-3 py-2">{r.paramsSummary.concurrency ?? "—"}</td>
      {showPrefixCache ? (
        <>
          <td className="px-3 py-2 text-right tabular-nums">{formatPct(pc?.hitRatePct ?? null)}</td>
          <td className="px-3 py-2 text-right tabular-nums">
            {formatPct(pc?.topPodSharePct ?? null)}
          </td>
        </>
      ) : null}
      {onRemove ? (
        <td className="w-8 px-2 py-2 text-right">
          <button
            type="button"
            aria-label={t("compare.matrix.remove")}
            title={removeDisabled ? t("compare.matrix.removeDisabled") : t("compare.matrix.remove")}
            disabled={removeDisabled}
            onClick={() => onRemove(r.id)}
            className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </td>
      ) : null}
    </>
  );
}

/** Sortable Test-matrix row: drag is initiated from the grip handle only, so
 * text in the other cells stays selectable. */
function SortableMatrixRow({
  r,
  t,
  handleLabel,
  showPrefixCache,
  onRemove,
  removeDisabled,
}: {
  r: ReportRun;
  t: (key: string) => string;
  handleLabel: string;
  showPrefixCache: boolean;
  onRemove?: (id: string) => void;
  removeDisabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: r.id,
  });
  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`border-border border-t ${isDragging ? "relative z-10 bg-muted/40" : ""}`}
    >
      <td className="w-8 px-2 py-2">
        <button
          type="button"
          aria-label={handleLabel}
          className="cursor-grab rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </td>
      <MatrixRowCells
        r={r}
        t={t}
        showPrefixCache={showPrefixCache}
        onRemove={onRemove}
        removeDisabled={removeDisabled}
      />
    </tr>
  );
}

/**
 * Pre-narrative "raw matrix" preview. Renders the per-run table + the metric
 * grid + the four bar charts. Used by:
 *   - BenchmarkComparePage (ad-hoc compare, no narrative)
 *
 * The narrative deep report (Hero + summary cards + 6 sections + figures)
 * is rendered by `<SavedCompareReport>`, not here.
 *
 * `data-report-root` is exposed for the export-as-HTML utility.
 */
export function ReportSections({
  runs,
  baselineId,
  onReorder,
  onRemove,
  matrixActions,
}: ReportSectionsProps) {
  const { t } = useTranslation("benchmarks");
  // Type-guard predicate (not just `!== null`) so `r.benchmark` narrows to
  // non-null below — lets `CompareGrid` receive `ReportBenchmarkSnapshot[]`
  // without an `as` cast.
  const livingRuns = runs.filter(
    (r): r is ReportRun & { benchmark: ReportBenchmarkSnapshot } => r.benchmark !== null,
  );
  // lb-strategy matrix gains Hit Rate / Top Pod Share columns, but only when
  // every living run carries the prefix-cache annotation (matches the chart
  // gate — partial data would render misleading blanks).
  const showPrefixCache =
    runs[0]?.scenario === "lb-strategy" &&
    livingRuns.length > 0 &&
    livingRuns.every((r) => readPrefixCache(r.serverMetrics) !== null);
  const sortable = onReorder !== undefined;
  // A comparison needs ≥2 runs; block removing the second-to-last.
  const removeDisabled = runs.length <= 2;
  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_SENSOR_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!onReorder || over === null || active.id === over.id) return;
    const ids = runs.map((r) => r.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    onReorder(next);
  }

  const matrixTable = (
    <table className="w-full text-sm">
      <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
        <tr>
          {sortable ? <th className="w-8 px-2 py-2" aria-hidden /> : null}
          <th className="px-3 py-2">{t("compare.matrixCol.label")}</th>
          <th className="px-3 py-2">{t("compare.matrixCol.name")}</th>
          <th className="px-3 py-2">{t("compare.matrixCol.tool")}</th>
          <th className="px-3 py-2">{t("compare.matrixCol.scenario")}</th>
          <th className="px-3 py-2">{t("compare.matrixCol.concurrency")}</th>
          {showPrefixCache ? (
            <>
              <th className="px-3 py-2 text-right">{t("compare.matrixCol.hitRate")}</th>
              <th className="px-3 py-2 text-right">{t("compare.matrixCol.topPodShare")}</th>
            </>
          ) : null}
          {onRemove ? <th className="w-8 px-2 py-2" aria-hidden /> : null}
        </tr>
      </thead>
      <tbody>
        {sortable
          ? runs.map((r) => (
              <SortableMatrixRow
                key={r.id}
                r={r}
                t={t}
                handleLabel={t("compare.dragHandle")}
                showPrefixCache={showPrefixCache}
                onRemove={onRemove}
                removeDisabled={removeDisabled}
              />
            ))
          : runs.map((r) => (
              <tr key={r.id} className="border-border border-t">
                <MatrixRowCells
                  r={r}
                  t={t}
                  showPrefixCache={showPrefixCache}
                  onRemove={onRemove}
                  removeDisabled={removeDisabled}
                />
              </tr>
            ))}
      </tbody>
    </table>
  );

  return (
    <div data-report-root className="space-y-8">
      {/* 1. Test matrix */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{t("savedCompare.report.sectionMatrix")}</h2>
          {matrixActions}
        </div>
        <div className="overflow-x-auto rounded-md border border-border">
          {sortable ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={runs.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                {matrixTable}
              </SortableContext>
            </DndContext>
          ) : (
            matrixTable
          )}
        </div>
      </section>

      {/* 2. CompareGrid */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("savedCompare.report.sectionGrid")}</h2>
        <CompareGrid
          runs={livingRuns.map((r) => r.benchmark)}
          baselineId={baselineId}
          labels={Object.fromEntries(livingRuns.map((r) => [r.id, r.stageLabel]))}
        />
      </section>

      {/* 3. Charts */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("savedCompare.report.sectionCharts")}</h2>
        <StageBarChartsSection runs={livingRuns} />
      </section>
      {/* The former "Test environment" section was dropped: it merely restated
          the Test-matrix rows. The matrix `name` column now links to each run's
          benchmark detail page, which carries the full environment context. */}
    </div>
  );
}
