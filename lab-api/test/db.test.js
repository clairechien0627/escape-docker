const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDb } = require('../lib/db');

function tmpDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lab-api-db-')), 'runs.json');
}

test('insert/list/get round-trip via JSON file', () => {
  const db = createDb(tmpDbPath());

  const runA = { id: 'room2-1', scenario_id: 'room2', status: 'success' };
  const runB = { id: 'room3-1', scenario_id: 'room3', status: 'failed' };
  db.insert(runA);
  db.insert(runB);

  assert.deepStrictEqual(db.get('room2-1'), runA);
  assert.deepStrictEqual(db.get('room3-1'), runB);
  assert.strictEqual(db.get('does-not-exist'), undefined);
});

test('list returns newest-first and supports scenarioId filter', () => {
  const db = createDb(tmpDbPath());
  db.insert({ id: 'a', scenario_id: 'room2' });
  db.insert({ id: 'b', scenario_id: 'room3' });
  db.insert({ id: 'c', scenario_id: 'room2' });

  assert.deepStrictEqual(db.list().map((r) => r.id), ['c', 'b', 'a']);
  assert.deepStrictEqual(db.list({ scenarioId: 'room2' }).map((r) => r.id), ['c', 'a']);
});

test('list on a fresh file returns an empty array', () => {
  const db = createDb(tmpDbPath());
  assert.deepStrictEqual(db.list(), []);
});
