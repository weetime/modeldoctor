import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { computePca2D } from "./pca";

interface Props {
  vectors: number[][];
  labels: string[];
}

export function PcaScatter({ vectors, labels }: Props) {
  const { t } = useTranslation("playground");
  const points = useMemo(() => computePca2D(vectors), [vectors]);

  if (vectors.length < 3) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        {t("embeddings.chart.minThree")}
      </div>
    );
  }

  // Normalise to a 0-100 viewBox with 5px padding
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rx = maxX - minX || 1;
  const ry = maxY - minY || 1;
  const norm = (x: number, y: number): [number, number] => [
    5 + ((x - minX) / rx) * 90,
    5 + ((y - minY) / ry) * 90,
  ];

  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label="PCA scatter">
      <title>{t("embeddings.chart.title")}</title>
      {points.map(([x, y], i) => {
        const [cx, cy] = norm(x, y);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: stable indices, no reordering
          <g key={i}>
            <circle cx={cx} cy={cy} r={1.4} className="fill-primary">
              <title>{labels[i] ?? ""}</title>
            </circle>
            <text x={cx + 1.8} y={cy + 0.6} fontSize={2} className="fill-foreground">
              {String(i + 1)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
