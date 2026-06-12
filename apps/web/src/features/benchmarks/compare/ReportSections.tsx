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
import type { Benchmark, CompareNarrative } from "@modeldoctor/contracts";
import { GripVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CompareGrid } from "./CompareGrid";
import { StageBarChartsSection, type StageRun } from "./StageBarChartsSection";

export interface ReportRun extends StageRun {
  /** Full benchmark snapshot, or null if the underlying benchmark was deleted. */
  benchmark: Benchmark | null;
  paramsSummary: { workload?: string; concurrency?: number; duration?: number };
  scenario: string;
}

export interface ReportSectionsProps {
  runs: ReportRun[];
  baselineId: string | null;
  /** Kept for backward compatibility with BenchmarkComparePage callers — narrative
   *  rendering itself now lives in `<SavedCompareReport>`. */
  narrative: CompareNarrative | null;
  context: string | null;
  /** Pre-derived per-run "connection / model / tool / version" lines. */
  environmentLines: string[];
  /**
   * When provided, Test-matrix rows become drag-sortable and the new full id
   * order is reported here after a drop. The caller owns the order (URL ids);
   * this component never keeps a local copy.
   */
  onReorder?: (orderedIds: string[]) => void;
}

// Static sensor options hoisted to module scope: dnd-kit's `useSensor` depends
// on the options object by reference, so inline literals would recreate the
// sensors on every render (disruptive across the URL-driven re-render a drop
// triggers). These never change, so a shared reference is correct.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 4 } };
const KEYBOARD_SENSOR_OPTIONS = { coordinateGetter: sortableKeyboardCoordinates };

function MatrixRowCells({ r, t }: { r: ReportRun; t: (key: string) => string }) {
  return (
    <>
      <td className="px-3 py-2 font-medium">{r.stageLabel}</td>
      <td className="px-3 py-2">
        {r.benchmark === null ? t("savedCompare.detail.missingBenchmark") : r.benchmark.name}
      </td>
      <td className="px-3 py-2">{r.benchmark?.tool ?? "—"}</td>
      <td className="px-3 py-2">{r.scenario}</td>
      <td className="px-3 py-2">{r.paramsSummary.workload ?? "—"}</td>
      <td className="px-3 py-2">{r.paramsSummary.concurrency ?? "—"}</td>
      <td className="px-3 py-2">{r.paramsSummary.duration ?? "—"}</td>
    </>
  );
}

/** Sortable Test-matrix row: drag is initiated from the grip handle only, so
 * text in the other cells stays selectable. */
function SortableMatrixRow({
  r,
  t,
  handleLabel,
}: {
  r: ReportRun;
  t: (key: string) => string;
  handleLabel: string;
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
      <MatrixRowCells r={r} t={t} />
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
  context,
  environmentLines,
  onReorder,
}: ReportSectionsProps) {
  const { t } = useTranslation("benchmarks");
  const livingRuns = runs.filter((r) => r.benchmark !== null);
  const sortable = onReorder !== undefined;
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
          <th className="px-3 py-2">stage</th>
          <th className="px-3 py-2">name</th>
          <th className="px-3 py-2">tool</th>
          <th className="px-3 py-2">scenario</th>
          <th className="px-3 py-2">workload</th>
          <th className="px-3 py-2">concurrency</th>
          <th className="px-3 py-2">duration</th>
        </tr>
      </thead>
      <tbody>
        {sortable
          ? runs.map((r) => (
              <SortableMatrixRow key={r.id} r={r} t={t} handleLabel={t("compare.dragHandle")} />
            ))
          : runs.map((r) => (
              <tr key={r.id} className="border-border border-t">
                <MatrixRowCells r={r} t={t} />
              </tr>
            ))}
      </tbody>
    </table>
  );

  return (
    <div data-report-root className="space-y-8">
      {/* 1. Test matrix */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("savedCompare.report.sectionMatrix")}</h2>
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
          runs={livingRuns.map((r) => r.benchmark) as Benchmark[]}
          baselineId={baselineId}
        />
      </section>

      {/* 3. Charts */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("savedCompare.report.sectionCharts")}</h2>
        <StageBarChartsSection runs={livingRuns} />
      </section>

      {/* 4. Test environment */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("savedCompare.report.sectionEnv")}</h2>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {environmentLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {context ? (
          <div className="mt-3 whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-3 text-sm">
            {context}
          </div>
        ) : null}
      </section>
    </div>
  );
}
