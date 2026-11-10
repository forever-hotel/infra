# Forever Hotel infrastructure

[![Infra CI](https://github.com/forever-hotel/infra/actions/workflows/ci.yml/badge.svg)](https://github.com/forever-hotel/infra/actions/workflows/ci.yml)
[![Coverage gate](https://img.shields.io/badge/new_code_gate-80%25_lines_90%25_branches-blue)](https://github.com/forever-hotel/infra/actions/workflows/ci.yml) 

Shared infrastructure for [Forever Hotel](https://github.com/forever-hotel), aligned with SENG 34213. Service repositories own code, Dockerfiles and image publication; this repository owns release manifests, host adoption, deployment and recovery. Shared acceptance checks live in [tests](https://github.com/forever-hotel/tests).

## Fresh checkout: checks

Install Node.js 24, Git and Docker Compose. From this repository:

```text
npm ci --ignore-scripts
npm run format:check
npm run lint
npm run build
npm run validate
npm run test:coverage
npm audit --audit-level=high
```

Tests use disposable filesystem fixtures and fake Docker/GitHub APIs: they do not deploy or mutate shared Neon. Coverage applies to the release controller, deployment adapter, review/promotion gate, host-adoption helper and config validator. The badge describes enforced thresholds, not a published measurement; measured coverage is retained in CI artifacts.

CI also validates all Compose overlays using placeholder environment files. For the same local validation, copy `.env.example` to `.env` and each `env/*.env.example` to its matching `env/*.env`, then:

```bash
docker compose --env-file .env -f compose.yml -f compose.sample-transition.yml -f compose.kms.yml --profile '*' config --quiet
```

Never start services with placeholders. The currently deployed Caddy/HW sample project must be adopted as described below; a fresh clone is not a replacement for a provisioned host.

## Release flow

1. Service repositories publish reviewed images to GHCR. Update their exact digests in `release/current.json` through an infra PR into `develop`.
2. CI checks formatting, lint, build/configuration, coverage, dependency security and Compose interpolation on every push.
3. After final-code peer approval and merge, the staging job deploys the manifest automatically **once `INFRA_STAGING_ENABLED=true` and the host has been approved**.
4. Deployment fingerprints the adopted host configuration, locks against concurrent infra/HW releases, captures current image IDs, verifies existing health, pulls candidates and recreates managed application containers only. Failed health triggers image recovery. It does not rewrite env files, routes, Compose, Caddy, certificates, RabbitMQ volumes or database schema.
5. For production, promote the exact successful staging manifest using its run receipt, a real SemVer tag on the reviewed main merge and a protected `production` environment with required reviewers.

See [activation and settings](docs/AUTOMATIC-DEPLOYMENT.md), [unit mapping](docs/UNIT-GUIDELINE-ALIGNMENT.md), [operations](docs/DEPLOYMENT.md), [contribution rules](CONTRIBUTING.md) and [changelog](CHANGELOG.md).

**Not activated:** deployment flags are not configured by committing these files. `release/current.json` intentionally contains a `PENDING` schema-review reference and `config/host.example.json` is unapproved. Deployment fails closed until the owner records actual migration evidence and approves a host draft. No production host is assumed to exist. GitHub branch protection, environment reviewers, credentials and action allowlists require maintainer setup.

## Existing staging applications

- [Hotel website](https://forever-hotel-staging.malaysiawest.cloudapp.azure.com)
- [Manager Dashboard](https://forever-hotel-manager.duckdns.org)
- [Front Desk](https://forever-hotel-frontdesk.duckdns.org)
- [Food Ordering](https://forever-hotel-food.duckdns.org)
- [Worker Management](https://forever-hotel-workers.duckdns.org)
- [Kitchen Management login](https://forever-hotel-kitchen.duckdns.org/login)

Basic HTTP checks are not business acceptance. Password-reset delivery, sandbox payments, guest QR/orders/tasks and live events still require targeted verification. KMS root displays scaffold content. See [reported status](docs/STATUS-2026-11-10.md).

Do not blindly upload bootstrap configurations or historical snapshots over the running host. The release executor preserves host-owned configuration deliberately; reviewed topology/schema changes need coordinated adoption and are not silently applied by image releases.
