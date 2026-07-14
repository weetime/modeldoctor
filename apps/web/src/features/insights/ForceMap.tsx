// apps/web/src/features/insights/ForceMap.tsx
//
// Bespoke canvas force-directed graph for the Test Insights "Map" view.
// Ported from the hand-tuned graph-tour engine (seeded radial layout +
// spring/repulsion/gravity sim + halo labels + adjacency highlight) rather
// than an off-the-shelf graph chart, because that engine's clarity — even
// radial spread, dimension-labels-only, hover-to-reveal leaves — is exactly
// the look this view needs and is not reachable with ECharts' `graph` series
// (which overlaps every label and clumps to one side).
//
// Bipartite adaptation: dimension nodes (scenario/tool/engine members) sit on
// a ring; endpoint nodes scatter near their busiest dimension. Endpoint color
// encodes health (same 3 score bands as MatrixGrid), size encodes total runs.
import type { InsightsMatrixResponse } from "@modeldoctor/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface ForceMapProps {
  data: InsightsMatrixResponse;
  onNodeClick: (endpointId: string) => void;
}

type Band = "recommended" | "usable" | "not-recommended" | "unscored";

const BAND_COLOR: Record<Band, string> = {
  recommended: "#10b981",
  usable: "#f59e0b",
  "not-recommended": "#f43f5e",
  unscored: "#9ca3af",
};
const DIMENSION_COLOR = "#818cf8";

function bandOf(score: number | null): Band {
  if (score == null) return "unscored";
  if (score >= 85) return "recommended";
  if (score >= 60) return "usable";
  return "not-recommended";
}

interface SimNode {
  id: string;
  kind: "dimension" | "endpoint";
  label: string; // short label drawn on canvas
  full: string; // long label for the info card
  color: string;
  r: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number;
  fy: number;
  fixed?: boolean;
  // endpoint-only
  endpointId?: string;
  model?: string;
  connName?: string;
  score?: number | null;
  band?: Band;
  runs?: number;
  // dimension-only
  count?: number;
}

interface SimEdge {
  s: SimNode;
  t: SimNode;
  w: number;
  rest: number;
}

interface Palette {
  dark: boolean;
  bg: string;
  edge: string;
  edgeHi: string;
  label: string;
  labelDim: string;
}

