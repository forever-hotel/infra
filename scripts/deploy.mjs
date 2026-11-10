import { profiles } from './service-release.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  readFile,
  writeFile,
  rename,
  mkdir,
  open,
  unlink,
  stat,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  catalog,
  validateHost,
  validateManifest,
  groupImages,
  fingerprint,
  release,
} from './release-core.mjs';

export const command = (file, args) =>
  execFileSync(file, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 300000,
  }).trim();
export const docker = (...args) => command('sudo', ['-n', 'docker', ...args]);
export const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
export async function atomic(path, value) {
  await writeFile(path + '.tmp', JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
  });
  await rename(path + '.tmp', path);
}

export function composeArguments(group, override, operation) {
  return [
    'compose',
    '--project-name',
    group.project,
    '--project-directory',
    group.directory,
    ...(group.envFile ? ['--env-file', group.envFile] : []),
    ...group.files.flatMap((f) => ['-f', f]),
    '-f',
    override,
    ...group.profiles.flatMap((p) => ['--profile', p]),
    ...operation,
  ];
}

export async function checkConfig(host) {
  for (const [path, hash] of Object.entries(host.expectedConfigHashes)) {
    const actual = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
    if (actual !== hash) throw Error('Host public configuration drift');
  }
  for (const group of Object.values(host.groups)) {
    for (const file of group.files) await stat(file);
    if (group.envFile) await stat(group.envFile);
  }
}

export async function smoke(
  host,
  attempts = 12,
  runDocker = docker,
  pause = () => new Promise((done) => setTimeout(done, 5000)),
  runCommand = command,
) {
  // Check only fixed, internal service URLs; no writes or credentials sent.
  const probes = Object.entries(catalog).map(([name, value]) => [
    name,
    value[3],
    name.endsWith('frontend') ? [200, 302, 303, 307, 308] : [200],
  ]);
  const script = `const probes=${JSON.stringify(probes)}; (async()=>{for(const [name,url,statuses] of probes){const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(10000)});await r.body?.cancel();if(!statuses.includes(r.status))process.exit(1);}})().catch(()=>process.exit(1));`;
  for (let n = 0; n < attempts; n++) {
    try {
      runDocker('exec', host.gatewayContainer, 'node', '-e', script);
      for (const check of host.publicChecks || []) {
        const url = new URL(check.url);
        const status = Number(
          runCommand('curl', [
            '--silent',
            '--show-error',
            '--max-time',
            '15',
            '--resolve',
            `${url.hostname}:443:127.0.0.1`,
            '--output',
            '/dev/null',
            '--write-out',
            '%{http_code}',
            url.href,
          ]),
        );
        if (!check.statuses.includes(status))
          throw Error('Public TLS/HTTP check failed');
      }
      return;
    } catch {
      if (n === attempts - 1) throw Error('Internal readiness failed');
      await pause();
    }
  }
}

