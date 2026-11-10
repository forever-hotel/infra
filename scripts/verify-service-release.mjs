import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serviceProfile, validateRelease } from './service-release.mjs';
import { githubApi, peerGate } from './github-gate.mjs';

export async function verifyPublication(release, service, env, api) {
  const profile = serviceProfile(service);
  if (
    env.GITHUB_REPOSITORY !== profile.repository ||
    env.GITHUB_REF !== 'refs/heads/' + profile.branch ||
    env.GITHUB_EVENT_NAME !== 'push'
  )
    throw Error('Unexpected release context');
  validateRelease(release, env.GITHUB_SHA, service);
  const branch = await api(
    '/repos/' + profile.repository + '/branches/' + profile.branch,
  );
  if (branch.commit?.sha !== env.GITHUB_SHA) throw Error('Stale release');
  await peerGate({
    api,
    repository: profile.repository,
    sha: env.GITHUB_SHA,
    branch: profile.branch,
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  verifyPublication(
    JSON.parse(readFileSync(process.argv[2], 'utf8')),
    process.argv[3],
    process.env,
    (path) => githubApi(path, fetch, process.env.GITHUB_TOKEN),
  )
    .then(() =>
      console.log(
        'Source repository, latest release commit and final-head peer approval verified.',
      ),
    )
    .catch(() => {
      console.error(
        'Service release verification failed: check source branch, latest commit and final-head approval.',
      );
      process.exitCode = 1;
    });
}
