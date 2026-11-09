import { readFileSync } from 'node:fs';
import { fingerprint } from './release-core.mjs';

export async function peerGate({ api, repository, sha, branch }) {
  const pulls = await api(
    `/repos/${repository}/commits/${sha}/pulls?per_page=100`,
  );
  for (const pr of pulls.filter(
    (p) => p.merged_at && p.base.ref === branch && p.merge_commit_sha === sha,
  )) {
    const reviews = await api(
      `/repos/${repository}/pulls/${pr.number}/reviews?per_page=100`,
    );
    const latest = new Map();
    for (const review of reviews)
      if (
        review.user &&
        ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)
      )
        latest.set(review.user.login, review);
    const decisions = [...latest.values()];
    if (
      decisions.some(
        (r) =>
          r.state === 'APPROVED' &&
          r.commit_id === pr.head.sha &&
          r.user.login !== pr.user.login,
      ) &&
      !decisions.some((r) => r.state === 'CHANGES_REQUESTED')
    )
      return;
  }
  throw Error('Final release commit needs peer approval');
}

export async function productionGate({ api, repository, manifest, receipt }) {
  if (
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(
      manifest.version || '',
    ) ||
    !Number.isSafeInteger(manifest.stagingRunId) ||
    manifest.stagingRunId < 1
  )
    throw Error('Production version and successful staging run required');
  const run = await api(
    `/repos/${repository}/actions/runs/${manifest.stagingRunId}`,
  );
  if (
    run.event !== 'push' ||
    run.head_branch !== 'develop' ||
    run.conclusion !== 'success' ||
    run.path !== '.github/workflows/ci.yml'
  )
    throw Error('Not a successful staging CI run');
  if (
    receipt.status !== 'released' ||
    receipt.environment !== 'staging' ||
    receipt.fingerprint !== fingerprint(manifest)
  )
    throw Error('Production must promote the exact staged manifest');
  const environment = await api(`/repos/${repository}/environments/production`);
  if (
    !environment.protection_rules?.some(
      (r) => r.type === 'required_reviewers' && r.reviewers?.length,
    )
  )
    throw Error('Production environment must require reviewers');
}

export async function githubApi(
  path,
  fetcher = fetch,
  token = process.env.GITHUB_TOKEN,
) {
  if (!token || !/^\/[A-Za-z0-9_./?=&-]+$/.test(path))
    throw Error('Invalid GitHub API request');
  const values = [];
  for (let page = 1; page <= 100; page++) {
    const suffix = path.includes('?') ? '&page=' : '?page=';
    const r = await fetcher('https://api.github.com' + path + suffix + page, {
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw Error('GitHub evidence not available');
    const value = await r.json();
    if (!Array.isArray(value)) return value;
    values.push(...value);
    if (value.length < 100) return values;
  }
  throw Error('GitHub pagination limit exceeded');
}

export async function main(
  args = process.argv.slice(2),
  env = process.env,
  api = githubApi,
  read = (file) => JSON.parse(readFileSync(file, 'utf8')),
) {
  const repository = env.GITHUB_REPOSITORY;
  const sha = env.GITHUB_SHA;
  if (
    !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') ||
    !/^[a-f0-9]{40}$/.test(sha || '')
  )
    throw Error('Invalid workflow identity');
  if (!['staging', 'production'].includes(args[0]))
    throw Error('Specify staging or production');
  const production = args[0] === 'production';
  await peerGate({
    api,
    repository,
    sha,
    branch: production ? 'main' : 'develop',
  });
  if (production)
    await productionGate({
      api,
      repository,
      manifest: read('release/current.json'),
      receipt: read(args[1]),
    });
}

if (
  process.argv[1]?.endsWith('/github-gate.mjs') ||
  process.argv[1]?.endsWith('\\github-gate.mjs')
) {
  main()
    .then(() => console.log('Reviewed release gate passed.'))
    .catch(() => {
      console.error(
        'Release gate failed: verify final-head review, staged artifact and production protections.',
      );
      process.exitCode = 1;
    });
}
