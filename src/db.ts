import { Pool } from 'pg';
import type { AppConfig } from './config.js';

export function createReadonlyPool(config: AppConfig): Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    statement_timeout: config.statementTimeoutMs,
    max: 5,
  });
}
