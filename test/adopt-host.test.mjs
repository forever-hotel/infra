import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { captureHashes, draftHost } from '../scripts/adopt-host.mjs';
import { validateHost } from '../scripts/release-core.mjs';

test('host draft hashes public files only and never approves or overwrites a deployment', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'infra-adopt-'));
  try {
    const p = join(dir, 'public.json');
    await writeFile(p, '{}');
    const hashes = await captureHashes([p]);
    assert.match(hashes[p], /^[a-f0-9]{64}$/);
    await assert.rejects(captureHashes([join(dir, 'missing')]));
    const template = JSON.parse(
      await readFile('config/host.example.json', 'utf8'),
    );
    const output = join(dir, 'private', 'host.draft.json');
    const host = await draftHost(template, output, async (paths) =>
      Object.fromEntries(paths.map((path) => [path, 'a'.repeat(64)])),
    );
    assert.equal(host.adoptionApproved, false);
    assert.equal(template.adoptionApproved, false);
    assert(
      Object.keys(host.expectedConfigHashes).every(
        (path) => !path.endsWith('.env'),
      ),
    );
    assert.throws(() => validateHost(host, 'staging'));
    assert.equal(
      JSON.parse(await readFile(output, 'utf8')).adoptionApproved,
      false,
    );
    await assert.rejects(
      draftHost(template, output, async () => {
        throw Error('unreadable');
      }),
    );
    await assert.rejects(
      draftHost(template, output, async (paths) =>
        Object.fromEntries(paths.map((path) => [path, 'a'.repeat(64)])),
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
