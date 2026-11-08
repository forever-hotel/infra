import test from 'node:test';
import assert from 'node:assert/strict';
import { services, validateManifest, validateHost, override, changedServices } from '../scripts/contracts.mjs';
import { rollout } from '../scripts/release.mjs';
import { verifySource, verifyRelease } from '../scripts/verify-github.mjs';

function manifest(byte = 'a') {
  return { version: 1, services: Object.fromEntries(Object.entries(services).map(([name, [repo, component]]) =>
    [name, { image: `ghcr.io/forever-hotel/${repo}${component ? '/' + component : ''}@sha256:${byte.repeat(64)}`, commit: byte.repeat(40) }])) };
}
function fixture(failure) {
  const calls = [];
  const adapter = Object.fromEntries(['empty', 'baseline', 'prepare', 'start', 'smoke', 'accept', 'restore', 'stop'].map(name => [name, async () => {
    calls.push(name);
    if (failure?.(name, calls)) throw new Error('simulated adapter failure');
  }]));
  return { calls, adapter };
}

test('accepts only approved immutable image repositories and paired commits', () => {
  assert.equal(validateManifest(manifest()).version, 1);
  for (const image of ['ghcr.io/forever-hotel/manager-dashboard/backend:latest',
    `ghcr.io/attacker/manager-dashboard/backend@sha256:${'a'.repeat(64)}`]) {
    const value = manifest(); value.services['mad-backend'].image = image;
    assert.throws(() => validateManifest(value));
  }
  const value = manifest(); value.services['mad-frontend'].commit = 'b'.repeat(40);
  assert.throws(() => validateManifest(value), /same commit/);
});
test('rejects missing, extra and unknown manifest data', () => {
  const missing = manifest(); delete missing.services.gateway;
  assert.throws(() => validateManifest(missing));
  assert.throws(() => validateManifest({ ...manifest(), commands: 'arbitrary command' }));
  const extra = manifest(); extra.services.gateway.command = 'arbitrary command';
  assert.throws(() => validateManifest(extra));
});
test('override contains only explicit image replacements', () => {
  assert.deepEqual(override(manifest()).services.gateway, { image: manifest().services.gateway.image });
  assert.deepEqual(changedServices(manifest(), manifest()), []);
});
test('smoke requires all seven distinct HTTPS targets without credentials', () => {
  const value = { smoke: ['mad', 'fds', 'wms', 'hw', 'foss', 'gateway', 'websocket'].map(id => ({ id, url: 'https://example.com/', contains: 'ok' })) };
  assert.equal(validateHost(value), value);
  for (const url of ['http://example.com/', 'https://user:secret@example.com/', 'https://example.com/?token=secret', 'https://REPLACE-WITH-HOST/']) {
    assert.throws(() => validateHost({ smoke: value.smoke.map(e => ({ ...e, url })) }));
  }
});
test('initial install requires explicit bootstrap', async () => {
  const f = fixture();
  await assert.rejects(rollout({ candidate: manifest(), adapter: f.adapter }), /bootstrap/);
  assert.deepEqual(f.calls, []);
});
test('bootstrap starts and accepts only after smoke', async () => {
  const f = fixture();
  await rollout({ candidate: manifest(), bootstrap: true, adapter: f.adapter });
  assert.deepEqual(f.calls, ['empty', 'prepare', 'start', 'smoke', 'accept']);
});
test('existing unmanaged containers block bootstrap', async () => {
  const f = fixture(name => name === 'empty');
  await assert.rejects(rollout({ candidate: manifest(), bootstrap: true, adapter: f.adapter }));
  assert.deepEqual(f.calls, ['empty']);
});
test('successful release verifies baseline before mutation', async () => {
  const f = fixture();
  const result = await rollout({ previous: manifest(), candidate: manifest('b'), adapter: f.adapter });
  assert.equal(result.status, 'deployed');
  assert.deepEqual(f.calls, ['baseline', 'prepare', 'start', 'smoke', 'accept']);
});
test('pull, provenance or config failure leaves prior release alone', async () => {
  const f = fixture(name => name === 'prepare');
  await assert.rejects(rollout({ previous: manifest(), candidate: manifest('b'), adapter: f.adapter }));
  assert.deepEqual(f.calls, ['baseline', 'prepare']);
});
test('failed candidate startup restores prior images and still fails release', async () => {
  const f = fixture(name => name === 'start');
  await assert.rejects(rollout({ previous: manifest(), candidate: manifest('b'), adapter: f.adapter }), /previous images restored/);
  assert.deepEqual(f.calls, ['baseline', 'prepare', 'start', 'restore', 'smoke']);
});
test('public smoke failure also triggers rollback', async () => {
  const f = fixture((name, calls) => name === 'smoke' && calls.filter(c => c === 'smoke').length === 1);
  await assert.rejects(rollout({ previous: manifest(), candidate: manifest('b'), adapter: f.adapter }), /previous images restored/);
  assert.deepEqual(f.calls, ['baseline', 'prepare', 'start', 'smoke', 'restore', 'smoke']);
});
test('failed rollback is explicitly unverified', async () => {
  const f = fixture(name => ['start', 'restore'].includes(name));
  await assert.rejects(rollout({ previous: manifest(), candidate: manifest('b'), adapter: f.adapter }), /rollback could not be verified/);
  assert.ok(!f.calls.includes('accept'));
});
test('bootstrap failure stops candidates without deleting data or broker', async () => {
  const f = fixture(name => name === 'smoke');
  await assert.rejects(rollout({ candidate: manifest(), bootstrap: true, adapter: f.adapter }), /candidate application containers stopped/);
  assert.equal(f.calls.at(-1), 'stop');
});
test('unchanged retry does not restart containers or overwrite rollback state', async () => {
  const f = fixture();
  const result = await rollout({ previous: manifest(), candidate: manifest(), adapter: f.adapter });
  assert.equal(result.status, 'unchanged');
  assert.deepEqual(f.calls, ['baseline', 'smoke']);
});
test('updating one service pair does not select unrelated systems', async () => {
  const old = manifest(); const candidate = manifest();
  for (const name of ['mad-backend', 'mad-frontend']) candidate.services[name] = manifest('b').services[name];
  const f = fixture();
  const result = await rollout({ previous: old, candidate, adapter: f.adapter });
  assert.deepEqual(result.changed, ['mad-backend', 'mad-frontend']);
});

