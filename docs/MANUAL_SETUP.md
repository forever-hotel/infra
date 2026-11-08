# Manual coordinator setup

These are instructions, not actions already performed. No Azure/Neon operations
have been executed. The coordinator owns shared networking and startup.

## 1. Finish service releases

Ensure latest code reached the agreed branch through a peer-reviewed PR. Source CI
must pass its quality/security checks and publish twelve application images:
frontend/backend for five systems, plus gateway and WebSocket. KMS is pending.
FDS/WMS/FOSS publication is not yet in the inspected workflows. HW's sample CD
must be separated from publication before transitioning to this shared stack;
update the HW required workflow in `scripts/verify-github.mjs` at that time.

Publish with `GITHUB_TOKEN` and `packages: write`. Set OCI labels:

- `org.opencontainers.image.source`: exact `https://github.com/forever-hotel/REPO`.
- `org.opencontainers.image.revision`: full source commit SHA.

Build frontends with actual public HTTPS origins and their correct prefix/socket
contracts. WMS uses `/wms` for the API prefix. A runtime env change cannot replace
localhost URLs baked into a Next.js bundle. Fill the example release manifest
with actual `image@sha256:...` references and source commits. A system's frontend
and backend must come from the same commit.

## 2. Prepare the existing Ubuntu VM

Target `/opt/forever-hotel`, project `forever-hotel-full`. Install supported Node
22 and Docker Compose with `up --wait`. Confirm CPU/RAM capacity for the full
stack; HW's small sample VM does not establish SDS capacity.

Use a dedicated automation account with write access to that directory and
direct Docker access. The adapter invokes `docker`, not sudo. Docker-group access
is privileged, so restrict account/key use.

```sh
umask 077
mkdir -p /opt/forever-hotel/env /opt/forever-hotel/state /opt/forever-hotel/infra-releases
chmod 700 /opt/forever-hotel/env /opt/forever-hotel/state
```

Transfer a reviewed infra checkout for initial setup. Copy `.env.example` to
`/opt/forever-hotel/.env`; select the approved existing edge network and a reviewed
digest-pinned RabbitMQ image. Copy all thirteen `env/*.env.example` templates into
`/opt/forever-hotel/env/`, removing `.example` from filenames. Fill privately and
`chmod 600` every real env file and host `.env`. Never commit/print/upload them.
Use names `gateway.env`, `websocket.env`, `wms-backend.env`, `wms-frontend.env` as
in Compose, regardless of whether a developer's SSH account is named deploy-wkms.

## 3. Configure runtime settings

Internal addresses:

| Service | Address |
| --- | --- |
| gateway | http://gateway:8080 |
| WebSocket | http://websocket:8081 |
| RabbitMQ | rabbitmq:5672 |
| MAD/FDS/WMS/HW/FOSS backends | respective service names, ports 4000/4001/4002/4003/4004 |

RabbitMQ username/vhost are `forever_hotel`. Every AMQP URL needs the URL-encoded
private password and `/forever_hotel` vhost. Match producer/consumer settings.

Set shared Neon credentials with verified TLS and intended service grants.
Do not truncate, load fixtures, replay the baseline or enable synchronization.
Any required schema change is separate, reviewed, manual and backward compatible.
Set production public origins/cookie behavior, Brevo sender, PayHere notify URL
and explicit HW pricing/management policy. Keep PII flags off while HW lacks the
shared adapter. Empty optional keys or disable features correctly; do not leave
`REPLACE_WITH_...` values. The adapter rejects placeholders and localhost settings.

Preserve gateway route prefixes in `ROUTES_JSON`, including WebSocket upgrade.
Configure `WEBSOCKET_SUBSYSTEMS_JSON` with exact public origins, matching private
relay keys, gateway staff session validators and FOSS guest validator. Template
fake hostnames are not real settings. Guest HW/FOSS authentication stays separate.

## 4. Edge and broker startup: coordinator only

Compose publishes no application/broker ports. Existing Caddy must join the
approved external network and route frontend hostnames to these aliases:

| Docker edge alias | Port |
| --- | --- |
| forever-mad-frontend | 3000 |
| forever-fds-frontend | 3001 |
| forever-wms-frontend | 3002 |
| forever-hw-frontend | 3003 |
| forever-foss-frontend | 3004 |
| forever-gateway | 8080 |

Route public APIs and `/realtime/socket.io` to the gateway. Preserve API prefixes;
gateway performs the owner rewrite. Confirm a public socket readiness route for
the smoke target. The socket container remains private.

