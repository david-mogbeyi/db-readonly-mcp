export class UnsafeSqlError extends Error {}

// Defense-in-depth only — the actual safety boundary is the DB role's
// SELECT-only grant. This keeps obviously unsafe queries from ever
// reaching the connection, and catches accidental multi-statement input.
const DISALLOWED_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'CREATE',
  'COPY',
  'CALL',
  'EXECUTE',
  'VACUUM',
  'REINDEX',
  'MERGE',
  'ATTACH',
  'DETACH',
  'DO',
  'LISTEN',
  'NOTIFY',
  'SET',
  'RESET',
] as const;

const LEADING_COMMENT_PATTERN = /^(\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*/;

function stripLeadingComments(sql: string): string {
  return sql.replace(LEADING_COMMENT_PATTERN, '');
}

export function validateReadOnlySql(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) {
    throw new UnsafeSqlError('SQL query must not be empty.');
  }

  const withoutTrailingSemicolon = trimmed.endsWith(';') ? trimmed.slice(0, -1) : trimmed;
  if (withoutTrailingSemicolon.includes(';')) {
    throw new UnsafeSqlError('Only a single statement is allowed (no semicolon-separated statements).');
  }

  const body = stripLeadingComments(withoutTrailingSemicolon);
  if (!/^(SELECT|WITH)\b/i.test(body)) {
    throw new UnsafeSqlError('Only SELECT (or WITH ... SELECT) statements are allowed.');
  }

  for (const keyword of DISALLOWED_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(withoutTrailingSemicolon)) {
      throw new UnsafeSqlError(`Disallowed keyword detected: ${keyword}.`);
    }
  }

  return withoutTrailingSemicolon;
}

export function wrapWithLimit(sql: string, limit: number): string {
  return `SELECT * FROM (${sql}) AS _guarded_sub LIMIT ${limit}`;
}
