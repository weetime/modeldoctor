import type { BenchmarkTemplate, ScenarioId } from "@modeldoctor/contracts";
import { Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthStore } from "@/stores/auth-store";
import { DeleteTemplateDialog } from "./DeleteTemplateDialog";
import { useDeleteTemplate, useTemplates } from "./queries";
import { TemplateCard } from "./TemplateCard";

const SEARCH_DEBOUNCE_MS = 300;

const SCENARIO_TABS: { id: ScenarioId; labelKey: string }[] = [
  { id: "inference", labelKey: "list.tabs.inference" },
  { id: "capacity", labelKey: "list.tabs.capacity" },
  { id: "gateway", labelKey: "list.tabs.gateway" },
  { id: "prefix-cache-validation", labelKey: "list.tabs.prefix-cache-validation" },
];

export function TemplateListPage() {
  const { t } = useTranslation("benchmark-templates");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const idPrefix = useId();
  const searchId = `${idPrefix}-search`;
  const officialId = `${idPrefix}-official`;

  const scenario = (params.get("scenario") as ScenarioId) || "inference";
  const officialOnly = params.get("isOfficial") === "true";
  const search = params.get("search") ?? "";

  const [searchDraft, setSearchDraft] = useState(search);
  const lastPushed = useRef(search);

  // Sync URL → local when external state changes (back/forward, "clear all", etc.)
  useEffect(() => {
    if (search !== lastPushed.current) {
      setSearchDraft(search);
      lastPushed.current = search;
    }
  }, [search]);

  // Local → URL with debounce
  useEffect(() => {
    const trimmed = searchDraft.trim();
    if (trimmed === (lastPushed.current || "")) return;
    const handle = window.setTimeout(() => {
      lastPushed.current = trimmed;
      setParam("search", trimmed || null);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchDraft, setParam]);

  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useTemplates({
    scenario,
    isOfficial: officialOnly || undefined,
    search: search || undefined,
    limit: 50,
  });
  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const hasActiveFilters = Boolean(search) || officialOnly;
  const deleteMut = useDeleteTemplate();
  const user = useAuthStore((s) => s.user);
  const myId = user?.id;
  const isAdmin = (user?.roles ?? []).includes("admin");

  const [pendingDelete, setPendingDelete] = useState<BenchmarkTemplate | null>(null);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    setParams(next);
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    try {
      await deleteMut.mutateAsync(pendingDelete.id);
      toast.success(t("edit.deleted"));
      setPendingDelete(null);
    } catch (e) {
      toast.error((e as Error).message ?? t("edit.errors.deleteFailed"));
    }
  }

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        rightSlot={
          <Button onClick={() => navigate(`/benchmark-templates/new?scenario=${scenario}`)}>
            <Plus className="mr-1 h-4 w-4" />
            {t("actions.new")}
          </Button>
        }
      />
      <div className="space-y-6 px-8 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id={searchId}
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder={t("list.filters.search")}
            className="max-w-xs"
          />
          <label
            htmlFor={officialId}
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Switch
              id={officialId}
              checked={officialOnly}
              onCheckedChange={(v) => setParam("isOfficial", v ? "true" : null)}
            />
            {t("list.filters.officialOnly")}
          </label>
        </div>

        <Tabs value={scenario} onValueChange={(v) => setParam("scenario", v)}>
          <TabsList>
            {SCENARIO_TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {t(tab.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {isLoading && <div className="text-sm text-muted-foreground">…</div>}

        {!isLoading && items.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-12 text-center">
            <p className="text-base font-medium">
              {hasActiveFilters ? t("list.empty.noResults.title") : t("list.empty.title")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {hasActiveFilters ? t("list.empty.noResults.subtitle") : t("list.empty.subtitle")}
            </p>
            {!hasActiveFilters && (
              <Button
                className="mt-4"
                onClick={() => navigate(`/benchmark-templates/new?scenario=${scenario}`)}
              >
                <Plus className="mr-1 h-4 w-4" />
                {t("actions.new")}
              </Button>
            )}
          </div>
        )}

        {!isLoading && items.length > 0 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((tpl) => (
              <TemplateCard
                key={tpl.id}
                template={tpl}
                canEdit={isAdmin || tpl.createdBy === myId}
                onDeleteClick={() => setPendingDelete(tpl)}
              />
            ))}
          </div>
        )}

        {hasNextPage && (
          <div className="mt-4 flex justify-center">
            <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? "…" : t("list.loadMore")}
            </Button>
          </div>
        )}
      </div>

      <DeleteTemplateDialog
        template={pendingDelete}
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        onConfirm={handleConfirmDelete}
        pending={deleteMut.isPending}
      />
    </>
  );
}
