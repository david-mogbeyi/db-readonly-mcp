export interface AppConfig {
  readonly databaseUrl: string;
  readonly defaultLimit: number;
  readonly maxLimit: number;
  readonly statementTimeoutMs: number;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const STATEMENT_TIMEOUT_MS = 5000;

export function loadConfig(): AppConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required.');
  }

  return {
    databaseUrl,
    defaultLimit: Number(process.env.DEFAULT_LIMIT) || DEFAULT_LIMIT,
    maxLimit: Number(process.env.MAX_LIMIT) || MAX_LIMIT,
    statementTimeoutMs: Number(process.env.STATEMENT_TIMEOUT_MS) || STATEMENT_TIMEOUT_MS,
  };
}
