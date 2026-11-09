# Changelog

## [Unreleased]

- Record shared staging topology, image provenance and remaining integration evidence.
- Add pinned-action infra CI, read-only validation and coverage-gated configuration regression checks.
- Document unit-guideline requirements, release gates and outstanding automatic staging/production deployment work.
- Track KMS readiness recovery without claiming migration-trigger or business-flow verification.

### Added

- Automatic reviewed-manifest staging release after successful develop CI, with opt-in activation until host adoption is approved.
- Production promotion requiring a reviewed main merge, SemVer tag, successful staging receipt and protected environment reviewers.
- Dual-project deployment preserving the existing HW sample/Caddy setup, immutable image checks, private host fingerprints, coordinated locks and tested image recovery.
- Actual ESLint/Prettier checks, release/controller regression coverage, secret-safe SSH transport and documented activation/recovery procedure.

### Verification boundaries

- No live deployment, GitHub protection/secret change or production provisioning was performed while implementing these changes.
- Reviewed shared-schema provenance and explicit host enrollment remain required before activation.
