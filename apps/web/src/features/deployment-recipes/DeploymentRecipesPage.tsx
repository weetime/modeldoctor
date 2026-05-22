import { Check, Filter, Search, SearchX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ENGINES, getRecipe, MODELS } from "./data";
import { RecipeDrawer } from "./RecipeDrawer";
import type { CategoryId, EngineId, EngineMeta, ModelEntry, RecipeStatus } from "./types";
import { CATEGORY_ORDER } from "./types";

type CategoryFilter = "all" | CategoryId;

interface SelectedCell {
  modelId: string;
  engineId: EngineId;
}

// ---------------------------------------------------------------------------
// Cell pill — small visual indicator inside the matrix.
// ---------------------------------------------------------------------------

function StatusPill({
  status,
  active,
  highlight,
  onClick,
  ariaLabel,
}: {
  status: RecipeStatus;
  active: boolean;
  highlight: boolean;
  onClick?: () => void;
  ariaLabel: string;
}) {
  const base =
    "flex h-7 w-9 items-center justify-center rounded-md text-sm font-medium transition-colors";

  if (status === "native") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className={cn(
          base,
          "border border-emerald-200/70 bg-emerald-50 text-emerald-700",
          "hover:border-emerald-300 hover:bg-emerald-100",
          "dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-400 dark:hover:bg-emerald-950/70",
          (active || highlight) &&
            "ring-2 ring-emerald-400/60 ring-offset-1 ring-offset-background dark:ring-emerald-500/60",
        )}
      >
        ✓
      </button>
    );
  }

  if (status === "partial") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className={cn(
          base,
          "border border-amber-200/70 bg-amber-50 text-amber-700",
          "hover:border-amber-300 hover:bg-amber-100",
          "dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-400 dark:hover:bg-amber-950/60",
          (active || highlight) &&
            "ring-2 ring-amber-400/60 ring-offset-1 ring-offset-background dark:ring-amber-500/60",
        )}
      >
        ~
      </button>
    );
  }

  if (status === "community") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className={cn(
          base,
          "border border-indigo-200/70 bg-indigo-50 text-indigo-700",
          "hover:border-indigo-300 hover:bg-indigo-100",
          "dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-400 dark:hover:bg-indigo-950/60",
          (active || highlight) &&
            "ring-2 ring-indigo-400/60 ring-offset-1 ring-offset-background dark:ring-indigo-500/60",
        )}
      >
        ★
      </button>
    );
  }

  return (
    <span
      aria-label={ariaLabel}
      className={cn(
        base,
        "cursor-not-allowed border border-transparent bg-muted/40 text-muted-foreground/50",
      )}
    >
      ·
    </span>
  );
}

// ---------------------------------------------------------------------------
// Engine column visibility popover
// ---------------------------------------------------------------------------

