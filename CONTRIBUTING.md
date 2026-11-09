# Contribution and release rules

Source: SENG 34213 System Development Project, sections 3.1-3.4, 6.4, 7.1-7.2, 8.2, 9.3 and Appendix A.

- Use protected main for release-ready code and develop as the integration/default branch. Create short-lived feature/<issue>-<slug> or fix/<issue>-<slug> branches; use release/<version> when preparing a release.
- This recreated repo currently has no initial commit. Branch creation/default/protection settings still need a maintainer bootstrap; this document does not configure GitHub settings automatically.
- Link the actual issue in commits/PRs. Use conventional prefixes such as feat, fix, ci, test or docs. Do not invent ticket numbers or release tags.
- PR into develop, obtain at least one peer approval on final code, resolve blockers, pass CI and update CHANGELOG under Unreleased. Require the Infra CI validate check and restrict direct pushes in repository protection settings.
- Run README checks after the final merge/conflict resolution. Review sensitive changes with the owners of affected services and shared schema.
- Never commit real credentials, backups containing secrets or private .env files. Keep CI secrets in GitHub Secrets and server runtime secrets in private files. Read-only diagnostics must redact values.
- Unit coverage requirement: >=80% lines/branches for new code; critical business logic target is 90% branches. Configuration validator coverage is not service or business coverage. Shared integration and endpoint test registers belong in tests/documents.
- Record image digests, source commits, config revision, applied migration identity, CI evidence and smoke outcomes for each coordinated release. Tag actual releases vMAJOR.MINOR.PATCH; no production release is created merely by committing a manifest.
- Staging automation and manually approved tagged production delivery are implemented behind explicit activation/adoption gates. Do not enable them before host/config/schema review and do not bypass failing gates.
