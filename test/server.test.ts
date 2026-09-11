import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool, QueryResult, QueryResultRow } from 'pg';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AppConfig } from '../src/config.js';
import { createServer } from '../src/server.js';

const TEST_CONFIG: AppConfig = {
  databaseUrl: 'postgresql://test@localhost/test',
  defaultLimit: 100,
  maxLimit: 1000,
  statementTimeoutMs: 5000,
};

type FakeQuery = (sql: string, params?: unknown[]) => Promise<Partial<QueryResult<QueryResultRow>>>;

function fakePool(query: FakeQuery): Pool {
  return { query } as unknown as Pool;
}

async function connectedClient(pool: Pool, config: AppConfig = TEST_CONFIG): Promise<Client> {
  const server = createServer(pool, config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

test('every registered tool declares all four annotation hints', async () => {
  const client = await connectedClient(fakePool(async () => ({ rows: [], rowCount: 0 })));
  const { tools } = await client.listTools();

  assert.equal(tools.length, 3);
  for (const tool of tools) {
    assert.ok(tool.annotations, `${tool.name} is missing annotations`);
    assert.equal(typeof tool.annotations?.readOnlyHint, 'boolean', `${tool.name}.readOnlyHint`);
    assert.equal(typeof tool.annotations?.destructiveHint, 'boolean', `${tool.name}.destructiveHint`);
    assert.equal(typeof tool.annotations?.idempotentHint, 'boolean', `${tool.name}.idempotentHint`);
    assert.equal(typeof tool.annotations?.openWorldHint, 'boolean', `${tool.name}.openWorldHint`);
    assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} should be marked read-only`);
    assert.equal(tool.annotations?.destructiveHint, false, `${tool.name} should not be destructive`);
  }
});

test('list_tables returns the rows from the pool', async () => {
  const client = await connectedClient(
    fakePool(async (sql) => {
      assert.match(sql, /information_schema\.tables/);
      return { rows: [{ table_name: 'merchants' }, { table_name: 'orders' }] };
    }),
  );

  const result = await client.callTool({ name: 'list_tables', arguments: {} });
  assert.equal(result.isError, undefined);
  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.deepEqual(JSON.parse(text), [{ table_name: 'merchants' }, { table_name: 'orders' }]);
});

test('describe_table passes the table name through as a parameter', async () => {
  const client = await connectedClient(
    fakePool(async (sql, params) => {
      assert.match(sql, /information_schema\.columns/);
      assert.deepEqual(params, ['merchants']);
      return { rows: [{ column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: null }] };
    }),
  );

  const result = await client.callTool({ name: 'describe_table', arguments: { table: 'merchants' } });
  assert.equal(result.isError, undefined);
  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.deepEqual(JSON.parse(text), [
    { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
  ]);
});

test('query_readonly wraps the query with the configured default limit', async () => {
  let receivedSql = '';
  const client = await connectedClient(
    fakePool(async (sql) => {
      receivedSql = sql;
      return { rows: [{ id: 1 }], rowCount: 1 };
    }),
    { ...TEST_CONFIG, defaultLimit: 25 },
  );

  const result = await client.callTool({
    name: 'query_readonly',
    arguments: { sql: 'SELECT id FROM merchants' },
  });

  assert.equal(result.isError, undefined);
  assert.equal(receivedSql, 'SELECT * FROM (SELECT id FROM merchants) AS _guarded_sub LIMIT 25');
  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.deepEqual(JSON.parse(text), { rowCount: 1, rows: [{ id: 1 }] });
});

test('query_readonly rejects a requested limit above maxLimit at the schema level', async () => {
  const client = await connectedClient(
    fakePool(async () => {
      throw new Error('pool.query should not be called for an out-of-range limit');
    }),
    { ...TEST_CONFIG, maxLimit: 50 },
  );

  const result = await client.callTool({
    name: 'query_readonly',
    arguments: { sql: 'SELECT 1', limit: 10000 },
  });
  assert.equal(result.isError, true);
});

test('query_readonly honors an explicit limit within range', async () => {
  let receivedSql = '';
  const client = await connectedClient(
    fakePool(async (sql) => {
      receivedSql = sql;
      return { rows: [], rowCount: 0 };
    }),
    { ...TEST_CONFIG, maxLimit: 50 },
  );

  await client.callTool({
    name: 'query_readonly',
    arguments: { sql: 'SELECT 1', limit: 10 },
  });

  assert.match(receivedSql, /LIMIT 10$/);
});

test('query_readonly rejects unsafe SQL without touching the pool', async () => {
  const client = await connectedClient(
    fakePool(async () => {
      throw new Error('pool.query should not be called for rejected SQL');
    }),
  );

  const result = await client.callTool({
    name: 'query_readonly',
    arguments: { sql: 'DROP TABLE merchants' },
  });

  assert.equal(result.isError, true);
  const text = (result.content as Array<{ type: string; text: string }>)[0].text;
  assert.match(text, /Query rejected/);
});
