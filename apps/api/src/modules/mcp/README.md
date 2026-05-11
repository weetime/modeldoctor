# MCP module

Exposes ModelDoctor capabilities as [Model Context Protocol](https://modelcontextprotocol.io)
tools for use from Claude Code / Cursor / any MCP-compatible client.

## Why mounted inside `apps/api` (not a separate package)

The [Roadmap MCP standard #132](https://github.com/weetime/modeldoctor/issues/132)
originally specified a standalone `apps/mcp-server/` package with stdio
transport. We deviated for V1 because:

- ModelDoctor is single-user / local-only (per Roadmap §不做: "MCP server
  仅 localhost / 内网"). Stateless HTTP transport works fine.
- Reusing the existing NestJS DI gives us Prisma access, encryption keys,
  rate limiting, `DiscoveryService`, etc. for free — a standalone package
  would have to re-bootstrap all of it.
- Adding a new tool is now ~30 lines (one `tools/*.tool.ts` file) instead
  of duplicating service code across two packages.

If we ever ship multi-tenant SaaS, splitting MCP into its own deployable
process is a follow-up — the tool wrappers themselves are framework-agnostic.

## Auth (V1)

MCP requests are NOT authenticated with the rotating 15-minute JWT — that's
too short for a config file. Instead, set both env vars and put the
matching `Authorization: Bearer …` in your MCP client config:

```bash
# apps/api/.env
MCP_BEARER_TOKEN=$(openssl rand -base64 48)
MCP_USER_ID=cmoz...                 # `SELECT id FROM users WHERE email='you@example.com'`
```

Without both vars, the route returns 503. Every tool call runs as
`MCP_USER_ID` — scope your queries accordingly if your single-user
deployment ever grows.

## Claude Code config

`~/.config/claude/mcp.json` (or equivalent per-project setting):

```json
{
  "mcpServers": {
    "modeldoctor": {
      "type": "http",
      "url": "http://localhost:3001/api/mcp",
      "headers": {
        "Authorization": "Bearer <paste MCP_BEARER_TOKEN here>"
      }
    }
  }
}
```

Restart Claude Code; the 4 tools below show up under "modeldoctor".

## Tools (V1)

| Tool | Use case |
|---|---|
| `discover_connection(baseUrl, apiKey?, customHeaders?)` | Probe an inference endpoint; returns inferred serverKind / models / category / suggested tags / prometheusUrl. Pre-fill for new connections. |
| `list_connections()` | Read the saved connection library. Returns id, name, baseUrl, model, category, tags, serverKind, prometheusUrl. apiKey is NEVER returned. |
| `list_benchmarks(limit?, status?, connectionId?, cursor?)` | List benchmark runs newest-first. Cursor pagination. |
| `run_diagnostics(connectionId, probes?)` | Run endpoint probes (chat-text / embeddings / rerank / image-* / audio-*) and return per-probe pass/fail. Synchronous. |

## Adding a new tool

1. Create `tools/<name>.tool.ts` with a `register<Name>(server, deps)`
   function that calls `server.registerTool(…)`.
2. Register it in `mcp.service.ts` next to the existing four.
3. If you need a service that isn't already in `McpToolDeps`, add it
   there and import its module in `mcp.module.ts`'s `imports:`.
4. Unit test under `tools/<name>.tool.spec.ts` with mocked deps.

The tool wrapper should be a *thin* delegate — keep business logic in
the underlying NestJS service so the REST endpoint and the MCP tool stay
in sync.
