#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { createReadonlyPool } from './db.js';
import { UnsafeSqlError, validateReadOnlySql, wrapWithLimit } from './sqlGuard.js';

const config = loadConfig();
const pool = createReadonlyPool(config);

async function logConnectionTarget(): Promise<void> {
  const { rows } = await pool.query<{ db: string; user: string }>(
    `SELECT current_database() AS db, current_user AS user`,
  );
  const [info] = rows;
  console.error(`[db-readonly-mcp] connected as "${info?.user}" to database "${info?.db}"`);
}

const server = new McpServer({ name: 'db-readonly-mcp', version: '0.1.0' });

server.registerTool(
  'list_tables',
  {
    title: 'List tables',
    description: 'List tables in the public schema.',
    inputSchema: {},
  },
  async () => {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
  },
);

server.registerTool(
  'describe_table',
  {
    title: 'Describe table',
    description: 'List columns, types, nullability, and defaults for a table in the public schema.',
    inputSchema: { table: z.string().min(1) },
  },
  async ({ table }) => {
    const { rows } = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [table],
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }] };
  },
);

server.registerTool(
  'query_readonly',
  {
    title: 'Query (read-only)',
    description:
      `Run a single read-only SELECT (or WITH ... SELECT) query. Results are always capped at ` +
      `${config.maxLimit} rows regardless of the requested limit. The underlying DB connection only ` +
      `has SELECT privileges, so writes fail at the database level even if they slip past validation.`,
    inputSchema: {
      sql: z
        .string()
        .min(1)
        .describe('A single SELECT (or WITH ... SELECT) statement. No trailing semicolon needed.'),
      limit: z.number().int().positive().max(config.maxLimit).optional(),
    },
  },
  async ({ sql, limit }) => {
    try {
      const safeSql = validateReadOnlySql(sql);
      const cappedLimit = Math.min(limit ?? config.defaultLimit, config.maxLimit);
      const wrappedSql = wrapWithLimit(safeSql, cappedLimit);
      const { rows, rowCount } = await pool.query(wrappedSql);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ rowCount, rows }, null, 2) }] };
    } catch (err) {
      if (err instanceof UnsafeSqlError) {
        return {
          content: [{ type: 'text' as const, text: `Query rejected: ${err.message}` }],
          isError: true,
        };
      }
      throw err;
    }
  },
);

async function main(): Promise<void> {
  await logConnectionTarget();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error('[db-readonly-mcp] fatal error', err);
  process.exit(1);
});
