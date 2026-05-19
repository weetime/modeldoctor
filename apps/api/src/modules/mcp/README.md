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

Restart Claude Code; the tools below show up under "modeldoctor".

## Tools (V1)

### Connections / benchmarks / diagnostics

| Tool | Use case |
|---|---|
| `discover_connection(baseUrl, apiKey?, customHeaders?)` | Probe an inference endpoint; returns inferred serverKind / models / category / suggested tags / prometheusUrl. Pre-fill for new connections. |
| `list_connections()` | Read the saved connection library. Returns id, name, baseUrl, model, category, tags, serverKind, prometheusDatasource. apiKey is NEVER returned. |
| `list_benchmarks(limit?, status?, connectionId?, cursor?)` | List benchmark runs newest-first. Cursor pagination. |
| `run_diagnostics(connectionId, probes?)` | Run endpoint probes (chat-text / embeddings / rerank / image-* / audio-*) and return per-probe pass/fail. Synchronous. |

### Notification channels + event subscriptions

| Tool | Use case |
|---|---|
| `list_channels()` | List the caller's notification channels (email / webhook). |
| `create_channel(name, type, target, ...)` | Create a new notification channel. |
| `test_channel(channelId)` | Send a test notification to a channel. |
| `subscribe(channelId, eventType, connectionId?)` | Subscribe a channel to a workflow event (`benchmark.completed` / `benchmark.failed` / `diagnostics.failed`), optionally connection-scoped. |
| `unsubscribe(subscriptionId)` | Remove an event-type subscription. |

### Alerts loop (Alertmanager → AI explanation → channel)

| Tool | Use case |
|---|---|
| `list_alerts(connectionId?, status?, severity?, limit?, cursor?)` | List alerts attributed to one of the caller's Connections, newest first. Returns a slim row per alert (`rawPayload` / full labels stripped to protect the LLM context window) plus a `nextCursor` for pagination. Includes the AI narrative when already generated. Use `get_alert_explanation(id)` for full per-alert detail. |
| `get_alert_explanation(alertId)` | Fetch a single alert + its AI narrative + recommendations + ai severity (null when the explainer hasn't run yet). |
| `subscribe_connection(connectionId, channelId, minSeverity?, enabled?)` | Route alerts for a Connection to a notification channel, gated by minimum severity. Distinct from `subscribe` (event types) — this drives the alerts pipeline specifically. |

### Prometheus datasources

| Tool | Use case |
|---|---|
| `list_prometheus_datasources()` | List every Prometheus datasource configured in ModelDoctor. The row with `isDefault=true` is the one new connections (kind ∈ {model, gateway}) auto-bind to. `bearerToken` is NEVER returned — only `bearerPreview`. |
| `set_connection_prometheus_source(connectionId, datasourceId?)` | Bind / rebind / unbind a connection's Prometheus datasource. `datasourceId='<id>'` binds explicitly, `datasourceId=null` unbinds, omit the field to fall back to the current default. Connections with `kind=alertmanager` must stay unbound. |

#### `list_prometheus_datasources`

Input: none.

Output (`structuredContent`):

```ts
{
  items: Array<{
    id: string;
    name: string;
    baseUrl: string;
    bearerPreview: string;     // "abc...wxyz" or "" — never the raw token
    isDefault: boolean;        // exactly one row should be true once seeded
    consumersCount: number;    // how many Connections currently point at this id
  }>;
}
```

Example — *"Which Prometheus is the default one?"*

```jsonc
// tool call
{ "tool": "list_prometheus_datasources", "args": {} }

// response (structuredContent)
{
  "items": [
    {
      "id": "ds_01h…",
      "name": "primary",
      "baseUrl": "https://prom.internal.example.com",
      "bearerPreview": "abc...wxyz",
      "isDefault": true,
      "consumersCount": 4
    }
  ]
}
```

#### `set_connection_prometheus_source`

Input:

```ts
{
  connectionId: string;            // from list_connections
  datasourceId?: string | null;    // omit → use current default; null → unbind
}
```

Output (`structuredContent`): the updated connection's binding fields.

```ts
{
  id: string;
  name: string;
  kind: "model" | "gateway" | "alertmanager";
  prometheusDatasourceId: string | null;
  prometheusDatasource: { id: string; name: string; baseUrl: string } | null;
}
```

Example — *"Point my gpt-4o connection at the secondary Prometheus."*

```jsonc
// tool call
{
  "tool": "set_connection_prometheus_source",
  "args": { "connectionId": "conn_…", "datasourceId": "ds_secondary" }
}

// response (structuredContent)
{
  "id": "conn_…",
  "name": "gpt-4o-prod",
  "kind": "model",
  "prometheusDatasourceId": "ds_secondary",
  "prometheusDatasource": {
    "id": "ds_secondary",
    "name": "secondary",
    "baseUrl": "https://prom-2.internal.example.com"
  }
}
```

Passing `datasourceId: null` unbinds the connection (downstream engine-metrics / benchmark adapters will see `prometheusUrl = null`). Passing a `connectionId` whose `kind=alertmanager` rejects with a Bad Request — alertmanager connections must not carry a Prometheus binding.

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
