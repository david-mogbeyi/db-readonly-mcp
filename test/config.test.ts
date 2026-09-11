import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const ENV_KEYS = ['DATABASE_URL', 'DEFAULT_LIMIT', 'MAX_LIMIT', 'STATEMENT_TIMEOUT_MS'] as const;

function withEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => void): void {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of ENV_KEYS) {
      if (overrides[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = overrides[key];
      }
    }
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

test('loadConfig throws when DATABASE_URL is missing', () => {
  withEnv({}, () => {
    assert.throws(() => loadConfig(), /DATABASE_URL/);
  });
});

test('loadConfig applies defaults when optional vars are unset', () => {
  withEnv({ DATABASE_URL: 'postgresql://user@localhost/db' }, () => {
    const config = loadConfig();
    assert.equal(config.databaseUrl, 'postgresql://user@localhost/db');
    assert.equal(config.defaultLimit, 100);
    assert.equal(config.maxLimit, 1000);
    assert.equal(config.statementTimeoutMs, 5000);
  });
});

test('loadConfig honors overrides for optional vars', () => {
  withEnv(
    {
      DATABASE_URL: 'postgresql://user@localhost/db',
      DEFAULT_LIMIT: '10',
      MAX_LIMIT: '50',
      STATEMENT_TIMEOUT_MS: '2000',
    },
    () => {
      const config = loadConfig();
      assert.equal(config.defaultLimit, 10);
      assert.equal(config.maxLimit, 50);
      assert.equal(config.statementTimeoutMs, 2000);
    },
  );
});
