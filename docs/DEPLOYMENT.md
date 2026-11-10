# Shared staging deployment runbook

Read [current status](STATUS-2026-11-10.md) and [unit alignment](UNIT-GUIDELINE-ALIGNMENT.md) before acting. This repository contains bootstrap configuration and reconstructed snapshots, not a verified export of the live VM. Never overwrite working private/configuration files blindly.

## Architecture and ownership

Azure VM hosts private Docker services and the existing Caddy proxy. The unit's infra repository owns shared configuration; service repos own code, Dockerfiles and image publication. Shared tests reside in the tests repo, report evidence in documents.

The sample project at /opt/hotel-website-staging still owns HW and Caddy. The full project at /opt/forever-hotel runs platform/MAD/FDS/FOSS/WKMS, with KMS in an additive overlay. Keep the existing sample networks, Caddy certificate volumes and active release override. Do not start a second Caddy or remove the sample.

## Prepare a reviewed release

1. Select immutable published digests and record source commits. Compare .env.example/release manifests with actual live image versions; manifests are not automatic deployment inputs.
2. Preserve private env/*.env files with restricted access. Fill all templates privately; no example value is a deployable credential. Do not log Docker inspect environment arrays or full connection strings.
3. Match Neon database identity and owner-specific SSL configuration. KMS uses DATABASE_URL + DATABASE_SSL=true; WKMS uses full DATABASE_URL; HW/MAD/FDS/FOSS have their own DB configuration precedence. Never use only a hostname where a full URL is required. No schema synchronization, test seeds or arbitrary migration replay.
4. Validate required schema with read-only probes and record reviewed migration versions. Readiness alone does not prove triggers or permissions. Coordinate shared-dev schema changes with all service owners.
5. Match broker user/vhost/password without printing them; Docker hostname is rabbitmq. Match JWT issuer/secret and relay keys to each consumer. KMS has its own base64 session encryption key and KMS-prefixed relay setting.
6. Check routes against owner controllers, especially /wms -> /wkms with empty alias cookieNames. Cross-prefix shared cookie names prevent gateway startup. Validate JSON before recreating shared gateway.
7. Public URLs use HTTPS. Runtime changes cannot change already embedded NEXT_PUBLIC build values. KMS frontend server URLs are runtime settings. Never bake secrets into images.

## Compose validation and controlled startup

On the prepared host use all applicable files:

```bash
cd /opt/forever-hotel
sudo docker compose --env-file .env \
  -f compose.yml -f compose.sample-transition.yml -f compose.kms.yml \
  --profile platform --profile mad --profile fds \
  --profile foss --profile wkms --profile kms config --quiet
```

Validation resolves configuration only: it does not test passwords, schema, images, DNS or readiness. Review the selected release and use pull/up for explicitly named services only, never indiscriminately recreate the whole shared stack. Gateway/WebSocket recreation briefly affects every subsystem. Stage service readiness first, routing second, public access last. Caddy reload must follow a successful validation of the currently mounted file; preserve its mount inode and certificate volumes.

Do not run the owner repositories' development Compose stacks on this host. They may expose conflicting ports or create disposable databases. Keep only Caddy public on 80/443; broker/admin/backend ports stay private.

## Verification and evidence

Record container restart counts, effective database identity/TLS, service and gateway HTTP checks, broker login and public HTTPS. Then verify authenticated role access, QR/booking/order/task flows, event delivery and email with agreed test accounts/data. Track unverified cases honestly. An unauthenticated 401 only proves rejection; account API 200 only proves provider authentication.

Run the tests repo's read-only smoke checks explicitly. Its offline tests do not contact staging. Capture results with release/config/migration versions and link CI artifacts in the sprint evidence. Unit guidelines require 80% new-code coverage and 90% critical branch coverage; infra validator results do not certify service code.

## Release and recovery boundary

Full-system image-release automation is implemented but not activated; follow AUTOMATIC-DEPLOYMENT.md for reviewed host adoption, staging enablement and production promotion. Do not claim publication is deployment. Preserve last-known images/configuration before updates; never delete volumes to troubleshoot. Image rollback does not restore database data. Restore ownership, retention and migration compatibility require a separately agreed plan. Rollback rehearsal remains deferred at the owner's request.

## Automated image releases

Use [AUTOMATIC-DEPLOYMENT.md](AUTOMATIC-DEPLOYMENT.md) for the supported release controller. Unlike manual preparation, it never overwrites server-owned configuration. Record and review public configuration changes before re-adoption. Keep active image overrides when using manual Compose commands afterward.
