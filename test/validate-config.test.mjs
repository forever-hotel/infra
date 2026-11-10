import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateRoutes,
  validateRelease,
  validateRepository,
} from '../scripts/validate-config.mjs';
const route = {
  id: 'wkms',
  enabled: true,
  prefix: '/wkms',
  rewritePrefix: '/wkms',
  upstreamEnv: 'WKMS_SERVICE_URL',
  cookieNames: ['wkms_session'],
};
const release = {
  repository: 'forever-hotel/example',
  commit: 'a'.repeat(40),
  image: 'ghcr.io/forever-hotel/example@sha256:' + 'b'.repeat(64),
};
test('accepts /wms bearer-only alias and same-subsystem cookie paths', () => {
  validateRoutes([
    route,
    { ...route, id: 'wms', prefix: '/wms', cookieNames: [] },
    { ...route, id: 'wkms-auth', prefix: '/wkms/auth' },
  ]);
  validateRoutes([route, { enabled: false }]);
});
test('rejects invalid route input, reserved names and cross-prefix cookie conflicts', () => {
  for (const value of [
    null,
    [],
    [null],
    [{ ...route, enabled: 1 }],
    [{ ...route, id: 'BAD' }],
    [{ ...route, prefix: 'bad' }],
    [{ ...route, rewritePrefix: 'bad' }],
    [route, route],
    [route, { ...route, id: 'other' }],
    [{ ...route, upstreamEnv: 'bad' }],
    [{ ...route, cookieNames: null }],
    [{ ...route, cookieNames: ['x', 'x'] }],
    [{ ...route, cookieNames: ['__Host-x'] }],
    [{ ...route, cookieNames: ['bad name'] }],
    [route, { ...route, id: 'wms', prefix: '/wms' }],
    [{ ...route, enabled: false }],
  ])
    assert.throws(() => validateRoutes(value));
});
test('validates manifest provenance, digest lengths and repository ownership', () => {
  validateRelease(release);
  validateRelease({
    ...release,
    image: undefined,
    frontend: 'ghcr.io/forever-hotel/example/frontend@sha256:' + 'a'.repeat(64),
    backend: 'ghcr.io/forever-hotel/example/backend@sha256:' + 'b'.repeat(64),
  });
  for (const r of [
    null,
    {},
    { ...release, commit: 'abc' },
    { ...release, image: undefined },
    { ...release, image: 'ghcr.io/other/example@sha256:' + 'b'.repeat(64) },
    { ...release, image: 'ghcr.io/forever-hotel/example:latest' },
    { ...release, image: 123 },
  ])
    assert.throws(() => validateRelease(r));
});
test('checks the real repository without reading any private env files', () =>
  assert.equal(validateRepository(process.cwd()), true));
test('rejects invalid Compose and release data in an isolated fixture', () => {
  const root = mkdtempSync(join(tmpdir(), 'infra-validation-'));
  try {
    for (const p of ['config/snapshots', 'releases'])
      mkdirSync(join(root, p), { recursive: true });
    for (const f of [
      'compose.yml',
      'compose.sample-transition.yml',
      'compose.kms.yml',
    ])
      writeFileSync(join(root, f), JSON.stringify({ services: {} }));
    writeFileSync(
      join(root, 'config/gateway-routes.json'),
      JSON.stringify([route]),
    );
    writeFileSync(join(root, 'releases/fixture.json'), JSON.stringify(release));
    assert.equal(validateRepository(root), true);
    writeFileSync(join(root, 'compose.yml'), '{}');
    assert.throws(() => validateRepository(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