The coordinator creates/confirms the edge network and starts the approved broker
once, before bootstrap, from reviewed tooling:

```sh
docker compose --project-name forever-hotel-full \
  --project-directory /opt/forever-hotel -f /PATH/TO/REVIEWED/infra/compose.yml \
  up -d rabbitmq
```

Review actual volume ownership first; never create a second broker when the full
stack broker already exists. Application CD never starts/stops RabbitMQ. Plan the
sample gateway/Caddy transition deliberately. Nothing here stops the old sample,
deletes networks/volumes or transfers certificate ownership automatically.

## 5. Registry and SSH access

Allow the deployment account to pull GHCR images: approved public packages or a
private server-side Docker login with read-packages scope. The publishing CI token
is not the host's persistent pull credential. Keep registry secrets on the host.

Use a dedicated automation SSH key. Public key goes in the server account's
authorized_keys; private key goes in GitHub environment secrets. Do not share a
personal admin key. Verify host fingerprints independently; configure pinned
known_hosts. Approve runner SSH connectivity through Azure. No insecure host-key
bypass, public backend ports or automatic firewall modifications are used.

## 6. GitHub settings

Create infra environment `staging`, restricted to `development`:

| Type | Name | Value |
| --- | --- | --- |
| Environment variable | STAGING_HOST | SSH hostname without scheme |
| Environment variable | STAGING_USER | Dedicated account with direct Docker access |
| Environment variable | STAGING_PORT | Default 22 |
| Environment secret | STAGING_SSH_KEY | Dedicated private automation key |
| Environment secret | STAGING_SSH_KNOWN_HOSTS | Verified host key; port-qualified entry if needed |
| Optional repository secret | DEPLOY_READ_TOKEN | Prefer short-lived GitHub App installation token for cross-private-repository Actions/PR reads |

GITHUB_TOKEN is the default for source inspection; other private repositories
usually require approved GitHub App access/token delivery. No personal registry
publishing token is requested by infra. Protect development: peer review, required
Infrastructure checks, current approvals, no force pushes. For automatic staging,
do not add a manual environment review gate unless you want deployment paused.
Production approval/blue-green is a separate future workflow.

## 7. Smoke targets

Copy `host.example.json` to `/opt/forever-hotel/host.json`. Set actual website/API
hostnames, five frontend entry/login URLs, gateway/socket readiness routes and
expected response text. Every target must return direct HTTPS success without
redirects, query tokens or credentials. Pick actual login pages rather than
protected pages redirecting to login. TLS verification stays on. If Azure public
hairpin/DNS fails, resolve it with reviewed routing/name resolution, not insecure TLS.

Smoke is basic availability only. Manually verify staff login, booking/check-in/out,
FOSS QR, requests/task completion, complaints, promotions, room sockets and guest
isolation. KMS-dependent food workflows remain unavailable.

## 8. First adoption and ongoing updates

1. Merge this scaffold through review; no real manifest means no deployment.
2. Add real `releases/staging.json` through a reviewed PR. Its first automatic run
   refuses installation until explicitly authorized as bootstrap.
3. With the host ready, dispatch **Deploy shared staging** on the current
   development head with `bootstrap=true`. This is only for first installation.
4. Bootstrap rejects existing application containers in `forever-hotel-full`. To
   adopt an already-running full project, inventory/review all twelve real digests,
   source labels, healthy containers and smoke results, then establish a matching
   `state/current.json`. Do not invent state or overwrite unknown running services.
5. Verify successful Actions run, server `state/last-result.json`, accepted
   `state/current.json`, healthy containers and manual journeys.
6. Future reviewed manifest changes deploy automatically, updating changed services.

No real release, SSH, registry pull, email, payment, SQL or rollback rehearsal has
been performed while implementing this pipeline.

## Recovery

Accepted and prior manifests are `state/current.json` and `state/previous.json`.
Retain prior local images; no image pruning before acceptance. If rollback is
unverified, inspect services/logs privately and involve the coordinator. A killed
process can leave `state/release.lock`; confirm no active deployment before manual
removal. Never remove an active lock.

For deliberate rollback, review a release manifest selecting the previous accepted
digests and deploy through the same workflow. Routine restarts must combine the
accepted tooling's Compose file with an override generated from current.json;
never start with bare `:unconfigured` base images. Image rollback does not reverse
schema/config/secret changes. Do not run down, delete volumes or rerun SQL as a
rollback. Measure a real staging recovery before claiming the SDS timing target.
