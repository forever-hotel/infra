import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  readFile,
  writeFile,
  rename,
  mkdir,
  open,
  unlink,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const profiles = {
  mad: {
    repository: 'forever-hotel/manager-dashboard',
    branch: 'development',
    services: ['mad-backend', 'mad-frontend'],
    components: ['backend', 'frontend'],
    publicOrigins: ['https://forever-hotel-manager.duckdns.org'],
    probes: [
      ['http://mad-backend:4000/health/ready', [200]],
      ['http://mad-frontend:3000/', [200, 302, 303, 307, 308]],
      ['http://websocket:8081/health/ready', [200]],
      ['http://127.0.0.1:8080/health/ready', [200]],
    ],
  },
  fds: {
    repository: 'forever-hotel/front-desk',
    branch: 'develop',
    services: ['fds-backend', 'fds-frontend'],
    components: ['backend', 'frontend'],
    publicOrigins: ['https://forever-hotel-frontdesk.duckdns.org'],
    probes: [
      ['http://fds-backend:4001/health/ready', [200]],
      ['http://fds-frontend:3001/', [200, 302, 303, 307, 308]],
      ['http://websocket:8081/health/ready', [200]],
      ['http://127.0.0.1:8080/health/ready', [200]],
    ],
  },
  foss: {
    repository: 'forever-hotel/food-ordering',
    branch: 'develop',
    services: ['foss-backend', 'foss-frontend'],
    components: ['backend', 'frontend'],
    publicOrigins: ['https://forever-hotel-food.duckdns.org'],
    probes: [
      ['http://foss-backend:4300/health/ready', [200]],
      ['http://foss-frontend:3000/', [200, 302, 303, 307, 308]],
      ['http://websocket:8081/health/ready', [200]],
      ['http://127.0.0.1:8080/health/ready', [200]],
    ],
  },
  wkms: {
    repository: 'forever-hotel/worker-management',
    branch: 'develop',
    services: ['wkms-backend', 'wkms-frontend'],
    components: ['backend', 'frontend'],
    publicOrigins: ['https://forever-hotel-workers.duckdns.org'],
    probes: [
      ['http://wkms-backend:3000/health/ready', [200]],
      ['http://wkms-frontend:3001/', [200, 302, 303, 307, 308]],
      ['http://websocket:8081/health/ready', [200]],
      ['http://127.0.0.1:8080/health/ready', [200]],
    ],
  },
  kms: {
    repository: 'forever-hotel/kitchen-management',
    branch: 'develop',
    services: ['kms-backend', 'kms-frontend'],
    components: ['backend', 'frontend'],
    publicOrigins: ['https://forever-hotel-kitchen.duckdns.org'],
    probes: [
      ['http://kms-backend:4005/health/ready', [200]],
      ['http://kms-frontend:3005/', [200, 302, 303, 307, 308]],
      ['http://websocket:8081/health/ready', [200]],
      ['http://127.0.0.1:8080/health/ready', [200]],
    ],
  },
  gateway: {
    repository: 'forever-hotel/api-gateway',
    branch: 'develop',
    services: ['gateway'],
    components: ['image'],
    publicOrigins: [
      'https://forever-hotel-manager.duckdns.org',
      'https://forever-hotel-frontdesk.duckdns.org',
      'https://forever-hotel-food.duckdns.org',
      'https://forever-hotel-workers.duckdns.org',
      'https://forever-hotel-kitchen.duckdns.org',
      'https://forever-hotel-staging.malaysiawest.cloudapp.azure.com',
    ],
    probes: [
      ['http://mad-backend:4000/health/ready', [200]],
      ['http://mad-frontend:3000/', [200, 302, 303, 307, 308]],
      ['http://fds-backend:4001/health/ready', [200]],
      ['http://fds-frontend:3001/', [200, 302, 303, 307, 308]],
      ['http://foss-backend:4300/health/ready', [200]],
      ['http://foss-frontend:3000/', [200, 302, 303, 307, 308]],
      ['http://wkms-backend:3000/health/ready', [200]],
      ['http://wkms-frontend:3001/', [200, 302, 303, 307, 308]],
      ['http://kms-backend:4005/health/ready', [200]],
      ['http://kms-frontend:3005/', [200, 302, 303, 307, 308]],
      ['http://127.0.0.1:8080/health/ready', [200]],
      ['http://websocket:8081/health/ready', [200]],
      ['http://hotel-website-backend:3000/health/ready', [200]],
      ['http://hotel-website-frontend:3001/', [200, 302, 303, 307, 308]],
    ],
  },
  websocket: {
    repository: 'forever-hotel/websocket-service',
    branch: 'development',
    services: ['websocket'],
    components: ['image'],
    publicOrigins: [
      'https://forever-hotel-manager.duckdns.org',
      'https://forever-hotel-frontdesk.duckdns.org',
      'https://forever-hotel-food.duckdns.org',
      'https://forever-hotel-workers.duckdns.org',
      'https://forever-hotel-kitchen.duckdns.org',
      'https://forever-hotel-staging.malaysiawest.cloudapp.azure.com',
    ],
    probes: [
      ['http://mad-backend:4000/health/ready', [200]],
      ['http://mad-frontend:3000/', [200, 302, 303, 307, 308]],
      ['http://fds-backend:4001/health/ready', [200]],
      ['http://fds-frontend:3001/', [200, 302, 303, 307, 308]],
      ['http://foss-backend:4300/health/ready', [200]],
      ['http://foss-frontend:3000/', [200, 302, 303, 307, 308]],
      ['http://wkms-backend:3000/health/ready', [200]],
      ['http://wkms-frontend:3001/', [200, 302, 303, 307, 308]],
      ['http://kms-backend:4005/health/ready', [200]],
      ['http://kms-frontend:3005/', [200, 302, 303, 307, 308]],
      ['http://127.0.0.1:8080/health/ready', [200]],
      ['http://websocket:8081/health/ready', [200]],
      ['http://hotel-website-backend:3000/health/ready', [200]],
      ['http://hotel-website-frontend:3001/', [200, 302, 303, 307, 308]],
    ],
  },
};
export function serviceProfile(service) {
  if (!Object.hasOwn(profiles, service))
    throw Error('Unknown deployment profile');
  return profiles[service];
}
export function validateRelease(value, sha, service = 'fds') {
  const config = serviceProfile(service);
  if (!/^[a-f0-9]{40}$/.test(sha || '') || value?.commit !== sha)
    throw Error('Release commit mismatch');
  return Object.fromEntries(
    config.services.map((name, index) => {
      const component = config.components[index];
      const suffix = component === 'image' ? '' : '/' + component;
      const prefix = 'ghcr.io/' + config.repository + suffix + '@sha256:';
      const image = value[component];
      if (
        typeof image !== 'string' ||
        !image.startsWith(prefix) ||
        !/^[a-f0-9]{64}$/.test(image.slice(prefix.length))
      )
        throw Error('Invalid service image');
      return [name, image];
    }),
  );
}
export async function rollout(images, adapter) {
  console.log('Checking current service containers and configuration.');
  const baseline = await adapter.snapshot();
  await adapter.check();
  await adapter.health();
  console.log('Baseline checks passed; pulling selected immutable images.');
  await adapter.pull(images);
  await adapter.check();
  try {
    console.log('Replacing only the selected service containers.');
    await adapter.replace(images);
    console.log('Checking the new service readiness and public HTTPS.');
    await adapter.health();
    await adapter.activate(images);
    await adapter.record({ status: 'released', images, baseline });
  } catch {
    try {
      await adapter.replace(baseline);
      await adapter.health();
      await adapter.activate(baseline);
      await adapter.record({ status: 'failed_rolled_back', images, baseline });
    } catch {
      await adapter.record({
        status: 'failed_rollback_unverified',
        images,
        baseline,
      });
    }
    throw Error('Service rollout failed');
  }
}
export const run = (file, args) =>
  execFileSync(file, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 300000,
  }).trim();
