# Tool Params "Escape Hatch" — raw extra CLI args passthrough

Date: 2026-06-17
Status: design approved (brainstorming), pending spec review → implementation plan

## Problem

Each benchmark tool exposes a **typed, validated param schema** (`guidellmParamsSchema`,
`evalscopeParamsSchema`, `aiperfParamsSchema`) that `buildCommand` maps to CLI argv.
Every new tool flag we want to use (e.g. aiperf `--extra-inputs chat_template_kwargs`
to disable Qwen3 thinking) currently requires a schema + runtime + UI change — a
never-ending extension treadmill.

We want a **power-user escape hatch**: a single textarea to paste raw extra CLI args,
so one-off / long-tail flags don't need code changes — while keeping the typed form for
the common, comparable, reportable params.

## Decisions (locked during brainstorming)

1. **Shape:** a single **raw extra-CLI-args textarea** (NOT a typed key→value map, NOT
   two separate fields). Disabling thinking is achieved by pasting
   `--extra-inputs chat_template_kwargs:'{"enable_thinking":false}'` into it — one
   mechanism subsumes request-body inputs and any other flag.
2. **Scope:** the 3 **argv-based** tools — `aiperf`, `evalscope`, `guidellm`.
   **vegeta is OUT of this PR** (it is a `/bin/sh -c "cat targets.txt | vegeta attack … | vegeta report …"`
   pipeline with no clean argv append point; injecting raw text is a shell-injection
   risk). Revisit vegeta separately if ever needed.
3. **Guardrail:** extra args may only **ADD** flags the tool does not already manage.
   A **per-tool locked-flag denylist** = exactly the flags that tool's `buildCommand`
   emits. If pasted args contain any locked flag → validation error. One managed param =
   one source of truth; no form/textarea conflicts.
4. **Persistence / reproducibility:** `extraArgs` is part of the tool params, so it is
   already stored with the benchmark + template, and displayed on the run detail. The
   compare/report method section records it, marked "extra args (unsupported / not
   guaranteed comparable)".

## Non-goals (YAGNI)

- No typed `--extra-inputs` key→value editor (the raw textarea covers it).
- No vegeta support.
- No per-flag autocomplete / validation of *unknown* flags (we only reject *locked* ones).
- No precedence/merge logic (locked flags are rejected, not merged).

## Architecture

### Shared core (`packages/tool-adapters/src/core/`)

New module `extra-args.ts`:

- `parseExtraArgs(raw: string): string[]`
  - Shell-word split honoring single/double quotes so
    `--extra-inputs chat_template_kwargs:'{"enable_thinking":false}'` stays **two**
    tokens (`--extra-inputs`, `chat_template_kwargs:{"enable_thinking":false}`).
  - Whitespace/newline separated. Empty/whitespace-only → `[]`.
  - Reuse an existing shell-split dependency if the repo already has one; otherwise a
    small, tested splitter (no shell execution — pure string parsing).
- `assertNoLockedFlags(args: string[], locked: ReadonlySet<string>): void`
  - Scans tokens that look like flags (`--foo`, `--foo=bar`, `-f`); throws a typed error
    listing any that are in `locked`.
- `appendExtraArgs(argv: string[], raw: string | undefined, locked: ReadonlySet<string>): string[]`
  - `parseExtraArgs` → `assertNoLockedFlags` → return `argv.concat(parsed)`.

### Per-tool schema (3 files)

Add to each of `aiperfParamsSchema`, `evalscopeParamsSchema`, `guidellmParamsSchema`:

```ts
extraArgs: z.string().max(4000).optional(),
```

Validation of locked flags happens in `buildCommand` (and is surfaced as a friendly
error). A schema-level `superRefine` is **not** used for locked-flag checking because
the locked set lives next to `buildCommand`; instead `buildCommand` calls
`appendExtraArgs` which throws a typed `ExtraArgsError`, caught and reported by the run
launch path the same way other build errors are.

### Per-tool runtime (3 files)

Each tool's `buildCommand` defines `const LOCKED_FLAGS = new Set([...])` = every flag
it pushes, and finishes with:

```ts
const argv = appendExtraArgs(baseArgv, params.extraArgs, LOCKED_FLAGS);
```

