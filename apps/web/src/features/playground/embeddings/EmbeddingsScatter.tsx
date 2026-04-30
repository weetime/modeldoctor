import { Chart } from "@/components/charts";
import { useTranslation } from "react-i18next";

export interface EmbeddingsScatterProps {
  inputs: string[];
  coords: { x: number; y: number }[];
}

export function EmbeddingsScatter({ inputs, coords }: EmbeddingsScatterProps) {
  const { t } = useTranslation("playground");
  if (inputs.length === 0 || coords.length === 0) return null;

  const points = coords.map((c, i) => ({
    x: c.x,
    y: c.y,
    label: (inputs[i] ?? "").slice(0, 40),
  }));

  return (
    <Chart
      kind="scatter"
      ariaLabel={t("embeddings.scatter.ariaLabel", "PCA scatter plot of embeddings")}
      data={{ points, xLabel: "PC1", yLabel: "PC2" }}
      height={420}
      options={{
        tooltip: {
          trigger: "item",
          // biome-ignore lint/suspicious/noExplicitAny: ECharts formatter params type
          formatter: (params: any) => {
            const [x, y, label] = params.data as [number, number, string];
            return `${label}<br/>(${x.toFixed(3)}, ${y.toFixed(3)})`;
          },
        },
      }}
    />
  );
}
