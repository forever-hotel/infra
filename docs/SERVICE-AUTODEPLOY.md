# Automatic staging for reviewed service releases

## Release path

Each service runs its normal quality gates and final-code peer approval check. The publication job uploads immutable image references with the triggering source commit. A staging job calls the SHA-pinned infra action at .github/actions/deploy-service. It downloads the current run artifact and independently checks repository, branch, current head and final-head peer approval. No second infra PR is required for routine application releases.

Manager Dashboard and WebSocket use development. Gateway, Food Ordering, Worker Management and Kitchen Management use develop. Front Desk retains its existing automatic staging job; Hotel Website retains Automatic sample staging. Production is unchanged.

## Settings

Each of the six new callers needs SERVICE_STAGING_ENABLED=true, STAGING_HOST=forever-hotel-staging.malaysiawest.cloudapp.azure.com and STAGING_USER=azureuser. Its staging environment permits only its release branch and holds encrypted STAGING_SSH_KEY and STAGING_KNOWN_HOSTS. There is no additional environment reviewer gate. User-authorized VM access is separate from public image metadata.

The shared action is pinned to an exact reviewed infra commit. Merge the infra action PR before approving the service PRs. A future action change requires testing and updating caller pins through reviewed service PRs. Public infra action code contains no credentials. Each service supplies its own job-scoped secrets.

## Host behaviour

Only allowlisted containers for the selected service are replaced. Manager Dashboard, FOSS, WKMS and KMS each deploy their pair; Gateway and WebSocket each deploy their one container. No env file, SQL, route, Caddy or broker upgrade is applied. All services share the approved host hashes and full/sample release locks. Jobs wait up to ten minutes for a busy lock and recheck the latest source commit after acquiring it. A stale or incompatible host stops deployment before replacement.

The controller snapshots previous image IDs, checks baseline health, pulls immutable images, rechecks host configuration, recreates only selected services and checks readiness/public HTTPS. Gateway and WebSocket releases check all managed apps and six public sites. Application releases check their own endpoints, Gateway, WebSocket and public origin. Failed rollout attempts restore prior service images and remain failed. The private <service>-last-attempt.json records released, failed_rolled_back or failed_rollback_unverified with source commit and image references. The workflow retains a matching receipt where available; logs show safe phase names without provider output or credentials.

## Full-system promotion

Automatic service deployments update the VM active override, not Git commits in infra. A full infra deployment must align its manifest with current successful service receipts. The new full-release preflight rejects conflicts instead of silently selecting older service images. Synchronize the full manifest before a full-system release; changes to application code alone need no such manual step.

Database/schema changes still require owner coordination and compatibility review. Configure routes/env separately and re-adopt reviewed public configuration changes. A readiness 200 does not establish email delivery, payment settlement or complete authenticated feature correctness.

## Verification

Watch the service repository's Actions run and Deploy service to staging job. PR runs validate but do not deploy. Approve the final service PR code and merge to the release branch, then confirm the publication, deployment and matching receipt. Test the changed business flow in the browser. First live rollout of these new callers remains pending their reviewed merges.

Full-system staging rollout runs only when the reviewed infra merge changes release/current.json. Updating this shared action or its documentation alone validates the change without replacing containers.
