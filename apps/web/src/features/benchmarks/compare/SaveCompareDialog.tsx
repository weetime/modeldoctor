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
import type { Classification } from "@modeldoctor/contracts";
import { GripVertical } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateSavedCompare } from "./queries";

export interface SaveCompareDialogRun {
  id: string;
  name: string | null;
  tool: string;
  /** Pre-derived short label (Test-matrix `label` column). Seeds the editable
   *  per-run label input so the dialog mirrors the matrix and "rename" is just
   *  editing a pre-filled value. */
  label?: string;
}

export interface SaveCompareDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  runs: SaveCompareDialogRun[];
  baselineId: string | null;
  context: string;
  /** When true, navigate to the saved page with ?generate=1 so it auto-synthesizes. */
  generateAfterSave?: boolean;
}

// Static sensor options hoisted to module scope (see ReportSections.tsx): keeps
// dnd-kit sensors stable across re-renders so a drop doesn't recreate them.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 4 } };
const KEYBOARD_SENSOR_OPTIONS = { coordinateGetter: sortableKeyboardCoordinates };

/** One sortable row: grip handle + run name + editable label input. Drag is
 *  initiated from the handle only so the label text stays editable. */
function SortableLabelRow({
  run,
  value,
  onChange,
  handleLabel,
}: {
  run: SaveCompareDialogRun;
  value: string;
  onChange: (next: string) => void;
  handleLabel: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: run.id,
  });
  const name = run.name ?? run.id;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-sm ${
        isDragging ? "relative z-10 bg-muted/40" : ""
      }`}
    >
      <button
        type="button"
        aria-label={handleLabel}
        className="cursor-grab rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Label htmlFor={`label-${run.id}`} className="truncate text-sm font-normal">
        {name}
      </Label>
      <Input
        id={`label-${run.id}`}
        aria-label={name}
        className="w-32"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function SaveCompareDialog({
  open,
  onOpenChange,
  runs,
  baselineId,
  context,
  generateAfterSave = false,
}: SaveCompareDialogProps) {
  const { t } = useTranslation("benchmarks");
  const navigate = useNavigate();
  const create = useCreateSavedCompare();
  const [name, setName] = useState("");
  // Local run order — seeded from the incoming (Test-matrix) order each time the
  // dialog opens; in-dialog drag reorders this copy only and drives the saved
  // benchmarkIds order. It never writes back to the matrix / URL.
  const [order, setOrder] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [ctx, setCtx] = useState(context);
  const [classification, setClassification] = useState<Classification>("internal");
  const [clientName, setClientName] = useState("");
  // Sweep mode: render the report as metric-vs-concurrency line charts grouped
  // by engine (instead of per-run bars), and lift the run cap to 50.
  const [sweepMode, setSweepMode] = useState(false);

  // Re-seed order + labels from the latest matrix order/labels on the
  // closed→open transition only. The component stays mounted across open/close,
  // so a first-mount snapshot would go stale after a Test-matrix reorder/rename
  // — but keying an effect off `runs` would re-seed on every parent re-render
  // (the inline `.map()` hands us a fresh `runs` ref each render, e.g. a
  // background refetch), wiping the user's in-dialog drag/rename. Deriving from
  // an open-transition sentinel re-seeds exactly once per open.
  // Init to false (not `open`) so seeding fires on the first render that sees
  // `open=true`, whether the dialog mounts already-open or opens later.
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setOrder(runs.map((r) => r.id));
      setLabels(Object.fromEntries(runs.map((r) => [r.id, r.label ?? ""])));
      setCtx(context);
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_SENSOR_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    setOrder((prev) =>
      arrayMove(prev, prev.indexOf(String(active.id)), prev.indexOf(String(over.id))),
    );
  }

  const runById = new Map(runs.map((r) => [r.id, r]));
  const orderedRuns = order
    .map((id) => runById.get(id))
    .filter((r): r is SaveCompareDialogRun => !!r);

  const allLabelled = orderedRuns.every((r) => labels[r.id]?.trim());
  const canSubmit = name.trim().length > 0 && allLabelled && !create.isPending;

  async function submit() {
    if (!canSubmit) return;
    const sc = await create.mutateAsync({
      name: name.trim(),
      benchmarkIds: orderedRuns.map((r) => r.id),
      stageLabels: Object.fromEntries(orderedRuns.map((r) => [r.id, (labels[r.id] ?? "").trim()])),
      baselineId: baselineId ?? undefined,
      context: ctx.trim() || undefined,
      classification,
      clientName: clientName.trim() || undefined,
      reportKind: sweepMode ? "sweep" : undefined,
      sweepAxis: sweepMode ? "parallel" : undefined,
    });
    onOpenChange(false);
    const suffix = generateAfterSave ? "?generate=1" : "";
    navigate(`/reports/${sc.id}${suffix}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("savedCompare.dialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="sc-name">{t("savedCompare.dialog.nameLabel")}</Label>
            <Input
              id="sc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("savedCompare.dialog.namePlaceholder")}
            />
          </div>
          <div>
            <div className="text-sm font-medium mb-1">
              {t("savedCompare.dialog.stageLabelsTitle")}
            </div>
            <div className="text-xs text-muted-foreground mb-2">
              {t("savedCompare.dialog.stageLabelsHint")}
            </div>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={order} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {orderedRuns.map((r) => (
                    <SortableLabelRow
                      key={r.id}
                      run={r}
                      value={labels[r.id] ?? ""}
                      onChange={(next) => setLabels((p) => ({ ...p, [r.id]: next }))}
                      handleLabel={t("compare.dragHandle")}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
          <div>
            <Label htmlFor="sc-ctx">{t("savedCompare.dialog.contextLabel")}</Label>
            <Textarea
              id="sc-ctx"
              rows={4}
              value={ctx}
              onChange={(e) => setCtx(e.target.value)}
              placeholder={t("savedCompare.dialog.contextPlaceholder")}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="sc-classification">
                {t("savedCompare.dialog.classificationLabel", { defaultValue: "Classification" })}
              </Label>
              <Select
                value={classification}
                onValueChange={(v) => setClassification(v as Classification)}
              >
                <SelectTrigger id="sc-classification">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal">
                    {t("savedCompare.classification.internal", { defaultValue: "Internal" })}
                  </SelectItem>
                  <SelectItem value="partner">
                    {t("savedCompare.classification.partner", { defaultValue: "Partner" })}
                  </SelectItem>
                  <SelectItem value="public">
                    {t("savedCompare.classification.public", { defaultValue: "Public" })}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="sc-client">
                {t("savedCompare.dialog.clientLabel", { defaultValue: "Client / customer" })}
              </Label>
              <Input
                id="sc-client"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder={t("savedCompare.dialog.clientPlaceholder", {
                  defaultValue: "(optional, surfaces in report Hero)",
                })}
              />
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm" htmlFor="sc-sweep">
            <input
              id="sc-sweep"
              type="checkbox"
              className="mt-0.5"
              checked={sweepMode}
              onChange={(e) => setSweepMode(e.target.checked)}
            />
            <span>
              <span className="font-medium">
                {t("savedCompare.dialog.sweepLabel", {
                  defaultValue: "Sweep mode (concurrency curves)",
                })}
              </span>
              <span className="block text-muted-foreground">
                {t("savedCompare.dialog.sweepHint", {
                  defaultValue:
                    "Plot metric-vs-concurrency lines grouped by engine; allows up to 50 runs. Use when comparing one workload swept across concurrency levels.",
                })}
              </span>
            </span>
          </label>
          {create.error ? (
            <div className="text-sm text-rose-600">{create.error.message}</div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("savedCompare.dialog.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {generateAfterSave
              ? t("savedCompare.dialog.submitGenerate")
              : t("savedCompare.dialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
