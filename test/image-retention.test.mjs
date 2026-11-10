import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planRetention,
  applyRetention,
  main,
} from '../scripts/image-retention.mjs';
const id = (n) => 'sha256:' + String(n).padStart(64, '0');
const digest = (n) => String(n).padStart(64, '0');
const ref = (component, n) =>
  'ghcr.io/forever-hotel/hotel-website/' + component + '@sha256:' + digest(n);
const now = Date.now();
function fixture() {
  const images = [1, 2, 3, 4, 5, 6].map((n) => ({
    id: id(n),
    created: new Date(now - 3 * 86400000).toISOString(),
    refs: [ref(n % 2 ? 'backend' : 'frontend', n)],
  }));
  return {
    images,
    now,
    containers: [
      {
        name: 'hotel-website-sample-backend-1',
        image: id(1),
        reference: ref('backend', 1),
        running: true,
      },
      {
        name: 'hotel-website-sample-frontend-1',
        image: id(2),
        reference: ref('frontend', 2),
        running: true,
      },
    ],
    receipts: {
      hw: {
        status: 'released',
        images: {
          'hw-backend': ref('backend', 1),
          'hw-frontend': ref('frontend', 2),
        },
        baseline: { 'hw-backend': id(3), 'hw-frontend': id(4) },
      },
    },
  };
}
test('retains current and previous healthy images, selecting only older owned versions', () => {
  const plan = planRetention(fixture());
  assert.deepEqual(
    plan.candidates.map((x) => x.id),
    [id(5), id(6)],
  );
  for (const value of [1, 2, 3, 4])
    assert.ok(plan.protectedIds.includes(id(value)));
});
test('protects all containers, including unrelated stopped containers', () => {
  const data = fixture();
  data.containers.push({ name: 'manual-old', image: id(5), running: false });
  assert.deepEqual(
    planRetention(data).candidates.map((x) => x.id),
    [id(6)],
  );
});
test('preserves fresh, untagged, third-party and mixed-ownership images', () => {
  const data = fixture();
  data.images.push(
    {
      id: id(7),
      refs: [ref('backend', 7)],
      created: new Date(now - 1000).toISOString(),
    },
    { id: id(8), refs: [], created: new Date(0).toISOString() },
    { id: id(9), refs: ['caddy:2-alpine'], created: new Date(0).toISOString() },
    {
      id: id(10),
      refs: [ref('backend', 10), 'other/team:stable'],
      created: new Date(0).toISOString(),
    },
  );
  assert.deepEqual(
    planRetention(data).candidates.map((x) => x.id),
    [id(5), id(6)],
  );
});
for (const mode of [
  'missing',
  'failed',
  'same',
  'stale',
  'unavailable',
  'wrong-package',
])
  test(mode + ' rollback evidence skips the whole service', () => {
    const data = fixture();
    if (mode === 'missing') delete data.receipts.hw;
    if (mode === 'failed') data.receipts.hw.status = 'failed_rolled_back';
    if (mode === 'same') data.receipts.hw.baseline['hw-backend'] = id(1);
    if (mode === 'stale')
      data.receipts.hw.images['hw-backend'] = ref('backend', 99);
    if (mode === 'unavailable')
      data.images = data.images.filter((x) => x.id !== id(3));
    if (mode === 'wrong-package')
      data.images.find((x) => x.id === id(3)).refs = [
        'ghcr.io/other/repo@sha256:' + digest(3),
      ];
    const plan = planRetention(data);
    assert.equal(plan.candidates.length, 0);
    assert.ok(plan.skipped.includes('hw'));
  });