function readPalette(): Palette {
  const attr =
    typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") : null;
  const dark =
    attr === "dark" ||
    (attr == null &&
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  return dark
    ? {
        dark,
        bg: "#0f1117",
        edge: "rgba(150,163,196,.16)",
        edgeHi: "rgba(129,140,248,.6)",
        label: "#e7eaf3",
        labelDim: "rgba(231,234,243,.5)",
      }
    : {
        dark: false,
        bg: "#ffffff",
        edge: "rgba(40,52,84,.18)",
        edgeHi: "rgba(99,102,241,.55)",
        label: "#181d2c",
        labelDim: "rgba(24,29,44,.55)",
      };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// Physics constants (from the graph-tour engine, tuned for ~20-40 nodes).
const REP = 8600;
const SPRING = 0.02;
const GRAVITY = 0.008;
const DAMP = 0.9;
const MAXV = 9;

/**
 * Build the simulation graph from the matrix response and run a canvas
 * force layout. Dimension nodes are the ring anchors; endpoint nodes are
 * leaves colored by health band. Clicking an endpoint selects it (info
 * card) with a button to drill into its detail page via `onNodeClick`.
 */
export function ForceMap({ data, onNodeClick }: ForceMapProps) {
  const { t } = useTranslation("insights");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hiddenBands, setHiddenBands] = useState<Set<Band>>(new Set());
  const [query, setQuery] = useState("");
  // Refs mirror the interactive state so the render loop can read the latest
  // values WITHOUT the sim effect re-running (which would restart physics and
  // make nodes jump on every select/filter). Only a `graph` change restarts.
  const selRef = useRef<string | null>(null);
  const hiddenRef = useRef<Set<Band>>(hiddenBands);
  const kickRef = useRef<((a: number) => void) | null>(null);
  selRef.current = selectedId;
  hiddenRef.current = hiddenBands;

  function dimLabel(key: string, fallback: string): string {
    if (data.aggregate === "scenario")
      return t(`detail.scenario.${key}`, { defaultValue: fallback });
    return fallback;
  }

  // Build nodes + edges + adjacency. Rebuilt only when the data changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: dimLabel closes over t/aggregate, but the graph only needs rebuilding when `data` changes; labels re-resolve on the next data update.
  const graph = useMemo(() => {
    const runsByEndpoint = new Map<string, number>();
    const bestScore = new Map<string, number | null>();
    const busiestDim = new Map<string, { dimKey: string; runs: number }>();
    for (const e of data.endpoints) {
      runsByEndpoint.set(e.id, 0);
      bestScore.set(e.id, null);
    }
    for (const c of data.cells) {
      runsByEndpoint.set(c.endpointId, (runsByEndpoint.get(c.endpointId) ?? 0) + c.runs);
      if (c.score != null) {
        const prev = bestScore.get(c.endpointId);
        if (prev == null || c.score > prev) bestScore.set(c.endpointId, c.score);
      }
      const b = busiestDim.get(c.endpointId);
      if (!b || c.runs > b.runs) busiestDim.set(c.endpointId, { dimKey: c.dimKey, runs: c.runs });
    }
    const runVals = [...runsByEndpoint.values()];
    const maxRuns = runVals.length ? Math.max(...runVals) : 1;

    const dims = data.dimensions.map((d) => ({ ...d, label: dimLabel(d.key, d.label) }));
    const dimIndex = new Map(dims.map((d, i) => [d.key, i]));

    const nodes: SimNode[] = [];
    const byId = new Map<string, SimNode>();

    // Seed: dimensions on a ring; endpoints near their busiest dimension.
    const R = 220;
    dims.forEach((d, i) => {
      const a = -Math.PI / 2 + (i / Math.max(1, dims.length)) * Math.PI * 2;
      const n: SimNode = {
        id: `dim:${d.key}`,
        kind: "dimension",
        label: d.label,
        full: d.label,
        color: DIMENSION_COLOR,
        r: 17,
        x: Math.cos(a) * R,
        y: Math.sin(a) * R,
        vx: 0,
        vy: 0,
        fx: 0,
        fy: 0,
        count: d.count,
      };
      nodes.push(n);
      byId.set(n.id, n);
    });

    data.endpoints.forEach((e, i) => {
      const runs = runsByEndpoint.get(e.id) ?? 0;
      const score = bestScore.get(e.id) ?? null;
      const band = bandOf(score);
      const bd = busiestDim.get(e.id);
      const di = bd ? (dimIndex.get(bd.dimKey) ?? 0) : 0;
      const a = -Math.PI / 2 + (di / Math.max(1, dims.length)) * Math.PI * 2;
      const jx = ((i * 53) % 100) / 100 - 0.5; // deterministic jitter
      const jy = ((i * 97) % 100) / 100 - 0.5;
      const n: SimNode = {
        id: `ep:${e.id}`,
        kind: "endpoint",
        label: truncate(e.model, 22),
        full: `${e.model} · ${e.name}`,
        color: BAND_COLOR[band],
        r: 6 + (runs / maxRuns) * 10,
        x: Math.cos(a) * R + jx * 130,
        y: Math.sin(a) * R + jy * 130,
        vx: 0,
        vy: 0,
        fx: 0,
        fy: 0,
        endpointId: e.id,
        model: e.model,
        connName: e.name,
        score,
        band,
        runs,
      };
      nodes.push(n);
      byId.set(n.id, n);
    });

    const maxCellRuns = data.cells.length ? Math.max(...data.cells.map((c) => c.runs)) : 1;
    const edges: SimEdge[] = [];
    const adj = new Map<string, Set<string>>();
    for (const n of nodes) adj.set(n.id, new Set());
    for (const c of data.cells) {
      const s = byId.get(`dim:${c.dimKey}`);
      const tgt = byId.get(`ep:${c.endpointId}`);
      if (!s || !tgt) continue;
      edges.push({ s, t: tgt, w: 1 + (c.runs / maxCellRuns) * 4, rest: 110 });
      adj.get(s.id)?.add(tgt.id);
      adj.get(tgt.id)?.add(s.id);
    }

    const bandCounts: Record<Band, number> = {
      recommended: 0,
      usable: 0,
      "not-recommended": 0,
      unscored: 0,
    };
    for (const n of nodes) if (n.kind === "endpoint" && n.band) bandCounts[n.band] += 1;

    return { nodes, edges, adj, byId, bandCounts, dimCount: dims.length };
  }, [data]);

  const selected = selectedId ? (graph.byId.get(selectedId) ?? null) : null;

  // Simulation + render loop. Restarts ONLY when the graph (data) changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // jsdom / no-canvas env: DOM chrome still renders.

    let pal = readPalette();
    const cam = { s: 1, x: 0, y: 0 };
    let W = 0;
    let H = 0;
    let dpr = 1;
    let alpha = 1;
    let raf = 0;
    let running = true;
    let idle = 0;
    let hover: SimNode | null = null;
    let dragNode: SimNode | null = null;
    let panning = false;
    let px = 0;
    let py = 0;
    let moved = 0;
    const { nodes, edges, adj } = graph;
    const visible = (n: SimNode) =>
      n.kind === "dimension" || !n.band || !hiddenRef.current.has(n.band);

    function resize() {
      if (!wrap || !canvas || !ctx) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cam.x = W / 2;
      cam.y = H / 2;
    }

    function w2s(x: number, y: number): [number, number] {
      return [x * cam.s + cam.x, y * cam.s + cam.y];
    }
    function s2w(x: number, y: number): [number, number] {
      return [(x - cam.x) / cam.s, (y - cam.y) / cam.s];
    }

    function step() {
      const act = nodes.filter(visible);
      for (const n of act) {
        n.fx = 0;
        n.fy = 0;
      }
      for (let i = 0; i < act.length; i++) {
        const a = act[i];
        for (let j = i + 1; j < act.length; j++) {
          const b = act[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) {
            dx = (i % 7) / 7 - 0.5;
            dy = (j % 7) / 7 - 0.5;
            d2 = 1;
          }
          if (d2 > 360000) continue;
          const f = REP / d2;
          const d = Math.sqrt(d2);
          const ux = dx / d;
          const uy = dy / d;
          a.fx += ux * f;
          a.fy += uy * f;
          b.fx -= ux * f;
          b.fy -= uy * f;
        }
      }
      for (const e of edges) {
        if (!visible(e.s) || !visible(e.t)) continue;
        const dx = e.t.x - e.s.x;
        const dy = e.t.y - e.s.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const f = SPRING * (d - e.rest);
        const ux = dx / d;
        const uy = dy / d;
        e.s.fx += ux * f;
        e.s.fy += uy * f;
        e.t.fx -= ux * f;
        e.t.fy -= uy * f;
      }
      for (const n of act) {
        if (n.fixed || n === dragNode) continue;
        n.fx += -n.x * GRAVITY;
        n.fy += -n.y * GRAVITY;
        const m = Math.max(1, n.r / 9);
        n.vx = (n.vx + (n.fx / m) * alpha) * DAMP;
        n.vy = (n.vy + (n.fy / m) * alpha) * DAMP;
        n.vx = Math.max(-MAXV, Math.min(MAXV, n.vx));
        n.vy = Math.max(-MAXV, Math.min(MAXV, n.vy));
        n.x += n.vx;
        n.y += n.vy;
      }
      alpha *= 0.994;
      if (alpha < 0.02) alpha = 0.02;
    }

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      const focus = hover || (selRef.current ? (graph.byId.get(selRef.current) ?? null) : null);
      const nb = focus ? adj.get(focus.id) : null;

      for (const e of edges) {
        if (!visible(e.s) || !visible(e.t)) continue;
        const hot = focus && (e.s === focus || e.t === focus);
        const [x1, y1] = w2s(e.s.x, e.s.y);
        const [x2, y2] = w2s(e.t.x, e.t.y);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        if (hot) {
          ctx.strokeStyle = pal.edgeHi;
          ctx.lineWidth = Math.min(3, e.w);
        } else {
          ctx.strokeStyle = focus
            ? pal.dark
              ? "rgba(150,163,196,.06)"
              : "rgba(40,52,84,.07)"
            : pal.edge;
          ctx.lineWidth = 1;
        }
        ctx.stroke();
      }

      for (const n of nodes) {
        if (!visible(n)) continue;
        const [sx, sy] = w2s(n.x, n.y);
        const r = n.r * cam.s;
        const dim = focus && n !== focus && !nb?.has(n.id);
        ctx.globalAlpha = dim ? 0.26 : 1;

        if (n === focus && !dim) {
          ctx.shadowColor = n.color;
          ctx.shadowBlur = 22 * (pal.dark ? 0.9 : 0.4);
        } else {
          ctx.shadowBlur = 0;
        }
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, 7);
        ctx.fillStyle = n.color;
        ctx.fill();
        ctx.shadowBlur = 0;
        if (n === focus) {
          ctx.beginPath();
          ctx.arc(sx, sy, r + 4, 0, 7);
          ctx.lineWidth = 2;
          ctx.strokeStyle = n.color;
          ctx.stroke();
        }

        const showLabel = n.kind === "dimension" || n === focus || nb?.has(n.id) || cam.s > 1.25;
        if (showLabel) {
          ctx.globalAlpha = dim ? 0.4 : 1;
          const big = n.kind === "dimension";
          const fs = big ? 13 : 11.5;
          ctx.font = `${big ? 600 : 500} ${fs}px ui-sans-serif,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          const ly = sy + r + 5;
          ctx.lineWidth = 3;
          ctx.strokeStyle = pal.bg;
          ctx.lineJoin = "round";
          ctx.strokeText(n.label, sx, ly);
          ctx.fillStyle = n === focus || big ? pal.label : pal.labelDim;
          ctx.fillText(n.label, sx, ly);
        }
        ctx.globalAlpha = 1;
      }
    }

    function frame() {
      if (!running) return;
      step();
      draw();
      if (!dragNode && alpha <= 0.021) idle++;
      else idle = 0;
      if (idle > 60) running = false;
      raf = requestAnimationFrame(frame);
    }
    function kick(a: number) {
      alpha = Math.max(alpha, a);
      if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    }
    kickRef.current = kick;

    function pick(mx: number, my: number): SimNode | null {
      let best: SimNode | null = null;
      let bd = 1e9;
      for (const n of nodes) {
        if (!visible(n)) continue;
        const [sx, sy] = w2s(n.x, n.y);
        const r = n.r * cam.s + 6;
        const d = (mx - sx) ** 2 + (my - sy) ** 2;
        if (d < r * r && d < bd) {
          bd = d;
          best = n;
        }
      }
      return best;
    }

    function localXY(ev: PointerEvent): [number, number] {
      const rect = canvas?.getBoundingClientRect();
      return [ev.clientX - (rect?.left ?? 0), ev.clientY - (rect?.top ?? 0)];
    }

    const onMove = (ev: PointerEvent) => {
      const [mx, my] = localXY(ev);
      if (dragNode) {
        const [wx, wy] = s2w(mx, my);
        dragNode.x = wx;
        dragNode.y = wy;
        dragNode.vx = 0;
        dragNode.vy = 0;
        moved += Math.abs(mx - px) + Math.abs(my - py);
        px = mx;
        py = my;
        kick(0.5);
        return;
      }
      if (panning) {
        cam.x += mx - px;
        cam.y += my - py;
        px = mx;
        py = my;
        moved += 1;
        if (!running) draw();
        return;
      }
      const h = pick(mx, my);
      if (h !== hover) {
        hover = h;
        if (canvas) canvas.style.cursor = h ? "pointer" : "grab";
        if (!running) draw();
      }
    };
    const onDown = (ev: PointerEvent) => {
      canvas?.setPointerCapture(ev.pointerId);
      const [mx, my] = localXY(ev);
      px = mx;
      py = my;
      moved = 0;
      const h = pick(mx, my);
      if (h) dragNode = h;
      else {
        panning = true;
        canvas?.classList.add("cursor-grabbing");
      }
    };
    const onUp = (ev: PointerEvent) => {
      canvas?.classList.remove("cursor-grabbing");
      if (moved < 6) {
        const [mx, my] = localXY(ev);
        const h = pick(mx, my);
        setSelectedId(h ? h.id : null);
        if (h) kick(0.15);
      }
      dragNode = null;
      panning = false;
    };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = canvas?.getBoundingClientRect();
      const mx = ev.clientX - (rect?.left ?? 0);
      const my = ev.clientY - (rect?.top ?? 0);
      const [wx, wy] = s2w(mx, my);
      const f = Math.exp(-ev.deltaY * 0.0014);
      cam.s = Math.max(0.35, Math.min(3.2, cam.s * f));
      cam.x = mx - wx * cam.s;
      cam.y = my - wy * cam.s;
      if (!running) draw();
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (!running) draw();
    });
    ro.observe(wrap);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    raf = requestAnimationFrame(frame);

    // Re-read palette when theme flips.
    const themeObs = new MutationObserver(() => {
      pal = readPalette();
      if (!running) draw();
    });
    themeObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      themeObs.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      kickRef.current = null;
    };
    // Restart the sim ONLY on data change; selection/filter/theme are read
    // live via refs + a light kick (see effects below), never a restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // Redraw/re-space on selection or filter change without restarting physics.
  // biome-ignore lint/correctness/useExhaustiveDependencies: kickRef is a stable ref; we intentionally fire only on selectedId change.
  useEffect(() => {
    kickRef.current?.(0.12);
  }, [selectedId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: hiding a band changes the visible node set; re-space with a stronger kick.
  useEffect(() => {
    kickRef.current?.(0.4);
  }, [hiddenBands]);

  const isEmpty = data.dimensions.length === 0 || data.endpoints.length === 0;

  const searchMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return graph.nodes.filter((n) => n.kind === "endpoint" && n.full.toLowerCase().includes(q));
  }, [query, graph.nodes]);

  const BAND_FALLBACK: Record<Band, string> = {
    recommended: "Recommended",
    usable: "Usable",
    "not-recommended": "Not recommended",
    unscored: "Unscored",
  };
  const bandRows: { band: Band; label: string; count: number }[] = (
    ["recommended", "usable", "not-recommended", "unscored"] as const
  ).map((band) => ({
    band,
    // Match ScatterPanel: real bands use matrix.band.<band>; unscored has no
    // band key, so it falls back to the map's own "unscored" label.
    label:
      band === "unscored"
        ? t("matrix.map.tooltipUnscored", { defaultValue: "Unscored" })
        : t(`matrix.band.${band}`, { defaultValue: BAND_FALLBACK[band] }),
    count: graph.bandCounts[band],
  }));

  function toggleBand(band: Band) {
    setHiddenBands((prev) => {
      const next = new Set(prev);
      if (next.has(band)) next.delete(band);
      else next.add(band);
      return next;
    });
  }

  if (isEmpty) {
    return (
      <div className="flex h-[560px] items-center justify-center rounded-md border border-border text-sm text-muted-foreground">
        {t("matrix.map.empty", { defaultValue: "No data" })}
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      data-testid="force-map"
      className="relative h-[640px] w-full overflow-hidden rounded-md border border-border bg-card"
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 cursor-grab"
        aria-label={t("matrix.map.title", { defaultValue: "Endpoint map" })}
      />

      {/* Left drawer: title + search + color legend (click a band to hide it). */}
      <div className="absolute left-3 top-3 z-10 w-64 max-w-[calc(100%-1.5rem)] rounded-xl border border-border bg-background/85 p-4 shadow-lg backdrop-blur">
        <div className="text-[13px] font-semibold">
          {t("matrix.map.title", { defaultValue: "Endpoint map" })}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {t("matrix.map.thesis", {
            defaultValue: "Dimensions in the center, endpoints around — colored by health.",
          })}
        </p>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("matrix.filters.searchPlaceholder", {
            defaultValue: "Search endpoint…",
          })}
          className="mt-3 w-full rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs outline-none focus:border-primary"
        />
        {searchMatches != null && (
          <div className="mt-1.5 max-h-28 space-y-0.5 overflow-auto">
            {searchMatches.length === 0 ? (
              <div className="px-1 py-1 text-[11px] text-muted-foreground">—</div>
            ) : (
              searchMatches.map((n) => (
                <button
                  type="button"
                  key={n.id}
                  onClick={() => setSelectedId(n.id)}
                  className="block w-full truncate rounded px-1.5 py-1 text-left text-[11px] hover:bg-accent"
                >
                  {n.full}
                </button>
              ))
            )}
          </div>
        )}
        <div className="mt-3 space-y-0.5">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("matrix.map.legendHint", { defaultValue: "Click a color to filter" })}
          </div>
          <div className="flex items-center gap-2 px-1 py-1 text-[11.5px]">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: DIMENSION_COLOR }}
            />
            <span>{t("matrix.map.categoryDimension", { defaultValue: "Dimension" })}</span>
            <span className="ml-auto tabular-nums text-[11px] text-muted-foreground">
              {graph.dimCount}
            </span>
          </div>
          {bandRows.map((row) => (
            <button
              type="button"
              key={row.band}
              onClick={() => toggleBand(row.band)}
              className={`flex w-full items-center gap-2 rounded px-1 py-1 text-[11.5px] transition-opacity hover:bg-accent ${
                hiddenBands.has(row.band) ? "opacity-35" : ""
              }`}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: BAND_COLOR[row.band] }}
              />
              <span>{row.label}</span>
              <span className="ml-auto tabular-nums text-[11px] text-muted-foreground">
                {row.count}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-3 border-t border-border pt-2 text-[10.5px] leading-relaxed text-muted-foreground">
          {t("matrix.map.guide", {
            defaultValue: "Drag to move · scroll to zoom · click a node to inspect.",
          })}
        </div>
      </div>

      {/* Right info card — appears when a node is selected. */}
      {selected && (
        <div className="absolute right-3 top-3 z-10 w-64 max-w-[calc(100%-1.5rem)] rounded-xl border border-border bg-background/90 p-4 shadow-lg backdrop-blur">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            aria-label={t("matrix.map.close", { defaultValue: "Close" })}
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
          >
            ×
          </button>
          {selected.kind === "endpoint" ? (
            <>
              <span
                className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={{
                  background: `${selected.color}22`,
                  color: selected.color,
                }}
              >
                {bandRows.find((b) => b.band === selected.band)?.label ?? ""}
              </span>
              <div className="mt-2 pr-5 text-sm font-semibold leading-snug">{selected.model}</div>
              <div className="text-[11px] text-muted-foreground">{selected.connName}</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t("matrix.scatter.score", { defaultValue: "Score" })}
                  </div>
                  <div className="tabular-nums font-semibold" style={{ color: selected.color }}>
                    {selected.score ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t("matrix.map.tooltipRuns", { defaultValue: "Runs" })}
                  </div>
                  <div className="tabular-nums font-semibold">{selected.runs ?? 0}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => selected.endpointId && onNodeClick(selected.endpointId)}
                className="mt-3 w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                {t("matrix.map.viewDetail", { defaultValue: "View detail" })}
              </button>
            </>
          ) : (
            <>
              <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("matrix.map.categoryDimension", { defaultValue: "Dimension" })}
              </span>
              <div className="mt-2 pr-5 text-sm font-semibold leading-snug">{selected.full}</div>
              <div className="mt-3 text-xs text-muted-foreground">
                {t("matrix.map.tooltipCount", { defaultValue: "Cells" })}:{" "}
                <span className="tabular-nums font-semibold text-foreground">
                  {selected.count ?? 0}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Bottom-right controls. */}
      <div className="absolute bottom-3 right-3 z-10 flex gap-1.5">
        <button
          type="button"
          onClick={() => kickRef.current?.(0.9)}
          title={t("matrix.map.reheat", { defaultValue: "Re-layout" })}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background/85 text-sm shadow backdrop-blur hover:bg-accent"
        >
          ↻
        </button>
      </div>
    </div>
  );
}
