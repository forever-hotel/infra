import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateManifest } from './release-core.mjs';

export function validateRoutes(routes) {
  if (!Array.isArray(routes) || routes.length === 0)
    throw Error('Routes must be a nonempty array');
  const ids = new Set(),
    prefixes = new Set(),
    cookies = new Map();
  for (const r of routes) {
    if (!r || typeof r.enabled !== 'boolean')
      throw Error('Invalid route enabled flag');
    if (!r.enabled) continue;
    if (
      !/^[a-z][a-z0-9-]*$/.test(r.id || '') ||
      !/^\/[a-z][a-z0-9/-]*$/.test(r.prefix || '') ||
      !(
        r.rewritePrefix === '' ||
        /^\/[a-z][a-z0-9/-]*$/.test(r.rewritePrefix || '')
      )
    )
      throw Error('Invalid route identity or prefix');
    if (ids.has(r.id) || prefixes.has(r.prefix))
      throw Error('Duplicate route identity or prefix');
    if (!/^[A-Z_]+$/.test(r.upstreamEnv || ''))
      throw Error('Invalid upstream environment name');
    ids.add(r.id);
    prefixes.add(r.prefix);
    if (
      !Array.isArray(r.cookieNames) ||
      new Set(r.cookieNames).size !== r.cookieNames.length
    )
      throw Error('Invalid cookie list');
    const path = r.prefix.split('/')[1];
    for (const name of r.cookieNames) {
      if (!/^[A-Za-z0-9_-]+$/.test(name) || name.startsWith('__Host-'))
        throw Error('Invalid cookie name');
      if (cookies.has(name) && cookies.get(name) !== path)
        throw Error('Cookie reused across prefixes');
      cookies.set(name, path);
    }
  }
  if (!ids.size) throw Error('At least one enabled route required');
}

export function validateRelease(release) {
  if (
    !release ||
    !/^forever-hotel\/[a-z0-9-]+$/.test(release.repository || '') ||
    !/^[a-f0-9]{40}$/.test(release.commit || '')
  )
    throw Error('Invalid release provenance');
  const refs = [release.frontend, release.backend, release.image].filter(
    (x) => x !== undefined,
  );
  if (
    !refs.length ||
    refs.some(
      (x) =>
        typeof x !== 'string' ||
        (!x.startsWith('ghcr.io/' + release.repository + '@') &&
          !x.startsWith('ghcr.io/' + release.repository + '/')) ||
        !/@sha256:[a-f0-9]{64}$/.test(x),
    )
  )
    throw Error('Invalid immutable image reference');
}

export function validateRepository(root) {
  const json = (file) =>
    JSON.parse(
      readFileSync(resolve(root, file), 'utf8').replace(/^#.*\r?\n/, ''),
    );
  for (const file of [
    'compose.yml',
    'compose.sample-transition.yml',
    'compose.kms.yml',
  ]) {
    if (!json(file).services) throw Error('Compose services missing');
  }
  validateRoutes(json('config/gateway-routes.json'));
  for (const file of readdirSync(resolve(root, 'config/snapshots')).filter(
    (x) => x.startsWith('gateway-routes.') && x.endsWith('.json'),
  ))
    validateRoutes(json('config/snapshots/' + file));
  for (const file of readdirSync(resolve(root, 'releases')).filter((x) =>
    x.endsWith('.json'),
  ))
    validateRelease(json('releases/' + file));
  // The fixture-only validator tests may omit release/current.json. The real CI build validates it separately.
  return true;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    validateRepository(process.cwd());
    validateManifest(JSON.parse(readFileSync('release/current.json', 'utf8')));
    console.log(
      'PASS: Compose JSON structure, route/cookie contracts and immutable release records.',
    );
  } catch {
    console.error(
      'FAIL: repository configuration validation. No file contents or secrets displayed.',
    );
    process.exitCode = 1;
  }
}