test('invalid age policy cannot disable the minimum grace period', () => {
  assert.throws(() => planRetention({ ...fixture(), minAgeMs: 0 }));
});
function adapterFor(plan) {
  const available = new Map(
    plan.candidates.flatMap((image) => [
      [image.id, image],
      ...image.refs.map((ref) => [ref, image]),
    ]),
  );
  const removed = [];
  return {
    removed,
    available,
    adapter: {
      usedImages: async () => [],
      inspect: async (ref) => available.get(ref) || null,
      remove: async (ref) => {
        removed.push(ref);
        const image = available.get(ref);
        available.delete(ref);
        if (!image.refs.some((r) => available.has(r)))
          available.delete(image.id);
      },
    },
  };
}
test('apply removes explicit references and does not use forced or broad prune operations', async () => {
  const plan = planRetention(fixture());
  const f = adapterFor(plan);
  const result = await applyRetention(plan, f.adapter);
  assert.deepEqual(result.removed, [id(5), id(6)]);
  assert.deepEqual(
    f.removed,
    plan.candidates.flatMap((x) => x.refs),
  );
});
test('apply rechecks container use, changed refs and moved tags', async () => {
  const plan = planRetention(fixture());
  const used = adapterFor(plan);
  used.adapter.usedImages = async () => [id(5), id(6)];
  await applyRetention(plan, used.adapter);
  assert.equal(used.removed.length, 0);
  const changed = adapterFor(plan);
  changed.adapter.inspect = async () => ({ id: id(5), refs: ['changed'] });
  await applyRetention(plan, changed.adapter);
  assert.equal(changed.removed.length, 0);
  const moved = adapterFor(plan);
  const inspect = moved.adapter.inspect;
  moved.adapter.inspect = async (ref) =>
    ref.startsWith('ghcr') ? { id: id(1), refs: [] } : inspect(ref);
  await applyRetention(plan, moved.adapter);
  assert.equal(moved.removed.length, 0);
});
function entryFixture() {
  const locks = new Set();
  const data = fixture();
  let deletions = 0;
  const io = {
    readFile: async (path) =>
      path.endsWith('host.json')
        ? JSON.stringify({
            environment: 'staging',
            adoptionApproved: true,
            stateDirectory: '/opt/forever-hotel/.infra-release',
            sampleLock:
              '/opt/hotel-website-staging/.sample-release/release.lock',
          })
        : JSON.stringify(data.receipts.hw),
    open: async (path) => {
      locks.add(path);
      return { writeFile: async () => {}, close: async () => {} };
    },
    unlink: async (path) => locks.delete(path),
    snapshot: async () => data,
    adapter: {
      ...adapterFor(planRetention(data)).adapter,
      remove: async () => {
        deletions++;
      },
    },
  };
  return { io, locks, deletions: () => deletions };
}
test('dry-run takes the same locks and never deletes images', async () => {
  const f = entryFixture();
  const plan = await main(['--dry-run'], f.io);
  assert.equal(plan.candidates.length, 2);
  assert.equal(f.deletions(), 0);
  assert.equal(f.locks.size, 0);
});
test('busy deployment lock prevents cleanup and releases only its own acquired lock', async () => {
  const f = entryFixture();
  let acquired = 0;
  const original = f.io.open;
  f.io.open = async (...args) => {
    if (acquired++ === 1)
      throw Object.assign(Error('busy'), { code: 'EEXIST' });
    return original(...args);
  };
  await assert.rejects(main(['--apply'], f.io));
  assert.equal(f.deletions(), 0);
  assert.equal(f.locks.size, 0);
  assert.throws(() =>
    planRetention({ images: null, containers: [], receipts: {} }),
  );
  await assert.rejects(main(['invalid'], f.io));
});

import { inventoryAdapter } from '../scripts/image-retention.mjs';
test('Docker inventory drops environment data and deletion uses explicit references without force', async () => {
  const data = fixture();
  const calls = [];
  const source = inventoryAdapter((...args) => {
    calls.push(args);
    if (args[0] === 'ps') return 'container-id';
    if (args[0] === 'inspect')
      return JSON.stringify([
        {
          Name: '/hotel-website-sample-backend-1',
          Image: id(1),
          Config: { Image: ref('backend', 1), Env: ['PRIVATE=not-for-output'] },
          State: { Running: true },
        },
      ]);
    if (args[0] === 'image' && args[1] === 'ls') return id(1) + '\n' + id(1);
    if (args[0] === 'image' && args[1] === 'inspect')
      return JSON.stringify([
        {
          Id: id(1),
          Created: data.images[0].created,
          RepoDigests: [ref('backend', 1)],
          Config: { Env: ['PRIVATE=not-for-output'] },
        },
      ]);
    return '';
  });
  const snapshot = source.snapshot(data.receipts);
  assert.equal(snapshot.images.length, 1);
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
  assert.deepEqual(await source.adapter.usedImages(), [id(1)]);
  assert.equal((await source.adapter.inspect(id(1))).id, id(1));
  await source.adapter.remove(ref('backend', 5));
  assert.deepEqual(calls.at(-1), [
    'image',
    'rm',
    '--no-prune',
    ref('backend', 5),
  ]);
  const empty = inventoryAdapter(() => '');
  assert.deepEqual(empty.snapshot({}).images, []);
  assert.deepEqual(await empty.adapter.usedImages(), []);
  const missing = inventoryAdapter(() => {
    throw Object.assign(Error('missing'), { stderr: 'No such image' });
  });
  assert.equal(await missing.adapter.inspect('missing'), null);
  const denied = inventoryAdapter(() => {
    throw Object.assign(Error('denied'), { stderr: 'permission denied' });
  });
  await assert.rejects(denied.adapter.inspect(id(1)));
});

test('interruption stops before removal and apply entry always releases locks', async () => {
  const plan = planRetention(fixture());
  const f = adapterFor(plan);
  await assert.rejects(
    applyRetention(plan, f.adapter, () => true),
    /interrupted/,
  );
  assert.equal(f.removed.length, 0);
  const entry = entryFixture();
  await main(['--apply'], entry.io);
  assert.equal(entry.deletions(), 2);
  assert.equal(entry.locks.size, 0);
  const denied = entryFixture();
  const read = denied.io.readFile;
  denied.io.readFile = async (...args) =>
    args[0].endsWith('host.json')
      ? JSON.stringify({ environment: 'production' })
      : read(...args);
  await assert.rejects(main(['--apply'], denied.io), /Approved staging/);
  assert.equal(denied.deletions(), 0);
});
