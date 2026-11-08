import { readFile, writeFile, mkdir, rename, open, unlink, chmod, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, validateHost, changedServices, override, project, services } from './contracts.mjs';

const load = async path => JSON.parse(await readFile(path, 'utf8'));
async function optional(path) {
  try { return await load(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function save(path, value) {
  await writeFile(path + '.tmp', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await chmod(path + '.tmp', 0o600);
  await rename(path + '.tmp', path);
}

// Injected adapters let tests exercise failure/recovery without Docker or SSH.
export async function rollout({ previous, candidate, bootstrap = false, adapter }) {
  validateManifest(candidate);
  if (previous) validateManifest(previous);
  if (!previous && !bootstrap) throw new Error('Initial adoption requires explicit bootstrap approval');
  const changed = changedServices(previous, candidate);
  if (previous) await adapter.baseline(previous);
  if (!changed.length) { await adapter.smoke(); return { status: 'unchanged', changed }; }
  if (!previous) await adapter.empty();
  // A pull/provenance/config failure cannot have changed running services.
  await adapter.prepare(candidate, changed);
  try {
    await adapter.start(candidate, changed);
    await adapter.smoke();
    await adapter.accept(candidate, previous);
    return { status: 'deployed', changed };
  } catch {
    if (!previous) {
      await adapter.stop(changed);
      throw new Error('First release failed; candidate application containers stopped; no database or broker removed');
    }
    try {
      await adapter.restore(previous, changed);
      await adapter.smoke();
    } catch {
      throw new Error('Release failed and rollback could not be verified; operator intervention required');
    }
    throw new Error('Release failed; previous images restored and smoke verified');
  }
}

async function main() {
  const [command, manifestPath, ...flags] = process.argv.slice(2);
  const candidate = validateManifest(await load(manifestPath));
  if (command === 'validate') { console.log('Release manifest valid'); return; }
  if (command !== 'deploy' || flags.some(flag => flag !== '--bootstrap')) throw new Error('Use validate|deploy MANIFEST [--bootstrap]');
  const root = resolve(process.env.DEPLOY_ROOT || '/opt/forever-hotel');
  if (root !== '/opt/forever-hotel') throw new Error('This adapter only owns /opt/forever-hotel');
  const code = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const state = join(root, 'state');
  await mkdir(state, { recursive: true, mode: 0o700 });
  const lock = await open(join(state, 'release.lock'), 'wx', 0o600);
  try {
    const host = validateHost(await load(join(root, 'host.json')));
    for (const filename of ['.env', ...[...Object.keys(services), 'rabbitmq'].map(name => `env/${name}.env`)]) {
      const path = join(root, filename);
      const info = await stat(path);
      if ((info.mode & 0o077) !== 0) throw new Error(`Private configuration must have mode 600: ${filename}`);
      const content = await readFile(path, 'utf8');
      if (/REPLACE_WITH_|REPLACE_FRONTEND_HOST|localhost|127\.0\.0\.1/.test(content))
        throw new Error(`Replace development addresses/placeholders in private file: ${filename}`);
      if (filename === '.env' && !/^RABBITMQ_IMAGE=['"]?rabbitmq(?::[\w.-]+)?@sha256:[a-f0-9]{64}['"]?\s*$/m.test(content))
        throw new Error('Pin the reviewed RabbitMQ image by digest in the private host .env');
    }
    const previous = await optional(join(state, 'current.json'));
    const attempt = join(state, 'candidate.json');
    const compose = (manifest, args, quiet = false) => {
      execFileSync('docker', ['compose', '--project-name', project, '--project-directory', root,
        '-f', join(code, 'compose.yml'), '-f', manifest, ...args],
      { stdio: quiet ? 'pipe' : 'inherit', timeout: 240_000 });
    };
    const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 120_000 }).trim();
    const adapter = {
      async empty() {
        const existing = docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`]);
        if (existing) {
          for (const id of existing.split('\n')) {
            const item = JSON.parse(docker(['inspect', id]))[0];
            if (services[item.Config.Labels['com.docker.compose.service']])
              throw new Error('Application containers already exist; record/review an adoption baseline first');
          }
        }
      },
      async baseline(manifest) {
        for (const [service, entry] of Object.entries(manifest.services)) {
          const ids = docker(['ps', '-q', '--filter', `label=com.docker.compose.project=${project}`,
            '--filter', `label=com.docker.compose.service=${service}`]).split('\n').filter(Boolean);
          if (ids.length !== 1) throw new Error(`Baseline missing or ambiguous: ${service}`);
          const item = JSON.parse(docker(['inspect', ids[0]]))[0];
          if (item.Config.Image !== entry.image || item.State.Health?.Status !== 'healthy')
            throw new Error(`Baseline image/health drift: ${service}`);
        }
        await save(join(state, 'baseline.compose.json'), override(manifest));
        await adapter.smoke();
      },
      async prepare(manifest, changed) {
        await save(attempt, override(manifest));
        compose(attempt, ['config', '--quiet'], true);
        compose(attempt, ['pull', ...changed]);
        for (const service of changed) {
          const entry = manifest.services[service];
          const item = JSON.parse(docker(['image', 'inspect', entry.image]))[0];
          const repo = services[service][0];
          const labels = item.Config.Labels || {};
          if (labels['org.opencontainers.image.source'] !== `https://github.com/forever-hotel/${repo}` ||
              labels['org.opencontainers.image.revision'] !== entry.commit)
            throw new Error(`Image source/revision labels do not match reviewed manifest: ${service}`);
        }
      },
      async start(_manifest, changed) {
        compose(attempt, ['up', '-d', '--no-build', '--pull', 'never', '--no-deps', '--wait', '--wait-timeout', '120', ...changed]);
      },
      async smoke() {
        await Promise.all(host.smoke.map(async entry => {
          const response = await fetch(entry.url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
          if (!response.ok || !(await response.text()).includes(entry.contains))
            throw new Error(`HTTPS smoke failed: ${entry.id}`);
        }));
      },
      async accept(manifest, old) {
        if (old) await save(join(state, 'previous.json'), old);
        // current.json is the accepted manifest. active override is regenerated from it by operators.
        await save(join(state, 'current.json'), manifest);
      },
      async restore(_old, changed) {
        compose(join(state, 'baseline.compose.json'), ['up', '-d', '--no-build', '--pull', 'never', '--no-deps', '--wait', '--wait-timeout', '90', ...changed]);
      },
      async stop(changed) { compose(attempt, ['stop', ...changed]); },
    };
    const result = await rollout({ previous, candidate, bootstrap: flags.includes('--bootstrap'), adapter });
    await save(join(state, 'last-result.json'), result);
    console.log(JSON.stringify(result));
  } catch (error) {
    // Do not print Docker/environment output captured by failed validation commands.
    const message = error instanceof Error && !error.stdout && !error.stderr ? error.message : 'Deployment command failed; inspect server logs privately';
    await save(join(state, 'last-result.json'), { status: 'failed', message });
    throw new Error(message);
  } finally {
    await lock.close();
    await unlink(join(state, 'release.lock'));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
