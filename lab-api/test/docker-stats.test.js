const test = require('node:test');
const assert = require('node:assert');
const { createDockerStats, normalizeStat } = require('../lib/docker-stats');

test('normalizeStat parses CPU/mem percentages and keeps raw usage strings', () => {
  const raw = { CPUPerc: '3.21%', MemUsage: '85MiB / 1.9GiB', MemPerc: '4.37%', NetIO: '1.2kB / 0B', BlockIO: '0B / 0B', PIDs: '12' };

  assert.deepStrictEqual(normalizeStat('escape-falco', raw), {
    name: 'escape-falco',
    cpu_percent: 3.21,
    mem_usage: '85MiB / 1.9GiB',
    mem_percent: 4.37,
    net_io: '1.2kB / 0B',
    block_io: '0B / 0B',
    pids: 12,
  });
});

test('statsFor returns one normalized entry per container, querying docker stats individually', async () => {
  const calls = [];
  const execImpl = (cmd, args, opts, cb) => {
    calls.push(args);
    const name = args[args.length - 1];
    if (name === 'escape-falco') {
      return cb(null, `${JSON.stringify({ CPUPerc: '1.50%', MemUsage: '40MiB / 1.9GiB', MemPerc: '2.10%', NetIO: '0B / 0B', BlockIO: '0B / 0B', PIDs: '8' })}\n`, '');
    }
    return cb(null, `${JSON.stringify({ CPUPerc: '0.05%', MemUsage: '20MiB / 1.9GiB', MemPerc: '1.05%', NetIO: '0B / 0B', BlockIO: '0B / 0B', PIDs: '4' })}\n`, '');
  };

  const dockerStats = createDockerStats({ execImpl });
  const results = await dockerStats.statsFor(['escape-falco', 'lab-api']);

  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(calls[0], ['stats', '--no-stream', '--format', '{{json .}}', 'escape-falco']);
  assert.deepStrictEqual(results.map((r) => r.name), ['escape-falco', 'lab-api']);
  assert.strictEqual(results[0].cpu_percent, 1.50);
  assert.strictEqual(results[1].cpu_percent, 0.05);
});

test('statsFor reports {name, error: "unavailable"} for containers docker cannot find', async () => {
  const execImpl = (cmd, args, opts, cb) => cb(new Error('Error: No such container: room-manager'));

  const dockerStats = createDockerStats({ execImpl });
  const results = await dockerStats.statsFor(['room-manager']);

  assert.deepStrictEqual(results, [{ name: 'room-manager', error: 'unavailable' }]);
});

test('statsFor reports {name, error: "parse_error"} when output is not valid JSON', async () => {
  const execImpl = (cmd, args, opts, cb) => cb(null, 'not json\n', '');

  const dockerStats = createDockerStats({ execImpl });
  const results = await dockerStats.statsFor(['escape-falco']);

  assert.deepStrictEqual(results, [{ name: 'escape-falco', error: 'parse_error' }]);
});
