import type { RadarAxisId } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";

const AXES: RadarAxisId[] = [
  "responsiveness",
  "smoothness",
  "throughput",
  "stability",
  "tail",
  "efficiency",
];

interface Props {
  values: Partial<Record<RadarAxisId, number | null>>;
  size?: number;
}

export function RadarChart({ values, size = 180 }: Props) {
  const { t } = useTranslation("insights");
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 32; // padding for labels
  const n = AXES.length;

  // Compute (x,y) on the unit circle for each axis at value v ∈ [0, 1].
  function pt(idx: number, v: number) {
    const angle = (Math.PI * 2 * idx) / n - Math.PI / 2;
    return [cx + Math.cos(angle) * r * v, cy + Math.sin(angle) * r * v] as const;
  }

  const ringRadii = [0.25, 0.5, 0.75, 1.0];

  // Build value polygon — null axes get 0 (rendered as inward spike).
  const valuePoints = AXES.map((axis, i) => {
    const v = values[axis] ?? 0;
    return pt(i, v).join(",");
  }).join(" ");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="radar">
      {ringRadii.map((rad, i) => (
        <polygon
          key={i}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.12}
          points={AXES.map((_, j) => pt(j, rad).join(",")).join(" ")}
        />
      ))}
      {AXES.map((axis, i) => {
        const [x, y] = pt(i, 1);
        const [lx, ly] = pt(i, 1.18);
        return (
          <g key={axis} data-axis={axis}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="currentColor" strokeOpacity={0.2} />
            <text
              x={lx}
              y={ly}
              fontSize={10}
              fill="currentColor"
              fillOpacity={0.7}
              textAnchor={lx < cx - 4 ? "end" : lx > cx + 4 ? "start" : "middle"}
              dominantBaseline={ly < cy ? "alphabetic" : "hanging"}
            >
              {t(`axis.${axis}`, { defaultValue: axis })}
            </text>
          </g>
        );
      })}
      <polygon
        data-role="value-shape"
        points={valuePoints}
        fill="rgb(74,108,247)"
        fillOpacity={0.25}
        stroke="rgb(74,108,247)"
        strokeWidth={1.5}
      />
    </svg>
  );
}
