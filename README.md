# db-readonly-mcp

[![M8ven Score](https://m8ven.ai/badge/mcp/david-mogbeyi-db-readonly-mcp-1wuvzv?v=38f4d0332b81617aa0e1c8bd3fb3cf08)](https://m8ven.ai/mcp/david-mogbeyi-db-readonly-mcp-1wuvzv)

An [MCP](https://modelcontextprotocol.io) server that gives an AI assistant (Claude
Code, Claude Desktop, or any other MCP client) guarded, **read-only** access to a
Postgres database. Ask something like "get me all merchants created yesterday" and
the assistant writes the SQL and runs it through this server, which enforces that the
query can only ever read data.

Postgres only — no other databases are supported.

## Why this exists

Letting an assistant query your database directly is genuinely useful for debugging,
data exploration, and answering "how many X" questions without writing a script every
time. The risk is obvious: an LLM can hallucinate or be prompted into writing a
destructive query. This server exists to make that risk close to zero, with several
independent layers of protection rather than relying on any single one.

## Safety model

Layered, in order of how much they're actually trusted:

1. **DB role** — the connection uses a dedicated Postgres role with `SELECT`-only
   grants. This is the real boundary: even if every other layer were bypassed, the
   role can't write.
2. **Query validation** — rejects anything that isn't a single `SELECT`/`WITH ...
   SELECT` statement (no semicolon-stacked statements, no DDL/DML keywords).
3. **Enforced `LIMIT`** — every query is wrapped in `SELECT * FROM (...) LIMIT N`,
   capped at `MAX_LIMIT` regardless of what's requested.
4. **`statement_timeout`** — queries are killed after `STATEMENT_TIMEOUT_MS`.
5. **Startup log** — logs the connected database/user to stderr on boot, so it's
   obvious which DB you're pointed at before any query runs.

**Only ever point this server at a dev/test/staging database — never at
production.** Layers 2-5 are defense in depth; layer 1 (the DB role) is the only
layer you should actually trust, and even that shouldn't be trusted with prod data.

## Requirements

- Node.js >= 20
- A Postgres database you can create a role on
- An MCP client (e.g. [Claude Code](https://docs.claude.com/en/docs/claude-code),
  Claude Desktop, or any other client that supports MCP servers over stdio)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/david-mogbeyi/db-readonly-mcp.git
cd db-readonly-mcp
npm install
```

### 2. Create the read-only role

Run this against your target Postgres database — replace the role name, password,
database name, and schema/owner if your app uses something other than `public`:

```sql
CREATE ROLE myapp_readonly WITH LOGIN PASSWORD '<choose-a-password>';
GRANT CONNECT ON DATABASE myapp TO myapp_readonly;
GRANT USAGE ON SCHEMA public TO myapp_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO myapp_readonly;

-- Keeps future tables (new migrations) readable automatically, without
-- re-running this grant every time the schema changes.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO myapp_readonly;
```

If your schema isn't `public`, or you have multiple schemas, repeat the `GRANT
USAGE`/`GRANT SELECT`/`ALTER DEFAULT PRIVILEGES` lines for each one. This server
currently only queries the `public` schema for `list_tables`/`describe_table`, but
`query_readonly` can reference any schema the role has been granted access to.

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env` and set `DATABASE_URL` to the readonly role's connection string:

```bash
DATABASE_URL=postgresql://myapp_readonly:<password>@localhost:5432/myapp
```

See [Configuration](#configuration) below for the other variables.

### 4. Build

```bash
npm run build
```

This compiles `src/` to `dist/` via `tsc`. Re-run it after pulling changes or editing
source.

## Register with an MCP client

### Claude Code

In the project you want to query from, add an `.mcp.json` (or edit your existing
one):

```json
{
  "mcpServers": {
    "db-readonly": {
      "command": "node",
      "args": ["/absolute/path/to/db-readonly-mcp/dist/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://myapp_readonly:<password>@localhost:5432/myapp"
      }
    }
  }
}
```

Replace `/absolute/path/to/db-readonly-mcp` with wherever you cloned this repo.
Restart Claude Code (or reconnect MCP servers) to pick it up.

You can also register it globally rather than per-project — see the [Claude Code MCP
docs](https://docs.claude.com/en/docs/claude-code/mcp) for `claude mcp add` and scope
options.

### Claude Desktop / other MCP clients

Any client that supports MCP servers over stdio can use this the same way: point it
at `node /absolute/path/to/db-readonly-mcp/dist/index.js` with `DATABASE_URL` (and
optionally the other env vars below) set in its environment. See your client's docs
for where its MCP server config lives — for Claude Desktop this is
`claude_desktop_config.json`, using the same `command`/`args`/`env` shape as above.

## Configuration

All configuration is via environment variables (set in `.env` for local runs, or in
the `env` block of your MCP client config).

| Variable                | Required | Default | Description                                                              |
| ------------------------ | :------: | :-----: | -------------------------------------------------------------------------- |
| `DATABASE_URL`           |    Yes   |    —    | Postgres connection string for the read-only role.                       |
| `DEFAULT_LIMIT`          |    No    |   100   | Row limit applied when a query doesn't specify one.                      |
| `MAX_LIMIT`              |    No    |   1000  | Hard ceiling on rows returned, regardless of what's requested.           |
| `STATEMENT_TIMEOUT_MS`   |    No    |   5000  | Postgres `statement_timeout` for every query, in milliseconds.           |

## Tools

The server exposes three tools to the assistant:

### `list_tables`

Lists tables in the `public` schema. No arguments.

```json
→ [
    { "table_name": "merchants" },
    { "table_name": "orders" },
    ...
  ]
```

### `describe_table(table)`

Columns, types, nullability, and defaults for a table in the `public` schema.

```json
{ "table": "merchants" }
→ [
    { "column_name": "id", "data_type": "uuid", "is_nullable": "NO", "column_default": "gen_random_uuid()" },
    { "column_name": "created_at", "data_type": "timestamp with time zone", "is_nullable": "NO", "column_default": "now()" },
    ...
  ]
```

### `query_readonly(sql, limit?)`

Runs a single guarded `SELECT` (or `WITH ... SELECT`) statement. `limit` is optional
and capped at `MAX_LIMIT` even if a larger value is passed.

```json
{ "sql": "SELECT id, name, created_at FROM merchants WHERE created_at > now() - interval '1 day'" }
→ { "rowCount": 3, "rows": [ { "id": "...", "name": "...", "created_at": "..." }, ... ] }
```

Anything that isn't a single `SELECT`/`WITH` statement — multiple statements, DDL,
DML, `SET`, etc. — is rejected before it reaches the database, with an explanation of
why.

## Local development

```bash
npm run dev   # runs src/index.ts directly via tsx, loads .env via Node's --env-file
npm test      # runs the test suite (no database required)
```

### Project structure

```
src/
  index.ts    # entrypoint: loads config, opens the pool, connects the stdio transport
  server.ts   # MCP server setup and tool definitions (readOnly/destructive/idempotent/openWorld hints)
  sqlGuard.ts # query validation (layer 2 of the safety model)
  db.ts       # Postgres pool setup (statement_timeout, pool size)
  config.ts   # env var loading/validation
test/
  *.test.ts   # unit tests for sqlGuard/config, and tool-level tests against server.ts using
              # an in-memory MCP client/server pair with a fake pg Pool (no real database needed)
```

## Troubleshooting

- **"DATABASE_URL environment variable is required"** — `.env` is missing or not
  being loaded; confirm it exists (from `cp .env.example .env`) and that your MCP
  client's `env` block or `npm run dev`/`npm start` is picking it up.
- **Server logs the wrong database/user on startup** — check `DATABASE_URL`; the
  startup log (`connected as "..." to database "..."`) is printed specifically so
  this is easy to catch before any query runs.
- **"Query rejected: ..."** — the query either wasn't a single `SELECT`/`WITH`
  statement or contained a disallowed keyword. This is layer 2 of the safety model
  working as intended, not a bug.
- **Query hangs then errors** — likely hitting `STATEMENT_TIMEOUT_MS`; raise it in
  `.env` if your workload legitimately needs longer, or optimize the query.

## Contributing

Issues and PRs welcome. This is intentionally a small, auditable tool — the goal is
to keep the safety model simple enough to read in full, not to grow it into a general
query builder.

## License

[MIT](LICENSE)
