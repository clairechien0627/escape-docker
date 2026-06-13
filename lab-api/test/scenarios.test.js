const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { loadScenarios } = require('../lib/scenarios');

const SCENARIOS_DIR = path.join(__dirname, '..', '..', 'lab', 'scenarios');

test('loadScenarios loads all 15 scenarios', () => {
  const scenarios = loadScenarios(SCENARIOS_DIR);
  assert.strictEqual(scenarios.length, 15);
});

test('loadScenarios orders room0..room11, final, secret-a, secret-b', () => {
  const scenarios = loadScenarios(SCENARIOS_DIR);
  const ids = scenarios.map((s) => s.id);
  assert.deepStrictEqual(ids, [
    'room0', 'room1', 'room2', 'room3', 'room4', 'room5', 'room6', 'room7',
    'room8', 'room9', 'room10', 'room11', 'final', 'secret-a', 'secret-b',
  ]);
});

test('each scenario has the fields lab-api relies on', () => {
  const scenarios = loadScenarios(SCENARIOS_DIR);
  for (const scenario of scenarios) {
    assert.strictEqual(typeof scenario.id, 'string');
    assert.strictEqual(typeof scenario.container, 'string');
    assert.strictEqual(typeof scenario.exploit_script, 'string');
    assert.ok(scenario.exploit_script.startsWith('exploits/'));
  }
});
