interface Props {
  values: Record<string, number | null>;
  size?: number;
}
export function RadarChart({ values: _values, size = 160 }: Props) {
  return <div data-testid="radar-chart" style={{ width: size, height: size }} aria-label="radar" />;
}