const docker = (...args) => run('sudo', ['-n', 'docker', ...args]);
export const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
export async function atomic(file, value) {
  const temporary = file + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
  });
  await rename(temporary, file);
}
const defaults = {
  readFile,
  mkdir,
  open,
  unlink,
  json,
  atomic,
  docker,
  run,
  pause: () => new Promise((done) => setTimeout(done, 5000)),
};
export async function main(
  [manifestFile, expectedSha, hostFile, service = 'fds'],
  dependencies = {},
) {
  const { readFile, mkdir, open, unlink, json, atomic, docker, run, pause } = {
    ...defaults,
    ...dependencies,
  };
  const config = serviceProfile(service);
  const names = config.services;
  const images = validateRelease(
    await json(manifestFile),
    expectedSha,
    service,
  );
  const host = await json(hostFile);
  const group = host.groups?.full;
  if (
    host.environment !== 'staging' ||
    host.adoptionApproved !== true ||
    host.stateDirectory !== '/opt/forever-hotel/.infra-release' ||
    host.sampleLock !==
      '/opt/hotel-website-staging/.sample-release/release.lock' ||
    group?.directory !== '/opt/forever-hotel' ||
    group.project !== 'forever-hotel-full' ||
    group.activeOverride !==
      '/opt/forever-hotel/.infra-release/active-images.json' ||
    !Array.isArray(group.files) ||
    !group.files.length ||
    !Array.isArray(group.profiles) ||
    !host.expectedConfigHashes ||
    Object.keys(host.expectedConfigHashes).length < 4
  )
    throw Error('Approved staging host required');
  const state = host.stateDirectory;
  await mkdir(state, { recursive: true, mode: 0o700 });
  const locks = [];
  try {
    for (const file of [resolve(state, 'release.lock'), host.sampleLock]) {
      let handle;
      for (let attempt = 0; attempt < 120; attempt++) {
        try {
          handle = await open(file, 'wx', 0o600);
          break;
        } catch (error) {
          if (error.code !== 'EEXIST' || attempt === 119) throw error;
          if (attempt === 0)
            console.log('Waiting for another VM release to finish.');
          await pause();
        }
      }
      locks.push([file, handle]);
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          commit: expectedSha,
          at: new Date().toISOString(),
        }),
      );
    }
    const source = run('git', [
      'ls-remote',
      'https://github.com/' + config.repository + '.git',
      'refs/heads/' + config.branch,
    ]);
    if (source.split(/\s/)[0] !== expectedSha)
      throw Error('Stale release after waiting for lock');
    const override = resolve(state, service + '-attempt.json');
    const compose = (file, operation) =>
      docker(
        'compose',
        '--project-name',
        group.project,
        '--project-directory',
        group.directory,
        ...(group.envFile ? ['--env-file', group.envFile] : []),
        ...group.files.flatMap((path) => ['-f', path]),
        '-f',
        file,
        ...group.profiles.flatMap((profile) => ['--profile', profile]),
        ...operation,
      );
    const adapter = {
      async check() {
        for (const [path, hash] of Object.entries(host.expectedConfigHashes))
          if (
            createHash('sha256')
              .update(await readFile(path))
              .digest('hex') !== hash
          )
            throw Error('Host configuration drift');
      },
      async snapshot() {
        const baseline = {};
        for (const name of names) {
          const info = JSON.parse(
            docker(
              'inspect',
              '--format',
              '{{json .}}',
              group.project + '-' + name + '-1',
            ),
          );
          if (!info.State.Running || !/^sha256:[a-f0-9]{64}$/.test(info.Image))
            throw Error('Service baseline unavailable');
          baseline[name] = info.Image;
        }
        return baseline;
      },
      async health() {
        for (let attempt = 0; attempt < 12; attempt++) {
          try {
            const script =
              '(async()=>{for(const [url,statuses] of ' +
              JSON.stringify(config.probes) +
              '){const r=await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(10000)});await r.body?.cancel();if(!statuses.includes(r.status))process.exit(1)}})().catch(()=>process.exit(1))';
            docker('exec', host.gatewayContainer, 'node', '-e', script);
            for (const origin of config.publicOrigins) {
              const hostname = new URL(origin).hostname;
              const status = run('curl', [
                '--silent',
                '--show-error',
                '--max-time',
                '15',
                '--resolve',
                hostname + ':443:127.0.0.1',
                '--output',
                '/dev/null',
                '--write-out',
                '%{http_code}',
                origin + '/',
              ]);
              if (![200, 302, 303, 307, 308].includes(Number(status)))
                throw Error('Public health failed');
            }
            return;
          } catch {
            if (attempt === 11) throw Error('Service health failed');
            await pause();
          }
        }
      },
      async pull(next) {
        for (const image of Object.values(next)) docker('pull', image);
      },
      async replace(next) {
        await atomic(override, {
          services: Object.fromEntries(
            names.map((name) => [name, { image: next[name] }]),
          ),
        });
        compose(override, ['config', '--quiet']);
        compose(override, [
          'up',
          '-d',
          '--no-deps',
          '--no-build',
          '--pull',
          'never',
          '--force-recreate',
          ...names,
        ]);
      },
      async activate(next) {
        let current;
        try {
          current = await json(group.activeOverride);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          current = { services: {} };
        }
        await atomic(group.activeOverride, {
          ...current,
          services: {
            ...current.services,
            ...Object.fromEntries(
              names.map((name) => [name, { image: next[name] }]),
            ),
          },
        });
      },
      record: (record) =>
        atomic(resolve(state, service + '-last-attempt.json'), {
          ...record,
          commit: expectedSha,
          at: new Date().toISOString(),
        }),
    };
    await rollout(images, adapter);
    console.log('Service staging release passed.');
  } finally {
    for (const [file, handle] of locks.reverse()) {
      await handle.close();
      await unlink(file);
    }
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main(process.argv.slice(2)).catch((error) => {
    const safe =
      /^(Unknown deployment profile|Release commit mismatch|Invalid service image|Approved staging host required|Host configuration drift|Service baseline unavailable|Service health failed|Service rollout failed|Stale release after waiting for lock)$/;
    console.error(
      safe.test(error.message)
        ? error.message
        : 'Service deployment failed; inspect the last phase above and private service release record.',
    );
    process.exitCode = 1;
  });
