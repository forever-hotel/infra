import { readFile } from 'node:fs/promises';
import { validateManifest, services } from './contracts.mjs';

export const workflows = {
  'manager-dashboard': ['ci.yml'],
  'front-desk': ['backend-ci.yml', 'frontend-ci.yml', 'docker-ci.yml'],
  'worker-management': ['ci.yml'],
  'hotel-website': ['staging-sample.yml'],
  'food-ordering': ['ci.yml'],
  'api-gateway': ['ci.yml'],
  'websocket-service': ['ci.yml'],
};

export async function verifySource(api, repo, commit, branch) {
  const prs = await api(`repos/forever-hotel/${repo}/commits/${commit}/pulls`);
  const candidates = prs.filter(pr => pr.merged_at && pr.base.ref === branch && pr.merge_commit_sha === commit);
  let accepted = false;
  for (const pr of candidates) {
    const reviews = await api(`repos/forever-hotel/${repo}/pulls/${pr.number}/reviews`);
    const latest = new Map();
    for (const review of reviews)
      if (review.user && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) latest.set(review.user.login, review);
    const decisions = [...latest.values()];
    if (decisions.some(r => r.state === 'APPROVED' && r.commit_id === pr.head.sha && r.user.login !== pr.user.login) &&
        !decisions.some(r => r.state === 'CHANGES_REQUESTED')) accepted = true;
  }
  if (!accepted) throw new Error(`${repo}: final code needs peer approval on its merged ${branch} PR`);
  for (const workflow of workflows[repo] || []) {
    const { workflow_runs: runs } = await api(`repos/forever-hotel/${repo}/actions/workflows/${workflow}/runs?head_sha=${commit}&event=push&branch=${branch}`);
    const latest = [...runs].sort((a, b) => b.id - a.id)[0];
    if (latest?.conclusion !== 'success') throw new Error(`${repo}: no successful ${workflow} for the selected release commit`);
  }
}

export async function verifyRelease(api, manifest, infraCommit) {
  await verifySource(api, 'infra', infraCommit, 'development');
  const checked = new Set();
  for (const [service, entry] of Object.entries(validateManifest(manifest).services)) {
    const [repo, , branch] = services[service];
    const identity = repo + '/' + entry.commit;
    if (checked.has(identity)) continue;
    await verifySource(api, repo, entry.commit, branch);
    checked.add(identity);
  }
}

// Pagination includes review history and associated PRs; never assume the first page is complete.
async function api(route) {
  let next = 'https://api.github.com/' + route;
  let accumulated;
  while (next) {
    const response = await fetch(next, {
      headers: { Authorization: `Bearer ${process.env.GH_READ_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`GitHub verification HTTP ${response.status}; check repository visibility and read permissions`);
    const body = await response.json();
    if (Array.isArray(body)) accumulated = [...(accumulated || []), ...body];
    else if (Array.isArray(body.workflow_runs)) accumulated = { workflow_runs: [...(accumulated?.workflow_runs || []), ...body.workflow_runs] };
    else return body;
    next = response.headers.get('link')?.match(/<([^>]+)>; rel="next"/)?.[1];
  }
  return accumulated;
}

if (process.argv[1]?.endsWith('verify-github.mjs')) {
  try {
    if (!process.env.GH_READ_TOKEN) throw new Error('GitHub read token missing');
    const manifest = JSON.parse(await readFile('releases/staging.json', 'utf8'));
    await verifyRelease(api, manifest, process.env.GITHUB_SHA);
    console.log('Reviewed infra release and source CI verified');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
