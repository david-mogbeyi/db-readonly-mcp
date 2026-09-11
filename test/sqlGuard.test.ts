import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UnsafeSqlError, validateReadOnlySql, wrapWithLimit } from '../src/sqlGuard.js';

test('validateReadOnlySql accepts a plain SELECT', () => {
  const sql = 'SELECT * FROM merchants';
  assert.equal(validateReadOnlySql(sql), sql);
});

test('validateReadOnlySql accepts a WITH ... SELECT', () => {
  const sql = 'WITH recent AS (SELECT 1) SELECT * FROM recent';
  assert.equal(validateReadOnlySql(sql), sql);
});

test('validateReadOnlySql strips a single trailing semicolon', () => {
  assert.equal(validateReadOnlySql('SELECT 1;'), 'SELECT 1');
});

test('validateReadOnlySql strips leading comments before checking the statement type', () => {
  const sql = "-- just counting rows\nSELECT count(*) FROM merchants";
  assert.equal(validateReadOnlySql(sql), sql);
});

test('validateReadOnlySql rejects an empty query', () => {
  assert.throws(() => validateReadOnlySql('   '), UnsafeSqlError);
});

test('validateReadOnlySql rejects statements that are not SELECT/WITH', () => {
  assert.throws(() => validateReadOnlySql('UPDATE merchants SET name = 1'), UnsafeSqlError);
});

test('validateReadOnlySql rejects semicolon-stacked statements', () => {
  assert.throws(
    () => validateReadOnlySql('SELECT 1; DROP TABLE merchants'),
    UnsafeSqlError,
  );
});

test('validateReadOnlySql rejects disallowed keywords appearing anywhere in the query', () => {
  assert.throws(() => validateReadOnlySql("SELECT 'GRANT' AS x"), UnsafeSqlError);
  assert.throws(() => validateReadOnlySql('SELECT * FROM merchants RESET ALL'), UnsafeSqlError);
});

test('validateReadOnlySql is case-insensitive for keyword and statement checks', () => {
  assert.equal(validateReadOnlySql('select * from merchants'), 'select * from merchants');
  assert.throws(() => validateReadOnlySql('select * from merchants; drop table merchants'));
});

test('wrapWithLimit wraps the query in a limited subquery', () => {
  assert.equal(
    wrapWithLimit('SELECT * FROM merchants', 50),
    'SELECT * FROM (SELECT * FROM merchants) AS _guarded_sub LIMIT 50',
  );
});
