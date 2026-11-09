import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fingerprint } from '../scripts/release-core.mjs';
import {
  peerGate,
  productionGate,
  githubApi,
  main,
} from '../scripts/github-gate.mjs';
const sha = 'a'.repeat(40),
  repository = 'forever-hotel/infra';
const pr = {
  number: 7,
  merged_at: 'today',
  base: { ref: 'develop' },
  merge_commit_sha: sha,
  head: { sha: 'b'.repeat(40) },
  user: { login: 'author' },
};
const approval = {
  user: { login: 'peer' },
  state: 'APPROVED',
  commit_id: pr.head.sha,
};
const apiFor =
  (pulls = [pr], reviews = [approval]) =>
  async (path) =>
    path.includes('/reviews') ? reviews : pulls;
test('requires peer approval on final code, with no unresolved requested changes', async () => {
  await peerGate({ api: apiFor(), repository, sha, branch: 'develop' });
  for (const reviews of [
    [],
    [{ ...approval, commit_id: sha }],
    [{ ...approval, user: { login: 'author' } }],
    [approval, { ...approval, state: 'CHANGES_REQUESTED' }],
    [approval, { user: { login: 'peer' }, state: 'DISMISSED' }],
    [{ ...approval, user: null }],
    [{ ...approval, state: 'COMMENTED' }],
  ])
    await assert.rejects(
      peerGate({
        api: apiFor([pr], reviews),
        repository,
        sha,
        branch: 'develop',
      }),
    );
  for (const pulls of [
    [],
    [{ ...pr, merged_at: null }],
    [{ ...pr, base: { ref: 'other' } }],
    [{ ...pr, merge_commit_sha: 'wrong' }],
  ])
    await assert.rejects(
      peerGate({ api: apiFor(pulls), repository, sha, branch: 'develop' }),
    );
});
const manifest = {
  ...JSON.parse(readFileSync('release/current.json', 'utf8')),
  version: '1.0.0',
  stagingRunId: 10,
};
const receipt = {
  status: 'released',
  environment: 'staging',
  fingerprint: fingerprint(manifest),
};
const run = {
  event: 'push',
  head_branch: 'develop',
  conclusion: 'success',
  path: '.github/workflows/ci.yml',
};
const protection = {
  protection_rules: [{ type: 'required_reviewers', reviewers: [{ id: 1 }] }],
};
const productionApi =
  (r = run, e = protection) =>
  async (path) =>
    path.includes('/actions/') ? r : e;
test('production promotes exactly a successful staged release with required reviewers', async () => {
  await productionGate({ api: productionApi(), repository, manifest, receipt });
  for (const m of [
    { ...manifest, version: null },
    { ...manifest, version: 'bad' },
    { ...manifest, stagingRunId: 0 },
    { ...manifest, stagingRunId: '10' },
  ])
    await assert.rejects(
      productionGate({
        api: productionApi(),
        repository,
        manifest: m,
        receipt,
      }),
    );
  for (const change of [
    { event: 'workflow_dispatch' },
    { head_branch: 'main' },
    { conclusion: 'failure' },
    { path: 'other' },
  ])
    await assert.rejects(
      productionGate({
        api: productionApi({ ...run, ...change }),
        repository,
        manifest,
        receipt,
      }),
    );
  for (const r of [
    { ...receipt, status: 'failed' },
    { ...receipt, environment: 'production' },
    { ...receipt, fingerprint: 'wrong' },
  ])
    await assert.rejects(
      productionGate({
        api: productionApi(),
        repository,
        manifest,
        receipt: r,
      }),
    );
  for (const e of [
    {},
    { protection_rules: [] },
    { protection_rules: [{ type: 'required_reviewers', reviewers: [] }] },
  ])
    await assert.rejects(
      productionGate({
        api: productionApi(run, e),
        repository,
        manifest,
        receipt,
      }),
    );
});
test('GitHub API paginates complete review history and suppresses unauthorized evidence', async () => {
  await assert.rejects(githubApi('/repos/x', null, ''));
  await assert.rejects(githubApi('https://evil', null, 'token'));
  await assert.rejects(
    githubApi('/repos/x', async () => ({ ok: false }), 'token'),
  );
  assert.deepEqual(
    await githubApi(
      '/repos/x',
      async () => ({ ok: true, json: async () => ({ id: 1 }) }),
      'token',
    ),
    { id: 1 },
  );
  let n = 0;
  const result = await githubApi(
    '/repos/x?per_page=100',
    async (url, options) => {
      assert(url.startsWith('https://api.github.com/'));
      assert.equal(options.headers.Authorization, 'Bearer token');
      return {
        ok: true,
        json: async () => (++n === 1 ? Array(100).fill(1) : [2]),
      };
    },
    'token',
  );
  assert.equal(result.length, 101);
  await assert.rejects(
    githubApi(
      '/repos/x',
      async () => ({ ok: true, json: async () => Array(100).fill(1) }),
      'token',
    ),
  );
});
test('workflow entry verifies identities and both staging/production gates', async () => {
  const env = { GITHUB_SHA: sha, GITHUB_REPOSITORY: repository };
  await main(['staging'], env, apiFor());
  for (const e of [
    {},
    { ...env, GITHUB_REPOSITORY: 'bad' },
    { ...env, GITHUB_SHA: 'bad' },
  ])
    await assert.rejects(main(['staging'], e, apiFor()));
  await assert.rejects(main(['bad'], env, apiFor()));
  const api = async (path) =>
    path.includes('/commits/')
      ? [{ ...pr, base: { ref: 'main' } }]
      : path.includes('/reviews')
        ? [approval]
        : productionApi()(path);
  await main(['production', 'receipt'], env, api, (p) =>
    p === 'receipt' ? receipt : manifest,
  );
});
