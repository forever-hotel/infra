# Automatic deployment: activation and operations

## What this implementation deploys

A reviewed `release/current.json` contains the exact 14 application image references for gateway, shared WebSocket and six frontend/backend pairs. Broker and Caddy image upgrades are separate reviewed infrastructure operations. Mutable tags, unknown services and truncated digests are rejected.

This release controller **adopts an already running host**. It preserves the two projects: HW backend/frontend in `hotel-website-sample`, other managed apps in `forever-hotel-full`. It never creates a new copy of HW in the full project, deletes containers/volumes, overwrites runtime secrets or automatically applies migrations. Host Compose files and gateway routes remain in place. Config changes require separate review, application and re-adoption.

All six public HTTPS frontends and fixed internal readiness endpoints are checked before and after deployment. Public checks use curl with local DNS resolution to 127.0.0.1, preserving hostname certificate verification without Azure public-IP hairpin dependence. Frontend redirects are permitted; business correctness is not inferred.

## 1. Establish repository governance

The recreated repo currently has no commits. Bootstrap minimal `.gitignore` on main, create/push develop, then submit implementation on `feature/<real-issue>-infra-deployment` into develop. Create an actual issue; do not use invented issue numbers. Set develop as default, protect main/develop, require a peer approval on the final head, dismiss stale approvals and require the `validate` CI job. Update CHANGELOG and tag only actual releases.

Permit these full-SHA actions in the repository/organization policy:

```text
actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1
actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
```

## 2. Review the candidate and schema evidence

Compare manifest digests with the selected source repositories' successful publication summaries and current running image inventory. Individual `releases/*.json` records preserve known source commits; do not infer unknown HW provenance from an image tag. Update all relevant records through review.

Replace the `PENDING` schema reference with an actual owner-reviewed migration/change reference covering the shared schema, especially KMS outbox/indexes/event-producing triggers. No automatic SQL runs during deployment. Readiness 200 alone is not migration review evidence. Existing metadata records are not authorization to invent a schema version.

For staging, `version` and `stagingRunId` can remain null. Production requires an actual `MAJOR.MINOR.PATCH` version and the successful staging workflow run ID. Promotion metadata is excluded from the image/schema fingerprint so the tested release can be promoted unchanged.

## 3. Adopt the host explicitly

On the existing VM, ensure Node.js 22+ (CI uses 24), Docker Compose, curl, sufficient disk/RAM, working noninteractive `sudo -n docker` and root Docker registry access for every private image. Configure registry credentials privately with the required package access. SSH access does not automatically grant registry access.

Copy only the reviewed `scripts/adopt-host.mjs`, `scripts/release-core.mjs` and `config/host.example.json` into a private bootstrap directory. Do not upload `.env` files. Review every path in the template. For staging the defaults describe the current Azure topology; production requires its own provisioned directories/projects, credentials, origins and configuration.

From that bootstrap directory, explicitly generate a private draft:

```bash
node scripts/adopt-host.mjs config/host.example.json /opt/forever-hotel/.infra-release/host.draft.json
```

The helper hashes only public Compose/routes/Caddy configuration, never secrets; it refuses to overwrite files and leaves `adoptionApproved=false`. Review the draft and actual live files with the deployment owner, set `adoptionApproved=true` only when approved, then install it as:

```text
/opt/forever-hotel/.infra-release/host.json
```

Keep the directory mode 700 and file mode 600. The record must hash Caddy, every Compose file and gateway routes. Do not add environment files to the public hash list. The sample project's `.sample-release` directory must already exist; the controller uses its release lock to coordinate with the old HW workflow.

The helper does not validate private secret correctness. Explicitly compare effective runtime configuration and saved files first: every image recreation reloads those files, including previously saved integration changes. Confirm all service keys, schema dependencies and intended feature flags before approval.

## 4. Configure GitHub staging

Create a `staging` environment restricted to develop. For automatic staging do not add an interactive reviewer gate; final-code PR review is already enforced by the deployment job.

Repository variables:

| Name                  | Staging value                                                               |
| --------------------- | --------------------------------------------------------------------------- |
| INFRA_STAGING_ENABLED | `true` only after adoption and CI review                                    |
| STAGING_HOST          | `forever-hotel-staging.malaysiawest.cloudapp.azure.com`                     |
| STAGING_USER          | Dedicated approved deployment account, or existing authorized administrator |
| STAGING_DIRECTORY     | `/opt/forever-hotel`                                                        |

Environment secrets: `STAGING_SSH_KEY` and `STAGING_KNOWN_HOSTS`. Use a dedicated SSH key and independently verify the host fingerprint through the VM console. Do not disable strict host checking or blindly trust an unverified keyscan.

The workflow uploads only deployment modules and the manifest to a unique private incoming directory. It never uploads or changes Compose, routes, Caddy, env files or SQL. On success it downloads a non-secret release receipt and retains `staging-release-<run-id>` for 30 days.

Once configured, a reviewed infra develop merge deploys automatically after CI. A service repository push alone still publishes images; promoting those images requires a reviewed infra manifest update. Do not claim cross-repository publication automatically edits the release manifest.

## 5. Production promotion

Provision a distinct approved production deployment; do not point production at the staging projects/database by changing only a label. Prepare its private host adoption record with environment `production`.

Create a `production` GitHub environment restricted to main with at least one required reviewer and no inappropriate bypass. Configure `PRODUCTION_HOST`, `PRODUCTION_USER`, `PRODUCTION_DIRECTORY` and environment secrets `PRODUCTION_SSH_KEY`, `PRODUCTION_KNOWN_HOSTS`. Enable repository variable `INFRA_PRODUCTION_ENABLED=true` only after review.

In the release PR into main, retain the staged images and schema evidence, set the real version and successful staging run ID. After merging, create tag `v<version>` pointing to that exact main merge before approving the waiting production environment job. The job checks the tag, final-head peer approval, successful develop run, matching staged receipt and configured environment reviewers. If the staging artifact expired, stage again; do not bypass receipt verification.

The production workflow does not rebuild images. Its receipt contains the same immutable image/schema fingerprint as staging. Rollout still requires successful production preflight and health.

## Failure, locking and image recovery

A global full-system lock and the sample HW release lock prevent concurrent local operations across repositories. GitHub deployment concurrency also never cancels a running release. Stale locks are not removed automatically: investigate the owner process before a manual cleanup.

Registry/preflight failures do not replace containers. After a partial rollout or failed post-release health, the controller recreates managed services with the captured local image IDs and checks health again. Private `last-attempt.json` distinguishes released, failed_rolled_back and failed_rollback_unverified. Never describe a failed release as successful because recovery worked.

The full project's active override is `.infra-release/active-images.json`; HW's existing `.sample-release/active.json` is updated while preserving unrelated override content. Subsequent manual operations must include the appropriate active override so old `.env` tags cannot revert images. Keep previous images available; never prune them during a release.

Recovery does not revert env/schema/data or Caddy because those are outside image rollout. Agree database backups, compatible schema changes and restoration ownership separately. Automated recovery is covered by isolated tests; a live rollback rehearsal remains deferred.

## Re-adoption and diagnostics

If public configuration hashes drift, deployment stops before replacement. Investigate and review the host change, update the canonical infra records, then generate/review a new adoption draft. Never change a hash merely to suppress an unexplained failure.

Raw Docker/application command output is suppressed because it may contain secrets. Investigate locally with safe status-only diagnostics. Keep API keys, private keys, reset tokens, URLs with passwords and guest data out of issue/CI evidence.
