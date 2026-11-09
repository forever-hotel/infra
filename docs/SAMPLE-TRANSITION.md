> Historical preparation notes. Current state: [10 November status](STATUS-2026-11-10.md). Do not follow old rollout steps without comparing the live server.

# One shared gateway: transition from the existing sample

Prepared from user-supplied Docker network inspection. Not applied remotely.

The sample edge network is hotel-website-sample_edge (172.30.80.0/24); the existing Caddy is 172.30.80.254. Existing hotel backend is on forever-hotel-internal with alias hotel-website-backend. Verify the backend alias before deployment. compose.sample-transition.yml attaches the new gateway to both networks in addition to the full-system services network. The unique shared-gateway alias prevents confusing it with the old sample gateway. MAD frontend also joins the edge network for existing Caddy access. Only Caddy publishes HTTP/HTTPS; certificates stay in the sample volumes.

## Sequence

1. Copy this overlay and config/Caddyfile.sample-transition to /opt/forever-hotel. Do not replace private env files.
2. Gateway route flags must enable hw, mad-auth, mad and shared-websocket only. HW upstream is overridden to the existing backend; staff authentication uses the privately configured dev database. This transition does NOT migrate the HW sample database to dev. That later requires reviewed schema/data and guest-PII alignment.
3. Validate merged Compose and all private settings. Use --profile platform --profile mad with compose.yml and compose.sample-transition.yml. Do NOT enable hw: those containers are reused from the sample for now. Other services remain off. The new project's template image references for disabled services remain unused placeholders; never pull all profiles.
4. Pull the four released app images and broker image. Start RabbitMQ first and confirm health, then MAD backend, WebSocket, gateway and frontend. Gateway readiness checks upstreams, so it may be temporarily unready until dependencies start. The MAD and WebSocket images do not define Docker health checks: verify their readiness endpoints explicitly.
5. Validate that the new gateway can serve HW and MAD and authenticate sockets through the private network BEFORE traffic cutover. The old gateway may run briefly during verification, but is retired after switching traffic. No permanent per-service gateway is intended.
6. Back up the live sample Caddyfile. Validate Caddyfile.sample-transition inside the existing Caddy container, copy contents into its currently mounted source file (preserve bind-mount inode), then reload Caddy. The full-system config/Caddyfile is not the transition file and must NOT replace the live config here. It references frontends that are not yet running.
7. Update the existing sample frontend's private API_GATEWAY_URL to http://shared-gateway:8080 and recreate ONLY that frontend with --no-deps, keeping the active release override .sample-release/active.json so its image cannot revert to the old :sample tag. Persist the address in the actual frontend.env and preserve its other settings. Avoid docker compose up on the whole sample project; it would restart its old gateway.
8. Verify HTTPS HW pages, /hw/health, MAD login/password recovery and WebSocket notifications. Only after verification stop the old sample gateway; leave website containers/Caddy and certificate volumes intact. Amend sample automation to preserve the new shared-gateway dependency before using it for another release. Retiring sample automation and moving HW to infra remain separate work.

No rollback rehearsal requested. Keep backups and old images; do not delete volumes or mutate the dev schema while troubleshooting network failures.
