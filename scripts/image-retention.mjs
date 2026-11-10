import { setImmediate as yieldToIO } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { readFile, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { profiles } from './service-release.mjs';

const imageId = (value) => /^sha256:[a-f0-9]{64}$/.test(value || '');
export function managedPackages() {
  return new Set(
    Object.values(profiles).flatMap((profile) =>
      profile.components.map(
        (component) =>
          'ghcr.io/' +
          profile.repository +
          (component === 'image' ? '' : '/' + component),
      ),
    ),
  );
}
export function packageOf(reference) {
  if (typeof reference !== 'string') return null;
  const match =
    /^(ghcr\.io\/forever-hotel\/[a-z0-9/-]+)(?:@sha256:[a-f0-9]{64}|:[A-Za-z0-9_.-]+)$/.exec(
      reference,
    );
  return match?.[1] || null;
}
export function planRetention({
  images,
  containers,
  receipts,
  now = Date.now(),
  minAgeMs = 86400000,
}) {
  if (
    !Array.isArray(images) ||
    !Array.isArray(containers) ||
    !receipts ||
    !Number.isFinite(now) ||
    !Number.isFinite(minAgeMs) ||
    minAgeMs < 86400000
  )
    throw Error('Invalid retention inventory');
  const inventory = new Map(images.map((image) => [image.id, image]));
  const owned = managedPackages();
  const protectedIds = new Set(containers.map((container) => container.image));
  const eligible = new Set();
  const skipped = [];
  for (const [service, profile] of Object.entries(profiles)) {
    const receipt = receipts[service];
    const verified = [];
    for (let index = 0; index < profile.services.length; index++) {
      const name = profile.services[index];
      const component = profile.components[index];
      const pkg =
        'ghcr.io/' +
        profile.repository +
        (component === 'image' ? '' : '/' + component);
      const containerName =
        profile.group === 'sample'
          ? 'hotel-website-sample-' + name.slice(3) + '-1'
          : 'forever-hotel-full-' + name + '-1';
      const container = containers.find(
        (value) => value.name === containerName,
      );
      const current = inventory.get(container?.image);
      const previous = inventory.get(receipt?.baseline?.[name]);
      const published = receipt?.images?.[name];
      if (
        receipt?.status !== 'released' ||
        !container?.running ||
        !current ||
        !previous ||
        !imageId(current.id) ||
        !imageId(previous.id) ||
        current.id === previous.id ||
        packageOf(published) !== pkg ||
        !(
          container.reference === published || current.refs.includes(published)
        ) ||
        !previous.refs.some((ref) => packageOf(ref) === pkg)
      )
        break;
      verified.push({ pkg, current: current.id, previous: previous.id });
    }
    if (verified.length !== profile.services.length) {
      skipped.push(service);
      continue;
    }
    for (const value of verified) {
      eligible.add(value.pkg);
      protectedIds.add(value.current);
      protectedIds.add(value.previous);
    }
  }
  const candidates = images
    .filter((image) => {
      if (
        !imageId(image.id) ||
        protectedIds.has(image.id) ||
        !Array.isArray(image.refs) ||
        !image.refs.length
      )
        return false;
      const created = Date.parse(image.created);
      if (!Number.isFinite(created) || now - created < minAgeMs) return false;
      return image.refs.every(
        (ref) => owned.has(packageOf(ref)) && eligible.has(packageOf(ref)),
      );
    })
    .map((image) => ({ id: image.id, refs: [...new Set(image.refs)] }));
  return { candidates, protectedIds: [...protectedIds], skipped };
}
let interrupted = false;
export async function applyRetention(plan, adapter, cancelled = () => false) {
  const removed = [];
  const skipped = [];
  for (const candidate of plan.candidates) {
    await yieldToIO();
    if (cancelled()) throw Error('Cleanup interrupted');
    if ((await adapter.usedImages()).includes(candidate.id)) {
      skipped.push(candidate.id);
      continue;
    }
    const current = await adapter.inspect(candidate.id);
    if (
      !current ||
      current.id !== candidate.id ||
      current.refs.length !== candidate.refs.length ||
      current.refs.some((ref) => !candidate.refs.includes(ref))
    ) {
      skipped.push(candidate.id);
      continue;
    }
    for (const ref of candidate.refs) {
      await yieldToIO();
      if (cancelled()) throw Error('Cleanup interrupted');
      const target = await adapter.inspect(ref);
      if (!target || target.id !== candidate.id) {
        skipped.push(candidate.id);
        break;
      }
      // Never force removal: Docker also protects images referenced by containers.
      await adapter.remove(ref);
    }
    if (!(await adapter.inspect(candidate.id))) removed.push(candidate.id);
  }
  return { removed, skipped };
}
const docker = (...args) =>
  execFileSync('sudo', ['-n', 'docker', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  }).trim();
function imageMetadata(value) {
  return {
    id: value.Id,
    created: value.Created,
    refs: [...(value.RepoTags || []), ...(value.RepoDigests || [])].filter(
      (ref) => !ref.includes('<none>'),
    ),
  };
}
export function inventoryAdapter(runDocker = docker) {
  const ids = (...args) => [
    ...new Set(
      runDocker(...args)
        .split(/\s+/)
        .filter(Boolean),
    ),
  ];
  const containers = () => {
    const all = ids('ps', '-aq', '--no-trunc');
    if (!all.length) return [];
    return JSON.parse(runDocker('inspect', ...all)).map((value) => ({
      name: value.Name.replace(/^\//, ''),
      image: value.Image,
      reference: value.Config.Image,
      running: value.State.Running,
    }));
  };
  return {
    snapshot(receipts) {
      const all = ids('image', 'ls', '-q', '--no-trunc');
      const images = all.length
        ? JSON.parse(runDocker('image', 'inspect', ...all)).map(imageMetadata)
        : [];
      return { images, containers: containers(), receipts };
    },
    adapter: {
      usedImages: async () => containers().map((value) => value.image),
      inspect: async (reference) => {
        try {
          return imageMetadata(
            JSON.parse(runDocker('image', 'inspect', reference))[0],
          );
        } catch (error) {
          if (/No such image|No such object/i.test(String(error.stderr || '')))
            return null;
          throw error;
        }
      },
      remove: async (reference) => {
        runDocker('image', 'rm', '--no-prune', reference);
      },
    },
  };
}
export async function main(args = process.argv.slice(2), io = {}) {
  const mode = args[0];
  if (!['--dry-run', '--apply'].includes(mode))
    throw Error('Use --dry-run or --apply');
  const hostFile = '/opt/forever-hotel/.infra-release/host.json';
  const read = io.readFile || readFile;
  const acquire = io.open || open;
  const removeLock = io.unlink || unlink;
  const host = JSON.parse(await read(hostFile, 'utf8'));
  if (
    host.environment !== 'staging' ||
    host.adoptionApproved !== true ||
    host.stateDirectory !== '/opt/forever-hotel/.infra-release' ||
    host.sampleLock !==
      '/opt/hotel-website-staging/.sample-release/release.lock'
  )
    throw Error('Approved staging host required');
  const locks = [];
  try {
    for (const file of [
      resolve(host.stateDirectory, 'release.lock'),
      host.sampleLock,
    ]) {
      const handle = await acquire(file, 'wx', 0o600);
      locks.push([file, handle]);
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          operation: 'image-retention',
          at: new Date().toISOString(),
        }),
      );
    }
    const receipts = {};
    for (const service of Object.keys(profiles)) {
      try {
        receipts[service] = JSON.parse(
          await read(
            resolve(host.stateDirectory, service + '-last-attempt.json'),
            'utf8',
          ),
        );
      } catch {
        receipts[service] = null;
      }
    }
    const production = inventoryAdapter();
    const snapshot = io.snapshot || production.snapshot;
    const data = await snapshot(receipts);
    const plan = planRetention(data);
    console.log(
      JSON.stringify({
        mode,
        eligibleOldImages: plan.candidates.map((value) => value.id),
        protectedImageCount: plan.protectedIds.length,
        skippedServices: plan.skipped,
      }),
    );
    if (mode === '--dry-run') return plan;
    const adapter = io.adapter || production.adapter;
    const result = await applyRetention(
      plan,
      adapter,
      io.cancelled || (() => interrupted),
    );
    console.log(
      JSON.stringify({
        removedImageCount: result.removed.length,
        skippedAfterRecheck: result.skipped.length,
      }),
    );
    return result;
  } finally {
    for (const [file, handle] of locks.reverse()) {
      await handle.close();
      await removeLock(file);
    }
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.once('SIGTERM', () => {
    interrupted = true;
  });
  process.once('SIGINT', () => {
    interrupted = true;
  });
  main().catch((error) => {
    console.error(
      error.code === 'EEXIST'
        ? 'Cleanup skipped: a deployment or cleanup lock is held.'
        : 'Cleanup stopped without forcing any removal. Inspect the private VM journal.',
    );
    process.exitCode = error.code === 'EEXIST' ? 0 : 1;
  });
}
