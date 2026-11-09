import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  catalog,
  validateManifest,
  validateHost,
  groupImages,
  fingerprint,
  release,
} from '../scripts/release-core.mjs';
const copy = (x) => structuredClone(x);
const manifest = JSON.parse(readFileSync('release/current.json', 'utf8'));
export function hostFixture() {
  const h = JSON.parse(readFileSync('config/host.example.json', 'utf8'));
  h.adoptionApproved = true;
  for (const p of [
    h.caddyFile,
    ...Object.values(h.groups).flatMap((g) => g.files),
    h.groups.full.directory + '/config/gateway-routes.json',
  ])
    h.expectedConfigHashes[p] = 'a'.repeat(64);
  return h;
}
test('release validates every immutable service and canonical fingerprint', () => {
  assert.equal(validateManifest(manifest), manifest);
  const m = copy(manifest);
  m.images = Object.fromEntries(Object.entries(m.images).reverse());
  assert.equal(fingerprint(m), fingerprint(manifest));
  assert.equal(
    Object.keys(groupImages(manifest.images, 'sample')).join(','),
    'backend,frontend',
  );
  assert.equal(Object.keys(groupImages(manifest.images, 'full')).length, 12);
  for (const bad of [
    null,
    {},
    { ...manifest, schemaVersion: 2 },
    { ...manifest, images: {} },
    { ...manifest, images: { ...manifest.images, extra: 'x' } },
    { ...manifest, images: { ...manifest.images, gateway: 123 } },
    {
      ...manifest,
      images: {
        ...manifest.images,
        gateway: manifest.images.gateway.replace('api-gateway', 'other'),
      },
    },
    {
      ...manifest,
      images: {
        ...manifest.images,
        gateway: manifest.images.gateway.slice(0, -1),
      },
    },
    { ...manifest, schemaEvidence: null },
    { ...manifest, schemaEvidence: { reviewedReference: 1 } },
    { ...manifest, schemaEvidence: { reviewedReference: 'x' } },
  ])
    assert.throws(() => validateManifest(bad));
});
test('host adoption fails closed for unsafe paths, missing hashes and wrong environment', () => {
  const valid = hostFixture();
  assert.equal(validateHost(valid, 'staging'), valid);
  const mutations = [
    (h) => (h.environment = 'production'),
    (h) => (h.adoptionApproved = false),
    (h) => (h.stateDirectory = '/'),
    (h) => (h.stateDirectory = '/opt/../bad'),
    (h) => (h.caddyFile = 'relative'),
    (h) => (h.gatewayContainer = 'bad;cmd'),
    (h) => (h.groups = null),
    (h) => (h.groups.full.directory = '/'),
    (h) => (h.groups.full.project = 'bad shell'),
    (h) => (h.groups.full.files = []),
    (h) => (h.groups.full.files = ['relative']),
    (h) => (h.groups.full.profiles = null),
    (h) => (h.groups.full.profiles = ['bad;']),
    (h) => (h.groups.full.envFile = 'relative'),
    (h) => (h.groups.full.activeOverride = 'relative'),
    (h) => (h.sampleLock = 'relative'),
    (h) => (h.expectedConfigHashes = null),
    (h) => (h.expectedConfigHashes = {}),
    (h) => (h.expectedConfigHashes[h.caddyFile] = 'short'),
    (h) => (h.expectedConfigHashes.relative = 'a'.repeat(64)),
    (h) => delete h.expectedConfigHashes[h.caddyFile],
    (h) => (h.publicChecks = null),
    (h) => (h.publicChecks = []),
    (h) => (h.publicChecks[0].url = 'http://unsafe/'),
    (h) => (h.publicChecks[0].url = 'https://user:password@example.com/'),
    (h) => (h.publicChecks[0].url = 'https://example.com:444/'),
    (h) => (h.publicChecks[0].url = 'https://example.com/?token=x'),
    (h) => (h.publicChecks[0].url = 'https://example.com/#x'),
    (h) => (h.publicChecks[0].statuses = null),
    (h) => (h.publicChecks[0].statuses = []),
    (h) => (h.publicChecks[0].statuses = ['200']),
    (h) => (h.publicChecks[0].statuses = [99]),
    (h) => (h.publicChecks[0].statuses = [600]),
  ];
  for (const mutate of mutations) {
    const h = copy(valid);
    mutate(h);
    assert.throws(() => validateHost(h, 'staging'));
  }
  assert.throws(() => validateHost(null, 'staging'));
  assert.throws(() => validateHost(valid, 'invalid'));
});
function fake(failure) {
  const events = [];
  const baseline = Object.fromEntries(
    Object.keys(catalog).map((k) => [k, 'sha256:' + 'c'.repeat(64)]),
  );
  let deploys = 0,
    smokes = 0;
  const a = {
    snapshot: async () => baseline,
    smoke: async () => {
      events.push('smoke');
      smokes++;
      if (
        (failure === 'preflight' && smokes === 1) ||
        (failure === 'post-smoke' && smokes === 2) ||
        (failure === 'rollback-smoke' && smokes >= 2)
      )
        throw Error('secret');
    },
    record: async (r) => events.push(r.status),
    prepare: async () => {
      if (failure === 'compose') throw Error('invalid private env');
    },
    pull: async () => {
      events.push('pull');
      if (failure === 'pull') throw Error('secret');
    },
    checkConfig: async () => {
      if (failure === 'drift') throw Error('changed');
    },
    deploy: async () => {
      events.push('deploy');
      deploys++;
      if (
        (failure === 'deploy' && deploys === 1) ||
        failure === 'rollback-deploy'
      )
        throw Error('secret');
    },
    activate: async () => events.push('active'),
  };
  return { a, events, baseline };
}
test('successful release records baseline before pull and activates after health', async () => {
  const { a, events } = fake();
  assert.equal(await release(manifest, a), 'released');
  assert.deepEqual(events, [
    'smoke',
    'prepared',
    'pull',
    'deploy',
    'smoke',
    'active',
    'released',
  ]);
});
test('preflight and pull failures never change running containers', async () => {
  for (const mode of ['preflight', 'compose', 'pull', 'drift']) {
    const { a, events } = fake(mode);
    await assert.rejects(release(manifest, a));
    assert(!events.includes('deploy'));
  }
});
test('every managed service must have a valid recoverable baseline', async () => {
  for (const value of [{}, { gateway: 'bad' }]) {
    const { a } = fake();
    a.snapshot = async () => value;
    await assert.rejects(release(manifest, a));
  }
});
test('partial deployment and failed health restore baseline; recovery failure is explicit', async () => {
  for (const mode of ['deploy', 'post-smoke']) {
    const { a, events } = fake(mode);
    assert.equal(await release(manifest, a), 'failed_rolled_back');
    assert.equal(events.filter((e) => e === 'deploy').length, 2);
  }
  for (const mode of ['rollback-deploy', 'rollback-smoke']) {
    const { a } = fake(mode);
    assert.equal(await release(manifest, a), 'failed_rollback_unverified');
  }
});
