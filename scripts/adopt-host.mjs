import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateHost } from './release-core.mjs';

export async function captureHashes(paths) {
  const result = {};
  for (const path of paths)
    result[path] = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  return result;
}

export async function draftHost(
  template,
  output,
  hashes = captureHashes,
  validator = validateHost,
) {
  const host = structuredClone(template);
  const paths = [
    host.caddyFile,
    ...Object.values(host.groups).flatMap((g) => g.files),
    host.groups.full.directory + '/config/gateway-routes.json',
  ];
  host.expectedConfigHashes = await hashes(paths);
  host.adoptionApproved = true;
  validator(host, host.environment);
  host.adoptionApproved = false;
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, JSON.stringify(host, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  return host;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 4)
      throw Error('Provide template and new draft path');
    await draftHost(
      JSON.parse(await readFile(process.argv[2], 'utf8')),
      process.argv[3],
    );
    console.log(
      'Private adoption draft created. Review paths/configuration and set adoptionApproved=true only after approval.',
    );
  } catch {
    console.error(
      'Host draft failed; existing files were not overwritten. Check public configuration paths.',
    );
    process.exitCode = 1;
  }
}
