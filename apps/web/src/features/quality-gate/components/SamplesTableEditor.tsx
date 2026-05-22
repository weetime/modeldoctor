import type { EvaluationSample } from "@modeldoctor/contracts";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EvaluationSampleEditor } from "./EvaluationSampleEditor";

interface Props {
  /** Dot path of the samples array in the parent form (typically `"samples"`). */
  name: string;
  /** When true, render the samples as a read-only preview (no add/edit/delete). */
  readOnly?: boolean;
  /** Optional trailing slot rendered next to the "Add sample" button (e.g. import buttons). */
  trailingActions?: React.ReactNode;
}

/**
 * Compact samples table with click-to-edit drawer — the dataset-detail-page
 * pattern used by LangSmith and Braintrust. Designed to keep dataset detail
 * pages short even when the evaluation has many samples.
 *
 * The drawer mounts EvaluationSampleEditor against the parent form's field
 * array, so edits propagate live without a per-sample "Save" step.
 */
export function SamplesTableEditor({ name, readOnly = false, trailingActions }: Props) {
  const { t } = useTranslation("quality-gate");
  const { control } = useFormContext();
  const { fields, append, remove } = useFieldArray({ control, name });
  const samples = (useWatch({ control, name }) ?? []) as EvaluationSample[];

  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  function handleAdd() {
    append({
      prompt: "",
      expected: "",
      judgeConfig: { kind: "exact-match" },
    });
    setEditingIndex(fields.length);
  }

  function handleRemove(i: number) {
    remove(i);
    if (editingIndex === i) setEditingIndex(null);
  }

  const isAdding = editingIndex !== null && editingIndex >= fields.length;

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={handleAdd}>
            <Plus className="mr-1 h-4 w-4" />
            {t("samples.addAction")}
          </Button>
          {trailingActions}
        </div>
      )}

      {fields.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t("samples.empty")}
        </div>
      ) : (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">{t("samples.col.idx")}</TableHead>
                <TableHead className="w-2/5">{t("samples.col.prompt")}</TableHead>
                <TableHead className="w-2/5">{t("samples.col.expected")}</TableHead>
                <TableHead className="w-32">{t("samples.col.judge")}</TableHead>
                {!readOnly && (
                  <TableHead className="w-40 text-right">{t("samples.col.actions")}</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((f, i) => {
                const s = samples[i];
                const promptPreview = s?.prompt?.trim();
                const expectedPreview = s?.expected?.trim();
                return (
                  <TableRow key={f.id}>
                    <TableCell className="text-muted-foreground tabular-nums align-top">
                      {i + 1}
                    </TableCell>
                    <TableCell className="align-top">
                      {promptPreview ? (
                        <span className="line-clamp-2 text-sm">{promptPreview}</span>
                      ) : (
                        <span className="text-sm italic text-muted-foreground">
                          {t("samples.emptyPreview")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      {expectedPreview ? (
                        <span className="line-clamp-2 text-sm text-muted-foreground">
                          {expectedPreview}
                        </span>
                      ) : (
                        <span className="text-sm italic text-muted-foreground/70">—</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge variant="outline" className="font-mono text-xs">
                        {s?.judgeConfig?.kind ?? "—"}
                      </Badge>
                    </TableCell>
                    {!readOnly && (
                      <TableCell className="text-right align-top">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="gap-1"
                            onClick={() => setEditingIndex(i)}
                          >
                            <Pencil className="h-4 w-4" />
                            <span>{t("samples.editAction")}</span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="gap-1 text-destructive"
                            onClick={() => handleRemove(i)}
                          >
                            <Trash2 className="h-4 w-4" />
                            <span>{t("samples.deleteAction")}</span>
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet
        open={editingIndex !== null}
        onOpenChange={(open) => {
          if (!open) setEditingIndex(null);
        }}
      >
        <SheetContent className="w-[600px] sm:max-w-[600px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {isAdding
                ? t("samples.addTitle")
                : t("samples.editorTitle", { idx: (editingIndex ?? 0) + 1 })}
            </SheetTitle>
          </SheetHeader>
          {editingIndex !== null && (
            <div className="pt-4 space-y-4">
              <EvaluationSampleEditor
                namePrefix={`${name}.${editingIndex}`}
                index={editingIndex}
                onRemove={() => handleRemove(editingIndex)}
              />
              <div className="flex justify-end">
                <Button type="button" onClick={() => setEditingIndex(null)}>
                  {t("samples.done")}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
