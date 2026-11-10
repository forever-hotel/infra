import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  rm,
  access,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { catalog } from '../scripts/release-core.mjs';
import {
  command,
  atomic,
  composeArguments,
  checkConfig,
  smoke,
  makeAdapter,
  main,
} from '../scripts/deploy.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'infra-adapter-'));
  try {
    const host = {
      environment: 'staging',
      stateDirectory: join(root, 'state'),
      caddyFile: join(root, 'Caddyfile'),
      gatewayContainer: 'gateway-test',
      sampleLock: join(root, 'sample.lock'),
      expectedConfigHashes: {},
      groups: {},
    };
    await writeFile(host.caddyFile, 'public-config');
    host.expectedConfigHashes[host.caddyFile] = createHash('sha256')
      .update('public-config')
      .digest('hex');
    for (const name of ['full', 'sample']) {
      const dir = join(root, name);
      await mkdir(dir);
      const file = join(dir, 'compose.json');
      await writeFile(file, '{}');
      host.groups[name] = {
        directory: dir,
        project: 'test-' + name,
        files: [file],
        profiles: name === 'full' ? ['platform'] : [],
        envFile: name === 'full' ? file : null,
        activeOverride: join(dir, 'active.json'),
      };
    }
    await mkdir(host.stateDirectory);
    await run({ host, root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const baseline = Object.fromEntries(
  Object.keys(catalog).map((k) => [k, 'sha256:' + 'a'.repeat(64)]),
);
const loadManifest = async () => {
  const m = JSON.parse(await readFile('release/current.json', 'utf8'));
  m.schemaEvidence.reviewedReference = 'reviewed-test-fixture';
  return m;
};

test('safe command runner and Compose arguments do not invoke a shell or lifecycle deletion', () => {
  assert.equal(command(process.execPath, ['-e', 'console.log("ok")']), 'ok');
  assert.throws(() => command(process.execPath, ['-e', 'process.exit(1)']));
  const g = {
    project: 'project',
    directory: '/opt/app',
    envFile: null,
    files: ['/opt/app/base.json'],
    profiles: [],
  };
  assert.deepEqual(
    composeArguments(g, '/opt/app/images.json', ['config', '--quiet']),
    [
      'compose',
      '--project-name',
      'project',
      '--project-directory',
      '/opt/app',
      '-f',
      '/opt/app/base.json',
      '-f',
      '/opt/app/images.json',
      'config',
      '--quiet',
    ],
  );
  assert(
    composeArguments(
      { ...g, envFile: '/opt/app/.env', profiles: ['platform'] },
      'images',
      [],
    ).includes('--env-file'),
  );
});
test('public host hashes detect drift and required files without exposing contents', async () =>
  fixture(async ({ host }) => {
    await checkConfig(host);
    await writeFile(host.caddyFile, 'changed');
    await assert.rejects(checkConfig(host));
    host.expectedConfigHashes = {};
    host.groups.full.files = ['missing-config'];
    await assert.rejects(checkConfig(host));
  }));
test('smoke uses only fixed internal GETs, handles retry and terminal failure', async () => {
  const host = { gatewayContainer: 'gateway' };
  let n = 0,
    pause = 0;
  await smoke(
    host,
    2,
    (...args) => {
      assert.equal(args[0], 'exec');
      assert(args.at(-1).includes("redirect:'manual'"));
      assert(!args.at(-1).includes('POST'));
      if (++n === 1) throw Error('retry');
    },
    async () => pause++,
  );
  assert.equal(pause, 1);
  await assert.rejects(
    smoke(host, 1, () => {
      throw Error('failed');
    }),
  );
});
test('adapter snapshots both projects and rejects stopped services', async () =>
  fixture(async ({ host }) => {
    let running = true;
    const calls = [];
    const a = makeAdapter(host, host.stateDirectory, {
      runDocker: (...args) => {
        calls.push(args);
        return JSON.stringify({
          State: { Running: running },
          Image: 'sha256:' + 'a'.repeat(64),
        });
      },
      probe: async () => {},
      verify: async () => {},
    });
    assert.deepEqual(await a.snapshot(), baseline);
    assert(calls.some((x) => x.at(-1) === 'test-sample-backend-1'));
    running = false;
    await assert.rejects(a.snapshot());
    await a.smoke();
    await a.checkConfig();
  }));
test('adapter pulls before changes, deploys only app services and preserves unrelated active override data', async () =>
  fixture(async ({ host }) => {
    const calls = [];
    const a = makeAdapter(host, host.stateDirectory, {
      runDocker: (...args) => {
        calls.push(args);
        return '';
      },
    });
    const m = await loadManifest();
    await a.prepare(m.images);
    await a.pull(m.images);
    assert.equal(calls.filter((x) => x[0] === 'pull').length, 14);
    await a.deploy(m.images);
    for (const args of calls.filter((x) => x.includes('up'))) {
      assert(args.includes('--no-deps'));
      assert(args.includes('--no-build'));
      assert(!args.includes('rabbitmq'));
      assert(!args.includes('caddy'));
      assert(!args.includes('down'));
    }
    await atomic(host.groups.full.activeOverride, {
      marker: 'keep',
      services: { unrelated: { image: 'unchanged' } },
    });
    await a.activate(m.images);
    const active = JSON.parse(
      await readFile(host.groups.full.activeOverride, 'utf8'),
    );
    assert.equal(active.marker, 'keep');
    assert.equal(active.services.unrelated.image, 'unchanged');
    assert.equal(active.services.gateway.image, m.images.gateway);
    await a.record({ status: 'test' });
    assert.equal(
      JSON.parse(
        await readFile(join(host.stateDirectory, 'last-attempt.json'), 'utf8'),
      ).status,
      'test',
    );
  }));
test('release entry checks manifest/host, uses both locks and writes receipts only on success', async () =>
  fixture(async ({ host, root }) => {
    const mf = join(root, 'release.json'),
      hf = join(root, 'host.json');
    const m = await loadManifest();
    await writeFile(mf, JSON.stringify(m));
    await writeFile(hf, JSON.stringify(host));
    const adapter = {
      snapshot: async () => baseline,
      smoke: async () => {},
      record: async () => {},
      prepare: async () => {},
      pull: async () => {},
      checkConfig: async () => {},
      deploy: async () => {},
      activate: async () => {},
    };
    const factory = () => adapter,
      allowFixture = (h) => h;
    await main(['check', mf, hf, 'staging'], factory, allowFixture);
    await assert.rejects(access(join(host.stateDirectory, 'receipt.json')));
    await main(['deploy', mf, hf, 'staging'], factory, allowFixture);
    assert.equal(
      JSON.parse(
        await readFile(join(host.stateDirectory, 'receipt.json'), 'utf8'),
      ).status,
      'released',
    );
    await assert.rejects(access(join(host.stateDirectory, 'release.lock')));
    await assert.rejects(access(host.sampleLock));
    await writeFile(host.sampleLock, 'other-owner');
    await assert.rejects(
      main(['deploy', mf, hf, 'staging'], factory, allowFixture),
    );
    assert.equal(await readFile(host.sampleLock, 'utf8'), 'other-owner');
    await rm(host.sampleLock);
    await assert.rejects(main(['bad'], factory, allowFixture));
    const before = await readFile(mf, 'utf8');
    m.schemaEvidence.reviewedReference = 'PENDING-review';
    await writeFile(mf, JSON.stringify(m));
    await assert.rejects(
      main(['check', mf, hf, 'staging'], factory, allowFixture),
    );
    await writeFile(mf, before);
    adapter.snapshot = async () => ({});
    await assert.rejects(
      main(['check', mf, hf, 'staging'], factory, allowFixture),
    );
    adapter.snapshot = async () => baseline;
    let deploys = 0;
    adapter.deploy = async () => {
      if (++deploys === 1) throw Error('partial failure');
    };
    await assert.rejects(
      main(['deploy', mf, hf, 'staging'], factory, allowFixture),
    );
  }));

test('public smoke verifies TLS with local resolution and rejects unexpected HTTP status', async () => {
  const host = {
    gatewayContainer: 'gateway',
    publicChecks: [{ url: 'https://hotel.example/', statuses: [200] }],
  };
  await smoke(
    host,
    1,
    () => '',
    async () => {},
    (file, args) => {
      assert.equal(file, 'curl');
      assert(args.includes('hotel.example:443:127.0.0.1'));
      assert(!args.includes('--insecure'));
      return '200';
    },
  );
  await assert.rejects(
    smoke(
      host,
      1,
      () => '',
      async () => {},
      () => '503',
    ),
  );
});
