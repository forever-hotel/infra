import { createHash } from 'node:crypto';

export const catalog = {
  gateway: ['api-gateway', '', 'full', 'http://127.0.0.1:8080/health/ready'],
  websocket: [
    'websocket-service',
    '',
    'full',
    'http://websocket:8081/health/ready',
  ],
  'mad-backend': [
    'manager-dashboard',
    '/backend',
    'full',
    'http://mad-backend:4000/health/ready',
  ],
  'mad-frontend': [
    'manager-dashboard',
    '/frontend',
    'full',
    'http://mad-frontend:3000/',
  ],
  'fds-backend': [
    'front-desk',
    '/backend',
    'full',
    'http://fds-backend:4001/health/ready',
  ],
  'fds-frontend': [
    'front-desk',
    '/frontend',
    'full',
    'http://fds-frontend:3001/',
  ],
  'foss-backend': [
    'food-ordering',
    '/backend',
    'full',
    'http://foss-backend:4300/health/ready',
  ],
  'foss-frontend': [
    'food-ordering',
    '/frontend',
    'full',
    'http://foss-frontend:3000/',
  ],
  'wkms-backend': [
    'worker-management',
    '/backend',
    'full',
    'http://wkms-backend:3000/health/ready',
  ],
  'wkms-frontend': [
    'worker-management',
    '/frontend',
    'full',
    'http://wkms-frontend:3001/',
  ],
  'kms-backend': [
    'kitchen-management',
    '/backend',
    'full',
    'http://kms-backend:4005/health/ready',
  ],
  'kms-frontend': [
    'kitchen-management',
    '/frontend',
    'full',
    'http://kms-frontend:3005/',
  ],
  'hw-backend': [
    'hotel-website',
    '/backend',
    'sample',
    'http://hotel-website-backend:3000/health/ready',
  ],
  'hw-frontend': [
    'hotel-website',
    '/frontend',
    'sample',
    'http://hotel-website-frontend:3001/',
  ],
};

export function validateManifest(manifest) {
  if (
    manifest?.schemaVersion !== 1 ||
    !manifest.images ||
    Object.keys(manifest.images).length !== Object.keys(catalog).length
  )
    throw Error('Invalid release schema or service set');
  for (const [name, [repo, suffix]] of Object.entries(catalog)) {
    const prefix = `ghcr.io/forever-hotel/${repo}${suffix}@sha256:`;
    const image = manifest.images[name];
    if (
      typeof image !== 'string' ||
      !image.startsWith(prefix) ||
      !/^[a-f0-9]{64}$/.test(image.slice(prefix.length))
    )
      throw Error('Invalid image for ' + name);
  }
  if (
    !manifest.schemaEvidence ||
    typeof manifest.schemaEvidence.reviewedReference !== 'string' ||
    manifest.schemaEvidence.reviewedReference.length < 3
  )
    throw Error('Schema review evidence required');
  return manifest;
}

export function fingerprint(manifest) {
  validateManifest(manifest);
  return createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: 1,
        images: Object.fromEntries(
          Object.keys(catalog)
            .sort()
            .map((k) => [k, manifest.images[k]]),
        ),
        schemaEvidence: manifest.schemaEvidence,
      }),
    )
    .digest('hex');
}

export function validateHost(host, environment) {
  if (
    !['staging', 'production'].includes(environment) ||
    host?.environment !== environment ||
    host?.adoptionApproved !== true
  )
    throw Error('Host adoption/environment not approved');
  const absolute = (value) =>
    typeof value === 'string' &&
    /^\/[A-Za-z0-9_./-]+$/.test(value) &&
    !value.split('/').includes('..') &&
    value !== '/';
  if (
    !absolute(host.stateDirectory) ||
    !absolute(host.caddyFile) ||
    !/^[a-z][a-z0-9_-]+$/.test(host.gatewayContainer || '')
  )
    throw Error('Invalid host state/Caddy/gateway');
  for (const name of ['full', 'sample']) {
    const g = host.groups?.[name];
    if (
      !g ||
      !absolute(g.directory) ||
      !/^[a-z][a-z0-9-]+$/.test(g.project || '') ||
      !Array.isArray(g.files) ||
      !g.files.length ||
      g.files.some((p) => !absolute(p)) ||
      !Array.isArray(g.profiles) ||
      g.profiles.some((p) => !/^[a-z]+$/.test(p))
    )
      throw Error('Invalid host group ' + name);
    if (g.envFile !== null && !absolute(g.envFile))
      throw Error('Invalid environment file');
    if (!absolute(g.activeOverride))
      throw Error('Invalid active image override');
  }
  if (!absolute(host.sampleLock)) throw Error('Invalid sample lock');
  if (
    !host.expectedConfigHashes ||
    Object.keys(host.expectedConfigHashes).length < 4 ||
    Object.entries(host.expectedConfigHashes).some(
      ([p, hash]) => !absolute(p) || !/^[a-f0-9]{64}$/.test(hash),
    )
  )
    throw Error('Adopted public configuration hashes required');
  const required = [
    host.caddyFile,
    ...Object.values(host.groups).flatMap((g) => g.files),
    host.groups.full.directory + '/config/gateway-routes.json',
  ];
  if (required.some((p) => !host.expectedConfigHashes[p]))
    throw Error('Every adopted public config needs a hash');
  if (!Array.isArray(host.publicChecks) || host.publicChecks.length < 6)
    throw Error('All six public applications need checks');
  for (const check of host.publicChecks) {
    const url = new URL(check.url);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !/^[a-zA-Z0-9.-]+$/.test(url.hostname) ||
      !Array.isArray(check.statuses) ||
      !check.statuses.length ||
      check.statuses.some((n) => !Number.isInteger(n) || n < 100 || n > 599)
    )
      throw Error('Invalid public HTTPS check');
  }
  return host;
}

export function groupImages(images, group) {
  return Object.fromEntries(
    Object.keys(catalog)
      .filter((name) => catalog[name][2] === group)
      .map((name) => [
        group === 'sample' ? name.slice(3) : name,
        { image: images[name] },
      ]),
  );
}

export async function release(manifest, adapter) {
  validateManifest(manifest);
  const baseline = await adapter.snapshot();
  if (
    Object.keys(catalog).some(
      (k) => !/^sha256:[a-f0-9]{64}$/.test(baseline[k] || ''),
    )
  )
    throw Error('Every managed service must already be running for adoption');
  await adapter.smoke();
  await adapter.record({
    status: 'prepared',
    fingerprint: fingerprint(manifest),
    baseline,
  });
  // Registry or preflight failures occur before any container replacement.
  await adapter.prepare(manifest.images);
  await adapter.pull(manifest.images);
  let started = false;
  try {
    await adapter.checkConfig();
    started = true;
    await adapter.deploy(manifest.images);
    await adapter.smoke();
    await adapter.activate(manifest.images);
    await adapter.record({
      status: 'released',
      fingerprint: fingerprint(manifest),
      baseline,
    });
    return 'released';
  } catch {
    if (!started)
      throw Error('Host configuration changed; release not applied');
    try {
      await adapter.deploy(baseline);
      await adapter.smoke();
      await adapter.activate(baseline);
      await adapter.record({
        status: 'failed_rolled_back',
        fingerprint: fingerprint(manifest),
        baseline,
      });
      return 'failed_rolled_back';
    } catch {
      await adapter.record({
        status: 'failed_rollback_unverified',
        fingerprint: fingerprint(manifest),
        baseline,
      });
      return 'failed_rollback_unverified';
    }
  }
}
