import type { PanelUnit } from "@modeldoctor/contracts";

export function formatPanelValue(value: number | null | undefined, unit: PanelUnit): string {
  if (value == null || !Number.isFinite(value)) return "—";
  switch (unit) {
    case "ms":
      return `${Math.round(value)} ms`;
    case "s":
      return `${value.toFixed(2)} s`;
    case "%":
      return `${value.toFixed(1)}%`;
    case "ratio":
      return `${(value * 100).toFixed(1)}%`;
    case "tps":
    case "rps":
      return `${abbrev(value)} ${unit}`;
    case "count":
      return String(Math.round(value));
    case "bytes":
      return formatBytes(value);
  }
}

function abbrev(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toFixed(1);
}

function formatBytes(bytes: number): string {
  if (bytes >= 2 ** 30) return `${(bytes / 2 ** 30).toFixed(1)} GiB`;
  if (bytes >= 2 ** 20) return `${(bytes / 2 ** 20).toFixed(1)} MiB`;
  if (bytes >= 2 ** 10) return `${(bytes / 2 ** 10).toFixed(0)} KiB`;
  return `${bytes} B`;
}
