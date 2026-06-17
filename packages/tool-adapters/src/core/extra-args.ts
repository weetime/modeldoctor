/**
 * Power-user "escape hatch" for benchmark tools: parse a raw CLI string the
 * user pasted into the param form, and append it to a tool's argv — rejecting
 * any flag the tool already manages so there is exactly one source of truth
 * per managed flag. Pure string parsing; NEVER executes a shell.
 */

export class ExtraArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtraArgsError";
  }
}

/**
 * Split a raw CLI string into argv tokens, honoring single and double quotes.
 * Quotes group/strip; adjacent quoted+unquoted runs join into one token (same
 * as a POSIX shell would), so `key:'{"a":1}'` becomes the single token
 * `key:{"a":1}`. No variable/command/glob expansion — just quoting + splitting.
 */
export function parseExtraArgs(raw: string | undefined): string[] {
  if (!raw) return [];
  const tokens: string[] = [];
  let cur = "";
  let hasToken = false; // tracks an in-progress token across quote boundaries
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inSingle) {
      if (c === "'") inSingle = false;
      else cur += c;
      continue;
    }
    if (inDouble) {
      if (c === '"') inDouble = false;
      else if (c === "\\" && (raw[i + 1] === '"' || raw[i + 1] === "\\")) cur += raw[++i];
      else cur += c;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      hasToken = true;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      hasToken = true;
      continue;
    }
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      if (hasToken) {
        tokens.push(cur);
        cur = "";
        hasToken = false;
      }
      continue;
    }
    cur += c;
    hasToken = true;
  }
  if (inSingle || inDouble) {
    throw new ExtraArgsError("unterminated quote in extra args");
  }
  if (hasToken) tokens.push(cur);
  return tokens;
}

/** The flag name of a token (`--foo` from `--foo` or `--foo=bar`), or null if
 * the token is not a flag (a value / positional). */
function flagName(token: string): string | null {
  if (!token.startsWith("-")) return null;
  const eq = token.indexOf("=");
  return eq === -1 ? token : token.slice(0, eq);
}

/**
 * Parse `raw` and append it to `argv`, throwing ExtraArgsError if any pasted
 * flag is in `locked` (the flags the caller's buildCommand already manages).
 */
export function appendExtraArgs(
  argv: string[],
  raw: string | undefined,
  locked: ReadonlySet<string>,
): string[] {
  const parsed = parseExtraArgs(raw);
  const collisions = [
    ...new Set(parsed.map(flagName).filter((f): f is string => f !== null && locked.has(f))),
  ];
  if (collisions.length > 0) {
    throw new ExtraArgsError(`extra args may not override managed flags: ${collisions.join(", ")}`);
  }
  return [...argv, ...parsed];
}
