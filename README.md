# Forever Hotel infrastructure

Shared infrastructure and deployment are maintained by the deployment coordinator.
The previous generated CD workflows, release scripts, Compose deployment file,
release manifests and example runtime files have been removed from this checkout.

Application repositories retain CI quality/security checks and publish reviewed,
commit-tagged frontend/backend images (single images for gateway and WebSocket)
to GHCR. Their job summaries/artifacts report immutable image digests for the
coordinator's deployment pipeline. No application CI performs SSH deployment.

Private environment files already prepared locally remain ignored for handover;
they are not committed or removed by this cleanup. No VM services or databases
were changed. Coordinate future deployment configuration with the infrastructure owner.