function EngineToggle({
  visible,
  onChange,
}: {
  visible: Set<EngineId>;
  onChange: (next: Set<EngineId>) => void;
}) {
  const { t } = useTranslation("deployment-recipes");
  const allOn = visible.size === ENGINES.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Filter className="h-3.5 w-3.5" />
          {t("filters.engineToggle")}
          <span className="text-xs text-muted-foreground">
            {visible.size}/{ENGINES.length}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-xs font-medium text-muted-foreground">
            {t("filters.visibleColumns")}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs"
            onClick={() => onChange(allOn ? new Set() : new Set(ENGINES.map((e) => e.id)))}
          >
            {allOn ? t("filters.hideAll") : t("filters.showAll")}
          </Button>
        </div>
        <div className="space-y-0.5">
          {ENGINES.map((eng) => {
            const checked = visible.has(eng.id);
            return (
              <button
                key={eng.id}
                type="button"
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  "hover:bg-accent hover:text-accent-foreground",
                )}
                onClick={() => {
                  const next = new Set(visible);
                  if (checked) next.delete(eng.id);
                  else next.add(eng.id);
                  onChange(next);
                }}
              >
                <span className="font-medium">{eng.name}</span>
                {checked ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function DeploymentRecipesPage() {
  const { t } = useTranslation("deployment-recipes");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");
  const [visibleEngines, setVisibleEngines] = useState<Set<EngineId>>(
    () => new Set(ENGINES.map((e) => e.id)),
  );
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [hoveredEngine, setHoveredEngine] = useState<EngineId | null>(null);

  // ---- Hash routing: #model-id/engine-id ----
  useEffect(() => {
    const parseHash = () => {
      const raw = window.location.hash.replace(/^#/, "");
      if (!raw) {
        setSelected(null);
        return;
      }
      const [modelId, engineId] = raw.split("/");
      const model = modelId ? MODELS.find((m) => m.id === modelId) : null;
      const engine = engineId ? ENGINES.find((e) => e.id === engineId) : null;
      const recipe = model && engine ? getRecipe(model, engine.id) : null;
      if (model && engine && recipe && recipe.status !== "none") {
        setSelected({ modelId: model.id, engineId: engine.id });
      } else {
        setSelected(null);
      }
    };
    parseHash();
    window.addEventListener("hashchange", parseHash);
    return () => window.removeEventListener("hashchange", parseHash);
  }, []);

  const handleSelect = (modelId: string, engineId: EngineId) => {
    window.location.hash = `${modelId}/${engineId}`;
    setSelected({ modelId, engineId });
  };

  const handleCloseDrawer = (open: boolean) => {
    if (!open) {
      // Strip the hash without leaving "#" behind, so re-opening triggers hashchange.
      history.replaceState(null, "", window.location.pathname + window.location.search);
      setSelected(null);
    }
  };

  // ---- Derived data ----
  const filteredModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MODELS.filter((m) => {
      if (category !== "all" && m.category !== category) return false;
      if (!q) return true;
      if (m.name.toLowerCase().includes(q)) return true;
      if (m.meta.toLowerCase().includes(q)) return true;
      // Engine match: only keep rows that actually support a matching engine
      // (status native or partial). Match on display name and vendor.
      return ENGINES.some((eng) => {
        if (!visibleEngines.has(eng.id)) return false;
        const matches = eng.name.toLowerCase().includes(q) || eng.vendor.toLowerCase().includes(q);
        if (!matches) return false;
        const status = getRecipe(m, eng.id)?.status;
        return status === "native" || status === "partial" || status === "community";
      });
    });
  }, [category, query, visibleEngines]);

  const groupedModels = useMemo(() => {
    const map = new Map<CategoryId, ModelEntry[]>();
    for (const m of filteredModels) {
      const list = map.get(m.category) ?? [];
      list.push(m);
      map.set(m.category, list);
    }
    return CATEGORY_ORDER.flatMap((id) => {
      const list = map.get(id) ?? [];
      return list.length > 0 ? [{ id, models: list }] : [];
    });
  }, [filteredModels]);

  const visibleEngineList: EngineMeta[] = ENGINES.filter((e) => visibleEngines.has(e.id));

  const selectedModel = selected ? (MODELS.find((m) => m.id === selected.modelId) ?? null) : null;
  const selectedEngineMeta = selected
    ? (ENGINES.find((e) => e.id === selected.engineId) ?? null)
    : null;
  const selectedRecipe =
    selectedModel && selected ? (getRecipe(selectedModel, selected.engineId) ?? null) : null;

  const tabs = useMemo<{ id: CategoryFilter; label: string }[]>(
    () => [
      { id: "all", label: t("filters.all") },
      ...CATEGORY_ORDER.map((id) => ({
        id: id as CategoryFilter,
        label: t(`categories.${id}.label`),
      })),
    ],
    [t],
  );

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle", { models: MODELS.length, engines: ENGINES.length })}
      />
      <div className="space-y-6 px-8 py-6">
        {/* Toolbar -------------------------------------------------------- */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategory(tab.id)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  category === tab.id
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative ml-auto w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("filters.searchPlaceholder")}
              className="h-9 pl-8 text-sm"
            />
          </div>

          <EngineToggle visible={visibleEngines} onChange={setVisibleEngines} />
        </div>

        {/* Matrix table -------------------------------------------------- */}
        <TooltipProvider delayDuration={200}>
          {groupedModels.length === 0 ? (
            <EmptyState icon={SearchX} title={t("empty.title")} body={t("empty.body")} />
          ) : (
            // The matrix wrapper owns its own scroll context so the sticky
            // <thead> stays pinned. The max-h subtracts PageHeader + toolbar +
            // page padding + legend from the dynamic viewport height.
            <div className="max-h-[calc(100dvh-15rem)] overflow-auto rounded-lg border border-border bg-card">
              <table className="min-w-full border-collapse text-sm">
                <thead className="sticky top-0 z-20 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
                  <tr className="border-b border-border">
                    <th
                      scope="col"
                      className="sticky left-0 z-30 min-w-[260px] bg-card/95 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {t("table.modelHeader")}
                    </th>
                    {visibleEngineList.map((eng) => (
                      <th
                        key={eng.id}
                        scope="col"
                        onMouseEnter={() => setHoveredEngine(eng.id)}
                        onMouseLeave={() => setHoveredEngine(null)}
                        className={cn(
                          "min-w-[96px] px-2 py-3 text-center text-xs font-semibold tracking-wide transition-colors",
                          hoveredEngine === eng.id ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        <div className="flex flex-col items-center gap-0.5">
                          <span>{eng.name}</span>
                          <span className="text-[10px] font-normal text-muted-foreground/70">
                            {eng.vendor}
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groupedModels.map(({ id, models }) => (
                    <CategorySection
                      key={id}
                      label={t("categoryRow", {
                        label: t(`categories.${id}.label`),
                        description: t(`categories.${id}.description`),
                      })}
                      colSpan={visibleEngineList.length + 1}
                    >
                      {models.map((model) => (
                        <ModelRow
                          key={model.id}
                          model={model}
                          engines={visibleEngineList}
                          selected={selected}
                          hoveredEngine={hoveredEngine}
                          onHoverEngine={setHoveredEngine}
                          onSelect={handleSelect}
                        />
                      ))}
                    </CategorySection>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TooltipProvider>

        {/* Legend -------------------------------------------------------- */}
        <footer className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <StatusPill
              status="native"
              active={false}
              highlight={false}
              ariaLabel={t("status.ariaNative")}
            />
            <span>{t("status.native")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <StatusPill
              status="partial"
              active={false}
              highlight={false}
              ariaLabel={t("status.ariaPartial")}
            />
            <span>{t("status.partial")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <StatusPill
              status="community"
              active={false}
              highlight={false}
              ariaLabel={t("status.ariaCommunity")}
            />
            <span>{t("status.community")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <StatusPill
              status="none"
              active={false}
              highlight={false}
              ariaLabel={t("status.ariaNone")}
            />
            <span>{t("status.none")}</span>
          </div>
          <span className="ml-auto text-[11px] text-muted-foreground/70">
            {t("legend.baseline")}
          </span>
        </footer>
      </div>

      <RecipeDrawer
        open={selected !== null}
        onOpenChange={handleCloseDrawer}
        model={selectedModel}
        engine={selectedEngineMeta}
        recipe={selectedRecipe}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Category section row + model row
// ---------------------------------------------------------------------------

function CategorySection({
  label,
  colSpan,
  children,
}: {
  label: string;
  colSpan: number;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={colSpan}
          className="sticky left-0 bg-muted/40 px-4 py-2 text-xs font-semibold tracking-wide text-foreground/80"
        >
          {label}
        </td>
      </tr>
      {children}
    </>
  );
}

function ModelRow({
  model,
  engines,
  selected,
  hoveredEngine,
  onHoverEngine,
  onSelect,
}: {
  model: ModelEntry;
  engines: EngineMeta[];
  selected: SelectedCell | null;
  hoveredEngine: EngineId | null;
  onHoverEngine: (id: EngineId | null) => void;
  onSelect: (modelId: string, engineId: EngineId) => void;
}) {
  const { t } = useTranslation("deployment-recipes");
  return (
    <tr className="group border-b border-border/60 last:border-b-0 hover:bg-accent/30">
      <th
        scope="row"
        className="sticky left-0 z-10 bg-card px-4 py-3 text-left align-top group-hover:bg-accent/50"
      >
        <div className="font-medium text-foreground">{model.name}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{model.meta}</div>
      </th>
      {engines.map((eng) => {
        const recipe = getRecipe(model, eng.id);
        const status = recipe?.status ?? "none";
        const isActive = selected?.modelId === model.id && selected?.engineId === eng.id;
        const isColHighlighted = hoveredEngine === eng.id;
        const cellClickable = status !== "none";
        const tooltipText = recipe?.tooltip ?? recipe?.notes ?? null;
        const ariaLabel =
          status === "native"
            ? t("status.ariaNative")
            : status === "partial"
              ? t("status.ariaPartial")
              : status === "community"
                ? t("status.ariaCommunity")
                : t("status.ariaNone");

        const cell = (
          <StatusPill
            status={status}
            active={isActive}
            highlight={isColHighlighted}
            ariaLabel={ariaLabel}
            onClick={cellClickable ? () => onSelect(model.id, eng.id) : undefined}
          />
        );

        return (
          <td
            key={eng.id}
            onMouseEnter={() => onHoverEngine(eng.id)}
            onMouseLeave={() => onHoverEngine(null)}
            className={cn(
              "px-2 py-2 text-center align-middle transition-colors",
              isColHighlighted && "bg-accent/20",
            )}
          >
            <div className="flex justify-center">
              {tooltipText ? (
                <Tooltip>
                  <TooltipTrigger asChild>{cell}</TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    {tooltipText}
                  </TooltipContent>
                </Tooltip>
              ) : (
                cell
              )}
            </div>
          </td>
        );
      })}
    </tr>
  );
}
