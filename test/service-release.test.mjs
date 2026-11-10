import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRelease, rollout } from '../scripts/service-release.mjs';
const sha = 'a'.repeat(40);
const release = {
  commit: sha,
  frontend:
    'ghcr.io/forever-hotel/front-desk/frontend@sha256:' + 'b'.repeat(64),
  backend: 'ghcr.io/forever-hotel/front-desk/backend@sha256:' + 'c'.repeat(64),
};
test('only complete Front Desk digests from the triggering commit are accepted', () => {
  assert.deepEqual(Object.keys(validateRelease(release, sha)), [
    'fds-backend',
    'fds-frontend',
  ]);
  for (const invalid of [
    { ...release, commit: 'd'.repeat(40) },
    { ...release, frontend: release.frontend.slice(0, -1) },
    { ...release, backend: release.backend.replace('front-desk', 'other') },
  ])
    assert.throws(() => validateRelease(invalid, sha));
});
function fixture(fail = '') {
  const calls = [];
  let health = 0;
  let replace = 0;
  const baseline = { old: true };
  return {
    calls,
    adapter: {
      snapshot: async () => baseline,
      check: async () => calls.push('check'),
      health: async () => {
        calls.push('health');
        health++;
        if (
          (fail === 'post' && health === 2) ||
          (fail === 'recovery' && health > 1)
        )
          throw Error('health');
      },
      pull: async () => {
        calls.push('pull');
        if (fail === 'pull') throw Error('registry');
      },
      replace: async (images) => {
        calls.push(images === baseline ? 'restore' : 'deploy');
        replace++;
        if (fail === 'partial' && replace === 1) throw Error('partial');
      },
      activate: async (images) =>
        calls.push(images === baseline ? 'activate-old' : 'activate-new'),
      record: async (r) => calls.push(r.status),
    },
  };
}
test('healthy release activates after verification', async () => {
  const f = fixture();
  await rollout(release, f.adapter);
  assert.deepEqual(f.calls, [
    'check',
    'health',
    'pull',
    'check',
    'deploy',
    'health',
    'activate-new',
    'released',
  ]);
});
test('registry failure does not replace containers', async () => {
  const f = fixture('pull');
  await assert.rejects(rollout(release, f.adapter));
  assert.ok(!f.calls.includes('deploy'));
  assert.ok(!f.calls.includes('restore'));
});
for (const fail of ['post', 'partial'])
  test(
    fail + ' failure restores previous images and still fails the release',
    async () => {
      const f = fixture(fail);
      await assert.rejects(rollout(release, f.adapter));
      assert.ok(f.calls.includes('restore'));
      assert.equal(f.calls.at(-1), 'failed_rolled_back');
    },
  );
test('failed recovery is recorded honestly', async () => {
  const f = fixture('recovery');
  await assert.rejects(rollout(release, f.adapter));
  assert.equal(f.calls.at(-1), 'failed_rollback_unverified');
});

import { main } from '../scripts/service-release.mjs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
function hostFixture(mode = '') {
  const state = '/opt/forever-hotel/.infra-release';
  const content = 'approved config';
  const digest = createHash('sha256').update(content).digest('hex');
  const host = {
    environment: 'staging',
    adoptionApproved: true,
    stateDirectory: state,
    sampleLock: '/opt/hotel-website-staging/.sample-release/release.lock',
    gatewayContainer: 'gateway',
    expectedConfigHashes: Object.fromEntries(
      ['a', 'b', 'c', 'd'].map((p) => [p, digest]),
    ),
    groups: {
      sample: {
        directory: '/opt/hotel-website-staging',
        project: 'hotel-website-sample',
        files: ['/opt/hotel-website-staging/compose.sample.yml'],
        profiles: [],
        envFile: null,
        activeOverride:
          '/opt/hotel-website-staging/.sample-release/active.json',
      },
      full: {
        directory: '/opt/forever-hotel',
        project: 'forever-hotel-full',
        files: ['/opt/forever-hotel/compose.yml'],
        profiles: ['platform', 'fds'],
        envFile: '/opt/forever-hotel/.env',
        activeOverride: state + '/active-images.json',
      },
    },
  };
  const writes = new Map();
  const locks = new Set();
  const commands = [];
  let probes = 0;
  const io = {
    json: async (file) => {
      if (file === 'manifest') return release;
      if (file === 'host')
        return mode === 'unapproved'
          ? { ...host, adoptionApproved: false }
          : host;
      if (mode === 'missing-active')
        throw Object.assign(Error('absent'), { code: 'ENOENT' });
      if (mode === 'broken-active') throw Error('invalid active JSON');
      return {
        name: 'keep-project',
        services: { 'mad-backend': { image: 'unchanged' } },
      };
    },
    readFile: async () => (mode === 'drift' ? 'changed' : content),
    mkdir: async () => {},
    open: async (file) => {
      if (mode === 'locked' && locks.size === 1) throw Error('busy');
      locks.add(file);
      return { writeFile: async () => {}, close: async () => {} };
    },
    unlink: async (file) => locks.delete(file),
    atomic: async (file, value) => writes.set(file, structuredClone(value)),
    pause: async () => {},
    docker: (...args) => {
      commands.push(args);
      if (args[0] === 'inspect')
        return JSON.stringify({
          State: { Running: mode !== 'stopped' },
          Image: 'sha256:' + 'd'.repeat(64),
        });
      if (args[0] === 'exec') {
        probes++;
        if (mode === 'bad-health') throw Error('unready');
      }
      return '';
    },
    run: (file, args) => {
      commands.push([file, ...args]);
      if (file === 'git') return sha + '\trefs/heads/develop';
      return mode === 'bad-public' ? '503' : '200';
    },
  };
  return { io, writes, locks, commands, state, probes: () => probes };
}
test('host rollout preserves unrelated images and replaces only the Front Desk pair', async () => {
  const f = hostFixture();
  await main(['manifest', sha, 'host'], f.io);
  const active = f.writes.get(f.state + '/active-images.json');
  assert.equal(active.name, 'keep-project');
  assert.equal(active.services['mad-backend'].image, 'unchanged');
  assert.equal(active.services['fds-backend'].image, release.backend);
  assert.equal(f.locks.size, 0);
  const up = f.commands.find(
    (args) => args[0] === 'compose' && args.includes('up'),
  );
  assert.deepEqual(up.slice(-2), ['fds-backend', 'fds-frontend']);
  assert.ok(up.includes('--no-deps'));
  assert.ok(
    f.commands.some((args) => args[0] === 'curl' && args.includes('--resolve')),
  );
  assert.equal(
    f.writes.get(resolve(f.state, 'fds-last-attempt.json')).commit,
    sha,
  );
});
for (const mode of [
  'unapproved',
  'locked',
  'drift',
  'stopped',
  'bad-health',
  'bad-public',
])
  test(
    mode + ' host fails before replacement and releases acquired locks',
    async () => {
      const f = hostFixture(mode);
      await assert.rejects(main(['manifest', sha, 'host'], f.io));
      assert.equal(f.locks.size, 0);
      assert.ok(
        !f.commands.some(
          (args) => args[0] === 'compose' && args.includes('up'),
        ),
      );
      if (mode.startsWith('bad-')) assert.equal(f.probes(), 12);
    },
  );