Locked sets (derived from current `buildCommand`s):
- **aiperf:** `--model --url --endpoint-type --tokenizer --api-key --workers-max --streaming
  --input-file --custom-dataset-type --fixed-schedule --fixed-schedule-end-offset
  --concurrency --request-count --synthetic-input-tokens-mean --synthetic-input-tokens-stddev
  --output-tokens-mean --output-tokens-stddev --public-dataset --conversation-num
  --conversation-turn-mean --conversation-turn-stddev --connection-reuse-strategy
  --conversation-turn-delay-mean --random-seed --artifact-dir`
- **evalscope:** `--model --api --url --api-key --dataset --dataset-path --name --number
  --parallel --seed --stream --no-stream --no-timestamp --outputs-dir --min-tokens
  --max-tokens --min-prompt-length --max-prompt-length`
- **guidellm:** `--backend --target --model --max-requests --max-seconds --output-path
  --disable-console --backend-kwargs --rate-type --rate --data --random-seed --processor`

(The exact set is re-derived from each `buildCommand` at implementation time so it stays
in sync.)

### UI (`apps/web`)

In the shared tool-params editor used by `TemplateForm` (and the benchmark create page),
add a collapsible **"高级参数 (raw CLI)" / "Advanced (raw CLI)"** section, shown only for
the 3 supported tools:

- A `<textarea>` bound to `params.extraArgs`.
- Helper text (i18n): "追加原始 CLI 参数,空格/换行分隔。不可覆盖受管参数(model / url / api-key / 输出路径 等)。不保证跨 run 可比。"
- One example line: `--extra-inputs chat_template_kwargs:'{"enable_thinking":false}'`.
- Client-side soft check: if a pasted token matches a locked flag, show an inline warning
  (mirrors the server reject) — best-effort, server is authoritative.

### Reporting

`extraArgs` rides along in params → persisted + shown on run detail params display.
The compare method-section input includes it (when non-empty) labeled as unsupported /
uncompared, so the AI narrative can note "this run passed extra CLI args: …".

## Testing

- `extra-args.spec.ts`: `parseExtraArgs` quoting/splitting (incl. the chat_template_kwargs
  example), empty input; `assertNoLockedFlags` rejects locked, allows unknown; flag-shape
  detection (`--foo`, `--foo=bar`, `-f`).
- Each tool's runtime spec: `buildCommand` appends extra args after managed flags;
  rejects a locked flag with `ExtraArgsError`; no-op when `extraArgs` undefined.
- Schema spec: `extraArgs` accepts string, enforces max length.

## i18n

New keys under the templates/benchmark-create namespaces for the section label, helper
text, example, and the locked-flag warning — zh-CN + en-US, no hard-coded CJK.

## Seed template update (part of this PR)

Update the official prefix-cache aiperf benchmark template(s) in `apps/api/prisma/seed.ts`
to set `extraArgs` disabling thinking:

```
extraArgs: "--extra-inputs chat_template_kwargs:'{\"enable_thinking\":false}'"
```

**Scope: all 5 official prefix-cache aiperf templates** (`scenario: "prefix-cache-validation"`):
`tpl_pc_t1_article`, `tpl_pc_t2_deep`, `tpl_pc_t3_shallow`, `tpl_pc_mooncake_conv`,
`tpl_pc_mooncake_agent`.

These templates exist to measure prefill / prefix-cache behaviour; a model's thinking
output bloats the decode side and pollutes that signal, so thinking is OFF by default for
all of them. Each row is re-validated through `aiperfParamsSchema` (now including
`extraArgs`) before upsert. The flag is a no-op for non-thinking models (e.g.
Qwen2.5-0.5B — the chat template ignores the unused kwarg), so the same template works for
both 0.5B and Qwen3-8B (model/tokenizer come from the connection, not the template).
Editing existing seed rows is an in-place UPDATE on next seed run (upsert) — no migration
needed (seed.ts is the SSOT for built-in templates per CLAUDE.md).

## How 8B thinking-off uses this

Run the mooncake prefix-cache template (now carrying `extraArgs` thinking-off) against the
Qwen3-8B connection, launch one smoke run, confirm the response carries no `<think>` block /
`reasoning_content`, then run the real matrix. (Server-side default-off at deploy time
remains an alternative; either works.)