function githubFixture({ review = 'APPROVED', conclusion = 'success', author = 'peer' } = {}) {
  return async route => {
    if (route.includes('/commits/')) return [{ number: 1, merged_at: 'now', base: { ref: route.includes('/infra/') || route.includes('manager-dashboard') || route.includes('websocket-service') ? 'development' : 'develop' }, merge_commit_sha: 'a'.repeat(40), head: { sha: 'b'.repeat(40) }, user: { login: 'writer' } }];
    if (route.includes('/reviews')) return [{ state: review, commit_id: 'b'.repeat(40), user: { login: author } }];
    return { workflow_runs: [{ id: 1, conclusion }] };
  };
}
test('source gate requires peer approval and successful source CI', async () => {
  await verifySource(githubFixture(), 'manager-dashboard', 'a'.repeat(40), 'development');
  for (const options of [{ review: 'CHANGES_REQUESTED' }, { author: 'writer' }, { conclusion: 'failure' }])
    await assert.rejects(verifySource(githubFixture(options), 'manager-dashboard', 'a'.repeat(40), 'development'));
});
test('release gate checks infra and all source repositories', async () => {
  const routes = []; const api = githubFixture();
  await verifyRelease(async route => { routes.push(route); return api(route); }, manifest(), 'a'.repeat(40));
  assert.equal(routes.filter(route => route.includes('/commits/')).length, 8);
});