test('first service activation can create the shared active override', async () => {
  const f = hostFixture('missing-active');
  await main(['manifest', sha, 'host'], f.io);
  assert.deepEqual(
    Object.keys(f.writes.get(f.state + '/active-images.json').services),
    ['fds-backend', 'fds-frontend'],
  );
});
test('corrupt existing image state is never silently overwritten', async () => {
  const f = hostFixture('broken-active');
  await assert.rejects(main(['manifest', sha, 'host'], f.io));
  assert.equal(f.writes.has(f.state + '/active-images.json'), false);
  assert.equal(
    f.writes.get(resolve(f.state, 'fds-last-attempt.json')).status,
    'failed_rollback_unverified',
  );
});

import { atomic, json, run } from '../scripts/service-release.mjs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
test('private state is atomically replaced and subprocess arguments remain literal', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'fds-release-'));
  try {
    const file = resolve(directory, 'receipt.json');
    await atomic(file, { status: 'first' });
    await atomic(file, { status: 'released' });
    assert.deepEqual(await json(file), { status: 'released' });
    assert.deepEqual(await readdir(directory), ['receipt.json']);
    assert.equal(
      run(process.execPath, [
        '-e',
        'process.stdout.write(process.argv[1])',
        'literal; & value',
      ]),
      'literal; & value',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import {
  profiles,
  validateRelease as validateServiceRelease,
} from '../scripts/service-release.mjs';
import { verifyPublication } from '../scripts/verify-service-release.mjs';
for (const [service, profile] of Object.entries(profiles)) {
  const publication = {
    commit: sha,
    ...Object.fromEntries(
      profile.components.map((component) => [
        component,
        'ghcr.io/' +
          profile.repository +
          (component === 'image' ? '' : '/' + component) +
          '@sha256:' +
          'f'.repeat(64),
      ]),
    ),
  };
  test(
    service + ' deploys only its allowlisted containers and public origins',
    async () => {
      const f = hostFixture();
      const original = f.io.json;
      f.io.json = async (path) =>
        path === 'manifest' ? publication : original(path);
      await main(['manifest', sha, 'host', service], f.io);
      const up = f.commands.find(
        (args) => args[0] === 'compose' && args.includes('up'),
      );
      assert.deepEqual(
        up.slice(-profile.services.length),
        profile.services.map((name) =>
          profile.group === 'sample' ? name.slice(3) : name,
        ),
      );
      assert.equal(
        f.commands.filter((args) => args[0] === 'curl').length,
        profile.publicOrigins.length * 2,
      );
      assert.equal(
        f.writes.get(resolve(f.state, service + '-last-attempt.json')).status,
        'released',
      );
    },
  );
  test(
    service +
      ' requires its own branch, repository, current commit and reviewed merge',
    async () => {
      const env = {
        GITHUB_REPOSITORY: profile.repository,
        GITHUB_REF: 'refs/heads/' + profile.branch,
        GITHUB_SHA: sha,
        GITHUB_EVENT_NAME: 'push',
      };
      const api = async (path) =>
        path.includes('/branches/')
          ? { commit: { sha } }
          : path.includes('/commits/')
            ? [
                {
                  number: 1,
                  merged_at: 'today',
                  base: { ref: profile.branch },
                  merge_commit_sha: sha,
                  head: { sha: 'b'.repeat(40) },
                  user: { login: 'author' },
                },
              ]
            : [
                {
                  state: 'APPROVED',
                  commit_id: 'b'.repeat(40),
                  user: { login: 'reviewer' },
                },
              ];
      await verifyPublication(publication, service, env, api);
      await assert.rejects(
        verifyPublication(
          publication,
          service,
          { ...env, GITHUB_REPOSITORY: 'forever-hotel/other' },
          api,
        ),
      );
      await assert.rejects(
        verifyPublication(
          publication,
          service,
          { ...env, GITHUB_REF: 'refs/heads/main' },
          api,
        ),
      );
      await assert.rejects(
        verifyPublication(publication, service, env, async () => ({
          commit: { sha: 'c'.repeat(40) },
        })),
      );
      await assert.rejects(
        verifyPublication(publication, service, env, async (path) =>
          path.includes('/branches/') ? { commit: { sha } } : [],
        ),
      );
      assert.throws(() =>
        validateServiceRelease(
          {
            ...publication,
            [profile.components[0]]:
              'ghcr.io/forever-hotel/other@sha256:' + 'f'.repeat(64),
          },
          sha,
          service,
        ),
      );
    },
  );
}
test('unknown service profiles are rejected', () =>
  assert.throws(() => validateServiceRelease(release, sha, 'other')));

test('shared service lock contention waits then proceeds, and stale queued runs stop before replacement', async () => {
  const f = hostFixture();
  const original = f.io.open;
  let attempts = 0;
  let pauses = 0;
  f.io.open = async (...args) => {
    if (attempts++ === 0)
      throw Object.assign(Error('busy'), { code: 'EEXIST' });
    return original(...args);
  };
  f.io.pause = async () => {
    pauses++;
  };
  await main(['manifest', sha, 'host'], f.io);
  assert.equal(pauses, 1);
  assert.equal(f.locks.size, 0);
  const stale = hostFixture();
  const originalRun = stale.io.run;
  stale.io.run = (file, args) =>
    file === 'git' ? 'e'.repeat(40) : originalRun(file, args);
  await assert.rejects(
    main(['manifest', sha, 'host'], stale.io),
    /Stale release/,
  );
  assert.equal(stale.locks.size, 0);
  assert.ok(
    !stale.commands.some(
      (args) => args[0] === 'compose' && args.includes('up'),
    ),
  );
});

import { checkServiceReceipts } from '../scripts/deploy.mjs';
test('full infra release cannot silently replace a newer automatic service release', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'service-receipt-'));
  try {
    const images = {
      'fds-backend': release.backend,
      'fds-frontend': release.frontend,
    };
    await atomic(resolve(directory, 'fds-last-attempt.json'), {
      status: 'released',
      images,
    });
    await checkServiceReceipts({ stateDirectory: directory }, { images });
    await assert.rejects(
      checkServiceReceipts(
        { stateDirectory: directory },
        { images: { ...images, 'fds-backend': 'old' } },
      ),
      /align the manifest/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Hotel Website updates only its existing sample project and preserves Caddy', async () => {
  const f = hostFixture();
  const original = f.io.json;
  const publication = {
    commit: sha,
    backend:
      'ghcr.io/forever-hotel/hotel-website/backend@sha256:' + 'f'.repeat(64),
    frontend:
      'ghcr.io/forever-hotel/hotel-website/frontend@sha256:' + 'e'.repeat(64),
  };
  f.io.json = async (path) =>
    path === 'manifest'
      ? publication
      : path.endsWith('/active.json')
        ? {
            services: {
              caddy: { image: 'caddy:2-alpine' },
              gateway: { image: 'keep' },
            },
          }
        : original(path);
  await main(['manifest', sha, 'host', 'hw'], f.io);
  const active = f.writes.get(
    '/opt/hotel-website-staging/.sample-release/active.json',
  );
  assert.equal(active.services.caddy.image, 'caddy:2-alpine');
  assert.equal(active.services.gateway.image, 'keep');
  assert.equal(active.services.backend.image, publication.backend);
  assert.equal(active.services.frontend.image, publication.frontend);
  assert.equal(f.writes.has(f.state + '/active-images.json'), false);
  const inspect = f.commands.filter((args) => args[0] === 'inspect');
  assert.ok(
    inspect.every((args) => args.at(-1).startsWith('hotel-website-sample-')),
  );
  const up = f.commands.find(
    (args) => args[0] === 'compose' && args.includes('up'),
  );
  assert.ok(up.includes('hotel-website-sample'));
  assert.deepEqual(up.slice(-2), ['backend', 'frontend']);
  assert.ok(!up.includes('caddy'));
  assert.ok(!up.includes('gateway'));
  assert.equal(f.locks.size, 0);
});
