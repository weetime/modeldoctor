import type { ToolDef } from "@modeldoctor/contracts";
import { isBlockedHost } from "../../common/net/ssrf-guard.js";

/**
 * Server-side built-in demo tools for the Agent Playground loop (Task 8).
 * Each entry pairs an OpenAI function-tool schema (`def`) with an executor
 * (`run`) that the loop invokes when the model emits a matching tool_call.
 *
 * These run inside a real NestJS request handler (not the workflow-script
 * sandbox), so `Date`/`Date.now()` and `fetch` are used directly — no
 * determinism restrictions apply here.
 */

// ---------------------------------------------------------------------------
// get_current_time
// ---------------------------------------------------------------------------

async function getCurrentTimeRun(): Promise<string> {
  return new Date().toISOString();
}

const GET_CURRENT_TIME_DEF: ToolDef = {
  type: "function",
  function: {
    name: "get_current_time",
    description: "Returns the current date/time as an ISO-8601 timestamp string.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
};

// ---------------------------------------------------------------------------
// calculator
// ---------------------------------------------------------------------------

/**
 * Only digits, `+ - * / ( ) .` and whitespace are permitted. Anything else
 * (letters, `=`, `;`, quotes, …) is rejected before any evaluation happens.
 */
const CALCULATOR_WHITELIST = /^[0-9+\-*/().\s]+$/;

/**
 * Minimal recursive-descent evaluator for `+ - * / ( )` with standard
 * precedence and unary +/-. Deliberately avoids `eval`/`Function` entirely —
 * the whitelist regex above is a first gate, this parser is the second and
 * only interprets the four arithmetic operators and numeric literals.
 */
class ArithmeticParser {
  private pos = 0;
  constructor(private readonly src: string) {}

  private peek(): string | undefined {
    return this.src[this.pos];
  }

  private isDigit(c: string | undefined): boolean {
    return c !== undefined && c >= "0" && c <= "9";
  }

  private skipWs(): void {
    while (this.peek() === " " || this.peek() === "\t") this.pos++;
  }

  parse(): number {
    const value = this.parseExpr();
    this.skipWs();
    if (this.pos !== this.src.length) {
      throw new Error(`Unexpected character at position ${this.pos} in expression`);
    }
    return value;
  }

  private parseExpr(): number {
    this.skipWs();
    let value = this.parseTerm();
    this.skipWs();
    while (this.peek() === "+" || this.peek() === "-") {
      const op = this.peek();
      this.pos++;
      const rhs = this.parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
      this.skipWs();
    }
    return value;
  }

  private parseTerm(): number {
    this.skipWs();
    let value = this.parseFactor();
    this.skipWs();
    while (this.peek() === "*" || this.peek() === "/") {
      const op = this.peek();
      this.pos++;
      const rhs = this.parseFactor();
      if (op === "/") {
        if (rhs === 0) throw new Error("Division by zero");
        value = value / rhs;
      } else {
        value = value * rhs;
      }
      this.skipWs();
    }
    return value;
  }

  private parseFactor(): number {
    this.skipWs();
    if (this.peek() === "-") {
      this.pos++;
      return -this.parseFactor();
    }
    if (this.peek() === "+") {
      this.pos++;
      return this.parseFactor();
    }
    if (this.peek() === "(") {
      this.pos++;
      const value = this.parseExpr();
      this.skipWs();
      if (this.peek() !== ")") throw new Error("Mismatched parentheses in expression");
      this.pos++;
      return value;
    }
    const start = this.pos;
    while (this.isDigit(this.peek()) || this.peek() === ".") this.pos++;
    if (this.pos === start) {
      throw new Error(`Expected number at position ${this.pos} in expression`);
    }
    const literal = this.src.slice(start, this.pos);
    const num = Number(literal);
    if (Number.isNaN(num)) throw new Error(`Invalid numeric literal "${literal}"`);
    return num;
  }
}

function evaluateArithmetic(expression: string): number {
  return new ArithmeticParser(expression).parse();
}

async function calculatorRun(args: Record<string, unknown>): Promise<string> {
  const expression = args.expression;
  if (typeof expression !== "string" || expression.trim().length === 0) {
    throw new Error("calculator: `expression` must be a non-empty string");
  }
  if (!CALCULATOR_WHITELIST.test(expression)) {
    throw new Error(
      "calculator: expression contains disallowed characters (only digits, + - * / ( ) . and whitespace are permitted)",
    );
  }
  const result = evaluateArithmetic(expression);
  return String(result);
}

const CALCULATOR_DEF: ToolDef = {
  type: "function",
  function: {
    name: "calculator",
    description:
      "Evaluates a basic arithmetic expression (digits and + - * / ( ) . only) and returns the numeric result as a string.",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: 'Arithmetic expression, e.g. "2 + 3 * 4".',
        },
      },
      required: ["expression"],
      additionalProperties: false,
    },
  },
};

// ---------------------------------------------------------------------------
// http_get
// ---------------------------------------------------------------------------

const HTTP_GET_TIMEOUT_MS = 5000;
const HTTP_GET_MAX_BODY_LENGTH = 10 * 1024; // 10KB

/**
 * Blocks loopback / private / link-local / CGNAT / metadata hosts to guard
 * against SSRF. Shared with `McpClientService` — see
 * `apps/api/src/common/net/ssrf-guard.ts` for the range list and rationale.
 */

async function httpGetRun(args: Record<string, unknown>): Promise<string> {
  const url = args.url;
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new Error("http_get: `url` must be a non-empty string");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`http_get: "${url}" is not a valid URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`http_get: unsupported scheme "${parsed.protocol}" (only http/https allowed)`);
  }

  if (isBlockedHost(parsed.hostname)) {
    throw new Error(
      `http_get: host "${parsed.hostname}" is blocked (loopback/private/link-local/metadata addresses are not allowed)`,
    );
  }

  const res = await fetch(parsed.toString(), {
    method: "GET",
    signal: AbortSignal.timeout(HTTP_GET_TIMEOUT_MS),
  });
  const text = await res.text();
  const truncated =
    text.length > HTTP_GET_MAX_BODY_LENGTH
      ? `${text.slice(0, HTTP_GET_MAX_BODY_LENGTH)}...[truncated]`
      : text;

  return `HTTP ${res.status}\n${truncated}`;
}

const HTTP_GET_DEF: ToolDef = {
  type: "function",
  function: {
    name: "http_get",
    description:
      "Performs a read-only HTTP GET against a public http/https URL (5s timeout, response truncated to 10KB). Loopback/private/link-local/metadata addresses are blocked.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Public http/https URL to fetch.",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
};

// ---------------------------------------------------------------------------
// Registry + dispatch
// ---------------------------------------------------------------------------

export const BUILTIN_TOOLS: Record<
  string,
  { def: ToolDef; run: (args: Record<string, unknown>) => Promise<string> }
> = {
  get_current_time: { def: GET_CURRENT_TIME_DEF, run: getCurrentTimeRun },
  calculator: { def: CALCULATOR_DEF, run: calculatorRun },
  http_get: { def: HTTP_GET_DEF, run: httpGetRun },
};

export const BUILTIN_TOOL_DEFS: ToolDef[] = Object.values(BUILTIN_TOOLS).map((t) => t.def);

export async function executeBuiltin(name: string, args: Record<string, unknown>): Promise<string> {
  if (!Object.hasOwn(BUILTIN_TOOLS, name)) {
    throw new Error(`executeBuiltin: unknown built-in tool "${name}"`);
  }
  const tool = BUILTIN_TOOLS[name];
  return tool.run(args);
}