export function makeAdapter(
  host,
  state,
  { runDocker = docker, probe = smoke, verify = checkConfig } = {},
) {
  const overrides = Object.fromEntries(
    ['full', 'sample'].map((g) => [g, resolve(state, g + '-attempt.json')]),
  );
  return {
    async snapshot() {
      const result = {};
      for (const [name, value] of Object.entries(catalog)) {
        const group = host.groups[value[2]];
        const service = value[2] === 'sample' ? name.slice(3) : name;
        const container = group.project + '-' + service + '-1';
        const info = JSON.parse(
          runDocker('inspect', '--format', '{{json .}}', container),
        );
        if (!info.State.Running) throw Error('Managed service is not running');
        result[name] = info.Image;
      }
      return result;
    },
    smoke: () => probe(host),
    checkConfig: () => verify(host),
    async pull(images) {
      for (const image of new Set(Object.values(images)))
        runDocker('pull', image);
    },
    async prepare(images) {
      for (const groupName of ['full', 'sample']) {
        const group = host.groups[groupName];
        await atomic(overrides[groupName], {
          services: groupImages(images, groupName),
        });
        runDocker(
          ...composeArguments(group, overrides[groupName], [
            'config',
            '--quiet',
          ]),
        );
      }
    },
    async deploy(images) {
      for (const groupName of ['full', 'sample']) {
        const group = host.groups[groupName];
        const services = groupImages(images, groupName);
        await atomic(overrides[groupName], { services });
        runDocker(
          ...composeArguments(group, overrides[groupName], [
            'config',
            '--quiet',
          ]),
        );
      }
      for (const groupName of ['full', 'sample']) {
        const group = host.groups[groupName];
        runDocker(
          ...composeArguments(group, overrides[groupName], [
            'up',
            '--detach',
            '--no-deps',
            '--no-build',
            '--pull',
            'never',
            '--force-recreate',
            ...Object.keys(groupImages(images, groupName)),
          ]),
        );
      }
    },
    async activate(images) {
      for (const groupName of ['full', 'sample']) {
        const file = host.groups[groupName].activeOverride;
        const existing = await json(file).catch(() => ({ services: {} }));
        const services = groupImages(images, groupName);
        // Preserve any unrelated content in the active image override.
        await atomic(file, {
          ...existing,
          services: { ...existing.services, ...services },
        });
      }
    },
    record: (record) =>
      atomic(resolve(state, 'last-attempt.json'), {
        ...record,
        at: new Date().toISOString(),
      }),
  };
}

export async function checkServiceReceipts(host, manifest) {
  for (const service of Object.keys(profiles)) {
    let receipt;
    try {
      receipt = await json(
        resolve(host.stateDirectory, service + '-last-attempt.json'),
      );
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (receipt.status !== 'released') continue;
    for (const name of profiles[service].services)
      if (manifest.images[name] !== receipt.images?.[name])
        throw Error(
          'Full release conflicts with active service receipt; align the manifest first',
        );
  }
}

export async function main(
  args = process.argv.slice(2),
  adapterFactory = makeAdapter,
  hostValidator = validateHost,
) {
  if (args.length !== 4 || !['check', 'deploy'].includes(args[0]))
    throw Error(
      'Usage: deploy.mjs check|deploy manifest.json host.json staging|production',
    );
  const [operation, manifestFile, hostFile, environment] = args;
  const manifest = validateManifest(await json(manifestFile));
  const host = hostValidator(await json(hostFile), environment);
  // Every operation fails closed until the schema owner evidence is recorded.
  if (/^pending/i.test(manifest.schemaEvidence.reviewedReference))
    throw Error('Record reviewed schema evidence before deployment');
  await checkConfig(host);
  await checkServiceReceipts(host, manifest);
  const state = host.stateDirectory;
  await mkdir(state, { recursive: true, mode: 0o700 });
  const acquired = [];
  try {
    for (const path of [resolve(state, 'release.lock'), host.sampleLock]) {
      const handle = await open(path, 'wx', 0o600);
      acquired.push([path, handle]);
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
      );
    }
    const adapter = adapterFactory(host, state);
    const baseline = await adapter.snapshot();
    if (
      Object.keys(catalog).some(
        (k) => !/^sha256:[a-f0-9]{64}$/.test(baseline[k] || ''),
      )
    )
      throw Error('Invalid baseline');
    await adapter.smoke();
    if (operation === 'check') {
      console.log('Host preflight passed; no containers changed.');
      return;
    }
    const status = await release(manifest, adapter);
    if (status !== 'released')
      throw Error('Release failed; inspect private last-attempt record');
    await atomic(resolve(state, 'receipt.json'), {
      status,
      environment,
      fingerprint: fingerprint(manifest),
      at: new Date().toISOString(),
    });
    console.log(
      'Release completed; secrets and application output suppressed.',
    );
  } finally {
    for (const [path, handle] of acquired.reverse()) {
      await handle.close();
      await unlink(path);
    }
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(() => {
    console.error(
      'Deployment/check failed. Inspect the private last-attempt record and host configuration; raw command errors suppressed.',
    );
    process.exitCode = 1;
  });
}
