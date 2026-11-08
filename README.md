# Forever Hotel shared staging deployment

Docker Compose CD for MAD, FDS, WMS, HW, FOSS, gateway and the shared WebSocket
service. KMS is absent. This repository does not modify Neon or the existing
`hotel-website-sample` deployment, install Caddy or automatically initialize RabbitMQ.

## Release flow

1. Source repositories test and publish reviewed, commit-tagged GHCR images.
2. Copy `releases/staging.example.json` to `releases/staging.json`, replacing all
   entries with real immutable digests and source commits. Submit a reviewed PR
   into infra's **development** branch.
3. CD checks infra review, each source PR's final-head peer approval and successful
   source CI at the exact commit. It deploys only from the current branch head.
4. SSH transfers reviewed tooling and manifest; private env stays on the host.
5. The host-wide lock prevents overlapping deploys. The adapter checks actual
   baseline images/health, pulls changed images, verifies OCI source/revision
   labels, updates only changed services and checks health plus public HTTPS.
6. On acceptance it records the release. Startup or smoke failures restore prior
   images, recheck smoke and leave the workflow failed. Unverified rollback needs
   operator intervention. Registry/provenance failure occurs before container changes.

Follow the manual setup below before enabling CD.

## Source contracts

| Repository | Reviewed merge branch | Successful source workflows |
| --- | --- | --- |
| manager-dashboard | development | ci.yml |
| front-desk | develop | publish-images.yml (calls all three existing CI workflows) |
| worker-management | develop | ci.yml |
| hotel-website | develop | publish-images.yml |
| food-ordering | develop | ci.yml |
| api-gateway | develop | ci.yml |
| websocket-service | development | ci.yml |

Contracts are explicit in `scripts/contracts.mjs` and `scripts/verify-github.mjs`.
Update through review when branch/workflow names change. `pre-develop` does not
publish under these contracts. Direct pushes without reviewed final code fail.

**Publication:** FDS/HW now have publication-only orchestration workflows;
WMS/FOSS publish after existing CI jobs. HW's old sample deployment workflows
are removed locally so infra becomes the sole CD owner once changes are merged.
Merge reviewed source PRs, set repository variables and confirm successful
publication before adding actual image digests to the infra release manifest.

## Files

- `compose.yml`: private containers, existing external edge network, durable broker volume.
- `releases/staging.example.json`: placeholders, never deployed.
- `env/*.env.example`: placeholder-only private configuration templates.
- `host.example.json`: seven public HTTPS smoke targets.
- `scripts/release.mjs`: locked host release and rollback adapter.
- `scripts/verify-github.mjs`: source review and CI gates.
- `.github/workflows/ci.yml`: tooling tests and secret-free Compose validation.
- `.github/workflows/deploy-staging.yml`: reviewed manifest to SSH deployment.

No real release manifest is supplied, so merging this scaffold deploys nothing.
Manual dispatch also fails until the real manifest and server settings exist.

## Validation and limits

Node 22+, no npm dependencies/install required: run `npm test`. Once a real
manifest exists, `npm run validate` checks it without contacting Docker or Neon.

This is staging in-place release, not SDS production blue-green/zero downtime.
Two-minute rollback is not established. Local tests use fake Docker adapters;
live SSH, registry pulls, WebSocket/user journeys and recovery need verification.
OCI labels check consistency, not cryptographic provenance. Image rollback never
reverses schema, private configuration or secrets. Original product guides and
manual SQL remain in workspace-root `documents/`.

## Manual setup

## 1. Finish service releases

Ensure latest code reached the agreed branch through a peer-reviewed PR. Source CI
must pass its quality/security checks and publish twelve application images:
frontend/backend for five systems, plus gateway and WebSocket. KMS is pending.
FDS/WMS/FOSS/HW publication workflows are prepared locally. Merge them
through reviewed PRs into their release branches and confirm successful runs.

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

## Source repository variables

Set these under each repository's Settings → Secrets and variables → Actions → Variables:

| Repository | Variables |
| --- | --- |
| front-desk | PUBLIC_API_ORIGIN, optional PUBLIC_SOCKET_ORIGIN |
| worker-management | PUBLIC_API_ORIGIN, optional PUBLIC_SOCKET_ORIGIN |
| food-ordering | PUBLIC_API_ORIGIN, optional PUBLIC_SOCKET_ORIGIN |
| hotel-website | Optional STAGING_ROOM_IMAGE_HOSTS for external image optimizer hosts |

