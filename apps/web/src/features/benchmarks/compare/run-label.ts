// Derives short, distinguishing labels for the runs in a comparison. Run names
// in a matrix typically share a long prefix (e.g. "深会话t2 · Qwen3-8B · ") that
// is noise in chart legends and axes — only the trailing differentiator
// ("MX-OFF-r1-a1") matters. We strip the leading " · "-delimited tokens that
// EVERY run shares, leaving just what distinguishes them.

const SEP = " · ";

/**
 * Returns one short label per input name (order preserved). Strips the longest
 * run of leading whole tokens common to all names. Whole-token only — a shared
 * character prefix inside a token (MX-OFF / MX-ON) is never split. Falls back
 * to the original name for any run whose stripped label would be empty
 * (e.g. all names identical) and for single-run / empty input.
 */
export function shortRunLabels(names: string[]): string[] {
  if (names.length <= 1) return [...names];
  // All names identical → stripping extracts no distinction, only loses
  // context. Keep the full names.
  if (new Set(names).size === 1) return [...names];

  const tokenLists = names.map((n) => n.split(SEP));
  const minLen = Math.min(...tokenLists.map((t) => t.length));

  let common = 0;
  for (let i = 0; i < minLen; i++) {
    const token = tokenLists[0][i];
    if (tokenLists.every((t) => t[i] === token)) common++;
    else break;
  }

  // Never strip every token — that would empty the shortest name.
  if (common >= minLen) common = minLen - 1;
  if (common <= 0) return [...names];

  return tokenLists.map((tokens, i) => {
    const stripped = tokens.slice(common).join(SEP);
    return stripped.length > 0 ? stripped : names[i];
  });
}
