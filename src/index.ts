#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createReadonlyPool } from './db.js';
import { createServer } from './server.js';

const config = loadConfig();
const pool = createReadonlyPool(config);

async function logConnectionTarget(): Promise<void> {
  const { rows } = await pool.query<{ db: string; user: string }>(
    `SELECT current_database() AS db, current_user AS user`,
  );
  const [info] = rows;
  console.error(`[db-readonly-mcp] connected as "${info?.user}" to database "${info?.db}"`);
}

async function main(): Promise<void> {
  await logConnectionTarget();
  const server = createServer(pool, config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error('[db-readonly-mcp] fatal error', err);
  process.exit(1);
});