PUBLIC_API_ORIGIN is the public gateway HTTPS origin, with no path/trailing slash.
The publisher appends `/fds`, `/wms` or `/foss`. PUBLIC_SOCKET_ORIGIN defaults to
PUBLIC_API_ORIGIN; browser sockets still use `/realtime/socket.io`. Do not put
private container names, secret keys or direct backend URLs here.
HW receives server-only API_GATEWAY_URL at runtime, not in its browser bundle.
Images and immutable references appear in Actions job summaries and the
`release-images` artifact. Allow organization package publication and configure
server pull access separately. No personal publishing token is needed.

## Ubuntu installation commands

Run these in the existing VM's SSH terminal, not Windows PowerShell. First check
what is already installed; skip installation sections when the tools are present:

```sh
node --version
docker --version
docker compose version
```

If Docker Engine is missing on supported Ubuntu, use the official apt repository.
Do not replace a working Docker installation or remove packages from a running
host without inspecting it first. Installation instructions:
[Docker Ubuntu guide](https://docs.docker.com/engine/install/ubuntu/).

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl git xz-utils
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
docker compose version
```

If Engine is already installed from Docker's apt repository and only the Compose
plugin is absent, install just `sudo apt-get install -y docker-compose-plugin`.

If Node 22 is missing, the following downloads the pinned official Linux x64
release and verifies its SHA-256 before installation. This is for the existing
x86-64 Ubuntu VM; do not use on ARM. Skip if a suitable Node 22 is already present.
[Official Node release files](https://nodejs.org/download/release/v22.23.4/).

```sh
(
set -eu
test "$(uname -m)" = x86_64
node_download_dir=$(mktemp -d)
cd "$node_download_dir"
curl -fsSLO https://nodejs.org/download/release/v22.23.4/node-v22.23.4-linux-x64.tar.xz
curl -fsSLO https://nodejs.org/download/release/v22.23.4/SHASUMS256.txt
grep ' node-v22.23.4-linux-x64.tar.xz$' SHASUMS256.txt | sha256sum -c -
sudo tar -xJf node-v22.23.4-linux-x64.tar.xz -C /opt
sudo ln -sfn /opt/node-v22.23.4-linux-x64/bin/node /usr/local/bin/node
sudo ln -sfn /opt/node-v22.23.4-linux-x64/bin/npm /usr/local/bin/npm
sudo ln -sfn /opt/node-v22.23.4-linux-x64/bin/npx /usr/local/bin/npx
node --version
npm --version
)
```

Stop if any download/checksum/install command fails. Do not continue with a failed
checksum. The commands are supplied for manual use; they have not been executed.

Use the coordinator-approved deployment user. If creating a new dedicated account:

```sh
sudo adduser --disabled-password --gecos "" deploy-forever
sudo usermod -aG docker deploy-forever
sudo install -d -o deploy-forever -g deploy-forever -m 750 /opt/forever-hotel
sudo install -d -o deploy-forever -g deploy-forever -m 700 \
  /opt/forever-hotel/env /opt/forever-hotel/state /opt/forever-hotel/infra-releases
```

The coordinator installs the automation public key in this account's
`~/.ssh/authorized_keys` with proper directory/file ownership and 700/600 modes.
Start a new SSH session for Docker-group membership to apply. Do not create a
duplicate account if one is already provisioned; use its actual name in GitHub.

From the reviewed infra checkout, logged in as the deployment account, copy only
missing templates (these examples still need real values entered privately):

```sh
umask 077
for source in env/*.env.example; do
  destination="/opt/forever-hotel/env/$(basename "$source" .example)"
  if ! test -e "$destination"; then install -m 600 "$source" "$destination"; fi
done
if ! test -e /opt/forever-hotel/.env; then
  install -m 600 .env.example /opt/forever-hotel/.env
fi
if ! test -e /opt/forever-hotel/host.json; then
  install -m 600 host.example.json /opt/forever-hotel/host.json
fi
nano /opt/forever-hotel/env/mad-backend.env
```

Edit every relevant file, not just MAD. Root host `.env` contains EDGE_NETWORK and
RABBITMQ_IMAGE. Application secrets belong in service files; host.json contains
the actual public smoke URLs. Creating templates does not configure or start any
service. Network creation, existing edge routing, registry login and initial
broker startup remain coordinator steps above; do not duplicate existing resources.
