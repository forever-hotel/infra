import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

// Explicitly invoked private-file check. Never print values, URLs, keys or raw errors.
export function checkFds({
  backend: b,
  frontend: f,
  websocket: w,
  broker: q,
  images,
  routes,
}) {
  const problems = [];
  const requireValue = (env, key, label) => {
    if (!env[key] || /replace|your_|your-|placeholder|example/i.test(env[key]))
      problems.push(`${label}: set ${key} privately`);
  };
  if (b.NODE_ENV !== 'production')
    problems.push('FDS backend: NODE_ENV must be production');
  if (b.DB_SYNCHRONIZE !== 'false' || b.DB_LOGGING !== 'false')
    problems.push(
      'FDS backend: disable schema synchronization and SQL parameter logging',
    );
  if (b.DATABASE_URL) {
    problems.push(
      'FDS backend: DATABASE_URL overrides DB_*; this rollout expects DB_* only, so reconcile the duplicate database configuration',
    );
  } else {
    for (const k of ['DB_HOST', 'DB_USERNAME', 'DB_PASSWORD', 'DB_NAME'])
      requireValue(b, k, 'FDS backend');
    if (
      !/^[a-zA-Z0-9.-]+$/.test(b.DB_HOST || '') ||
      /localhost|^127\./.test(b.DB_HOST || '')
    )
      problems.push('FDS backend: DB_HOST must be the Neon hostname only');
    if (b.DB_SSL !== 'true')
      problems.push('FDS backend: enable verified Neon TLS with DB_SSL=true');
  }
  const site = 'https://forever-hotel-frontdesk.duckdns.org';
  if (f.APP_ORIGIN !== site)
    problems.push(
      'FDS frontend: APP_ORIGIN must match the public Front Desk HTTPS origin',
    );
  if (f.API_GATEWAY_INTERNAL_URL !== 'http://gateway:8080')
    problems.push('FDS frontend: internal gateway address must use Docker DNS');
  if (b.AUTH_SERVICE_URL !== 'http://gateway:8080')
    problems.push(
      'FDS backend: staff session verification must use the shared gateway',
    );
  if (
    !(b.FDS_ALLOWED_ORIGINS || '')
      .split(',')
      .map((x) => x.trim())
      .includes(site)
  )
    problems.push(
      'FDS backend: include the exact public origin in FDS_ALLOWED_ORIGINS',
    );
  if (
    f.NEXT_PUBLIC_API_BASE_URL !== site + '/fds' ||
    f.NEXT_PUBLIC_WS_URL !== site
  )
    problems.push(
      'FDS frontend: verify the public API/socket build URLs (runtime values do not rebuild images)',
    );
  if (f.SHARED_WEBSOCKET_URL !== 'http://websocket:8081')
    problems.push('FDS frontend: shared WebSocket URL must use Docker DNS');
  requireValue(f, 'WEBSOCKET_RELAY_KEY', 'FDS frontend');
  if ((f.WEBSOCKET_RELAY_KEY || '').length < 32)
    problems.push('FDS frontend: relay key must have at least 32 characters');
  try {
    const registry = JSON.parse(w.WEBSOCKET_SUBSYSTEMS_JSON || '{}');
    const entry = registry.fds;
    if (
      !entry ||
      entry.relayKey !== f.WEBSOCKET_RELAY_KEY ||
      !entry.origins?.includes(site) ||
      entry.authUrl !== 'http://gateway:8080/fds/auth/session'
    )
      problems.push(
        'WebSocket: FDS registry, origin, verifier and private relay key must match',
      );
  } catch {
    problems.push('WebSocket: invalid subsystem registry JSON');
  }
  if (b.RABBITMQ_ENABLED === 'true') {
    try {
      const u = new URL(b.RABBITMQ_URL);
      if (
        u.protocol !== 'amqp:' ||
        u.hostname !== 'rabbitmq' ||
        (u.port && u.port !== '5672') ||
        decodeURIComponent(u.username) !== q.RABBITMQ_DEFAULT_USER ||
        decodeURIComponent(u.password) !== q.RABBITMQ_DEFAULT_PASS ||
        decodeURIComponent(u.pathname.slice(1)) !== q.RABBITMQ_DEFAULT_VHOST
      )
        problems.push(
          'FDS backend: broker URL does not match the configured private broker credentials/vhost',
        );
    } catch {
      problems.push('FDS backend: invalid broker connection URL');
    }
  }
  if (b.WKMS_INTEGRATION_ENABLED === 'true')
    problems.push(
      'Confirm WKMS is deployed and its live API works before enabling this integration',
    );
  if (b.FOSS_QR_MODE === 'mock')
    problems.push(
      'FDS backend: mock QR mode is forbidden for hosted deployment',
    );
  for (const k of ['FDS_BACKEND_IMAGE', 'FDS_FRONTEND_IMAGE'])
    if (
      !/^ghcr\.io\/forever-hotel\/front-desk\/(backend|frontend)@sha256:[a-f0-9]{64}$/.test(
        images[k] || '',
      )
    )
      problems.push(
        `Images: ${k} must reference a published Front Desk digest`,
      );
  if (
    !routes.some(
      (r) => r.id === 'fds' && r.enabled === true && r.rewritePrefix === '',
    )
  )
    problems.push(
      'Gateway: enable the FDS route with prefix stripping at the coordinated rollout step',
    );
  return problems;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(
    process.argv[2] || dirname(dirname(fileURLToPath(import.meta.url))),
  );
  try {
    const env = (name) =>
      parseEnv(readFileSync(resolve(root, 'env', name + '.env'), 'utf8'));
    const problems = checkFds({
      backend: env('fds-backend'),
      frontend: env('fds-frontend'),
      websocket: env('websocket'),
      broker: env('rabbitmq'),
      images: parseEnv(readFileSync(resolve(root, '.env'), 'utf8')),
      routes: JSON.parse(
        readFileSync(resolve(root, 'config/gateway-routes.json'), 'utf8'),
      ),
    });
    for (const message of problems) console.log('CHECK: ' + message);
    if (problems.length) process.exitCode = 1;
    else
      console.log(
        'FDS configuration checks passed. This does NOT verify live passwords, schema, images, network reachability, public routing or baked frontend settings.',
      );
  } catch {
    console.error(
      'Could not read or parse the required private configuration files. No values displayed.',
    );
    process.exitCode = 1;
  }
}
