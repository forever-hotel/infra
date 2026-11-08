export const project = 'forever-hotel-full';
export const services = {
  'mad-backend': ['manager-dashboard', 'backend', 'development'],
  'mad-frontend': ['manager-dashboard', 'frontend', 'development'],
  'fds-backend': ['front-desk', 'backend', 'develop'],
  'fds-frontend': ['front-desk', 'frontend', 'develop'],
  'wms-backend': ['worker-management', 'backend', 'develop'],
  'wms-frontend': ['worker-management', 'frontend', 'develop'],
  'hw-backend': ['hotel-website', 'backend', 'develop'],
  'hw-frontend': ['hotel-website', 'frontend', 'develop'],
  'foss-backend': ['food-ordering', 'backend', 'develop'],
  'foss-frontend': ['food-ordering', 'frontend', 'develop'],
  gateway: ['api-gateway', '', 'develop'],
  websocket: ['websocket-service', '', 'development'],
};

export function validateManifest(value) {
  if (value?.version !== 1 || !value.services || typeof value.services !== 'object')
    throw new Error('Expected version 1 release manifest');
  if (Object.keys(value).some(key => !['version', 'services'].includes(key)))
    throw new Error('Unknown manifest field');
  const keys = Object.keys(value.services);
  if (keys.length !== Object.keys(services).length || keys.some(key => !services[key]))
    throw new Error('Release must specify exactly the twelve supported application images');
  for (const [service, [repo, component]] of Object.entries(services)) {
    const entry = value.services[service];
    const prefix = `ghcr.io/forever-hotel/${repo}${component ? '/' + component : ''}@sha256:`;
    if (!entry || !/^[a-f0-9]{40}$/.test(entry.commit) ||
        typeof entry.image !== 'string' || !entry.image.startsWith(prefix) ||
        !/^[a-f0-9]{64}$/.test(entry.image.slice(prefix.length)) ||
        Object.keys(entry).some(key => !['image', 'commit'].includes(key)))
      throw new Error(`Invalid source commit or approved immutable image: ${service}`);
  }
  for (const name of ['mad', 'fds', 'wms', 'hw', 'foss'])
    if (value.services[`${name}-backend`].commit !== value.services[`${name}-frontend`].commit)
      throw new Error(`${name} frontend/backend must come from the same commit`);
  return value;
}

export function changedServices(previous, candidate) {
  return Object.keys(services).filter(key =>
    !previous || JSON.stringify(previous.services[key]) !== JSON.stringify(candidate.services[key]));
}

export function override(manifest) {
  return { services: Object.fromEntries(Object.entries(manifest.services).map(([key, entry]) => [key, { image: entry.image }])) };
}

export function validateHost(value) {
  if (!value || !Array.isArray(value.smoke) || value.smoke.length < 7)
    throw new Error('Host smoke config must include five frontends, gateway and WebSocket');
  const expected = ['mad', 'fds', 'wms', 'hw', 'foss', 'gateway', 'websocket'];
  if (value.smoke.length !== expected.length || new Set(value.smoke.map(e => e.id)).size !== expected.length)
    throw new Error('Each smoke target must appear exactly once');
  for (const entry of value.smoke) {
    const url = new URL(entry.url);
    if (!expected.includes(entry.id) || url.protocol !== 'https:' || url.username || url.password ||
        url.search || url.hash || /replace/i.test(url.hostname) || !entry.contains || typeof entry.contains !== 'string')
      throw new Error('Smoke needs approved HTTPS URLs and expected response text');
  }
  return value;
}
