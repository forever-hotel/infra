> Historical preparation notes. Current state: [10 November status](STATUS-2026-11-10.md). Do not follow old rollout steps without comparing the live server.

# Public routing and frontend images

DNS was confirmed by the user on 2026-11-08: all four Duck DNS A records point to 172.197.160.147. The existing Azure hostname remains the HW address. No Duck DNS token is required in application builds or Caddy.

| App  | Public origin                                                 |
| ---- | ------------------------------------------------------------- |
| hw   | https://forever-hotel-staging.malaysiawest.cloudapp.azure.com |
| mad  | https://forever-hotel-manager.duckdns.org                     |
| fds  | https://forever-hotel-frontdesk.duckdns.org                   |
| foss | https://forever-hotel-food.duckdns.org                        |
| wkms | https://forever-hotel-workers.duckdns.org                     |

## What is implemented

config/Caddyfile contains future site blocks, preserves request paths to gateway, strips client identity headers and forwards Next.js/BFF routes to their own frontend. Caddy's reverse_proxy supports upgraded WebSocket connections. Public /auth and the per-site subsystem API prefix go to gateway, as does /realtime. /api/* stays on Next.js; do not route it wholesale to gateway. Public origins are exact HTTPS allowlists in the gateway template and subsystem templates. No endpoint here bypasses service authentication.

config/frontend-builds.json is a non-secret build manifest, NOT an automatically executed workflow. Use args in owner image-publication CI. NEXT_PUBLIC values must be present during image build. Server-only addresses in frontend env templates remain runtime values. No application Dockerfiles or CI workflows were changed by this step.

## Gates before cutover

1. Finish database updates and release immutable reviewed images. KMS stays disabled. Enable gateway route flags only as upstream readiness is verified.
2. Wire the FOSS mode variables into its Dockerfile/build environment; current Dockerfile accepts only the two URL args. Do not assume runtime env updates change browser bundles.
3. Resolve WKMS native live updates with the owner. Its current browser uses native /socket.io and namespace /wkms with token authentication. This differs from shared WebSocket tickets at /realtime/socket.io. Its socket build URL is deliberately blank here; do not claim live updates work. FDS/shared socket ticket flow still needs deployed verification. The shared registry template includes MAD/FDS only and private relay keys must match their owners.
4. Confirm HTTPS origins, cookie/CSRF behavior and cross-service HTTP paths on deployed integration. Publicly reachable staff login pages still require staff credentials and authorization.
5. Decide Caddy adoption with the existing sample. This file is a FUTURE replacement using full-stack DNS names; it is not a drop-in for the sample's current container aliases. It must share the full-stack network. Do not create a second public Caddy while the sample owns ports 80/443.
6. Preserve the existing Caddy certificate volumes explicitly when adopting them into infra; the current compose.yml does not create a Caddy container or perform a network/volume cutover. Verify gateway TRUSTED_PROXIES against the actual Caddy source address; do not trust arbitrary networks. Never copy an assumed static proxy address into the new network.
7. Check current DNS still points to the VM, TCP 80/443 are allowed and no stale AAAA record points elsewhere before issuing HTTPS certificates. Caddy automatic HTTPS needs reachable public challenge endpoints and persistent certificate storage.
8. Validate Caddy configuration with Caddy before applying it; full public HTTPS issuance and browser tests are not performed by generating these files. No live Azure changes have been made.

## Next implementation step

Wire owner image-publication jobs to the build manifest and resolve FOSS/WKMS gates, then prepare a reviewed Caddy network/certificate adoption procedure. Do not upload and replace the live sample Caddyfile now.
