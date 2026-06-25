import { deltaColumnIndex, isImprovement, type ParsedTable, parseDelta } from "./report-blocks";

/**
 * Renders a parsed comparison table with the delta column shown as colored
 * triangles: ▲/▼ for the literal direction of the change, green/red for
 * whether that change is an improvement (decoupled, matching the Primer report
 * style — a latency drop is ▼ and green; a throughput drop would be ▼ and red).
 */
export function DeltaTable({ table }: { table: ParsedTable }) {
  const { headers, rows } = table;
  const deltaCol = deltaColumnIndex(headers, rows);
  const deltaHeader = deltaCol >= 0 ? headers[deltaCol] : "";

  return (
    <table>
      <thead>
        <tr>
          {headers.map((h, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: header cells are positional
            <th key={i} className={i === deltaCol ? "pr-delta-col" : undefined}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => {
          // The row's metric label is its first non-delta cell — drives per-row
          // polarity so a combined table colors each metric correctly.
          const rowLabel = row[deltaCol === 0 ? 1 : 0] ?? "";
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
            <tr key={ri}>
              {headers.map((_, ci) => {
                const cell = row[ci] ?? "";
                if (ci === deltaCol) {
                  const d = parseDelta(cell);
                  if (d) {
                    const good = isImprovement(d.sign, deltaHeader, table.metric, rowLabel);
                    return (
                      // biome-ignore lint/suspicious/noArrayIndexKey: positional
                      <td key={ci} className="pr-delta-col">
                        <span className={`pr-delta ${good ? "pr-delta-good" : "pr-delta-bad"}`}>
                          <span className="pr-delta-tri">{d.sign === "+" ? "▲" : "▼"}</span>
                          {d.magnitude}
                        </span>
                      </td>
                    );
                  }
                }
                // biome-ignore lint/suspicious/noArrayIndexKey: positional
                return <td key={ci}>{cell}</td>;
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
