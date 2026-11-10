> Historical preparation notes. Current state: [10 November status](STATUS-2026-11-10.md). Do not follow old rollout steps without comparing the live server.

# Deployment review and preflight

This review is local. No Azure containers, private environment files or Neon schema were changed.

## Confirmed failure causes

- Front Desk integration fixture lacked staff_users.roles although current repositories SELECT it. Added a nullable column so legacy role fallback is retained. All 56 PostgreSQL integration tests passed on disposable PostgreSQL 16 with Node 24 after that fix.
- Frontend and backend formatting errors existed in newly integrated tests. Use the whole formatter gate before pushing, not only the last failing file. Windows CRLF differs from Linux LF: local checks can use --end-of-line auto; do not reformat unrelated files solely for checkout line endings.
- Render-time Date.now checks violated React purity. The UI now subscribes to expiry through an external clock snapshot and timer; expiry rejection is retained and tested. Logout uses Next.js router navigation.
- Two branches independently added publication workflows. Resolved conflicts while preserving develop's configurable HTTPS origins, immutable image references, peer approval and all quality gates. Duplicate workflow_call keys introduced by automatic merge were removed. Publication still requires approval on the final PR head, not merely someone else pressing Merge.

## Hosted configuration gates

- API origin repository variables must be exact public HTTPS origins without a trailing slash. The image embeds NEXT_PUBLIC variables at build time.
- Front Desk uses Node 24; gateway/MAD/shared WebSocket use their own Node 22 image runtimes. Do not replace every runtime with one host version.
- Backend and frontend default ports are 4001 and 3001. Docker smoke explicitly sets PORT=3000 to match its test mapping; hosted Compose overrides ports separately.
- Neon DB_HOST must be hostname-only, DB_SSL=true, DB_SYNCHRONIZE=false and DB_LOGGING=false. DATABASE_URL takes precedence over DB_* and must not silently point elsewhere.
- RabbitMQ clients must use rabbitmq, matching credentials and vhost. localhost points at the client container. Editing broker initialization environment does not change users in an existing broker volume.
- The FDS hosted template now disables WKMS while it is unavailable. This is an explicitly partial deployment; WKMS-dependent flows are not accepted until live integration is enabled and checked.
- WebSocket FDS relay key/origin/auth verifier must match frontend server-only ticket settings. Keep the key out of NEXT_PUBLIC variables.
- Existing live transition overlay/Caddy configuration covers only HW/MAD. Before starting public FDS traffic, extend the overlay to attach fds-frontend to the existing sample edge, add its site to the transition Caddyfile, enable the FDS gateway route and add FDS to the running WebSocket registry. Do not upload the full-system Caddyfile as an unreviewed replacement.
- Local config/gateway-routes.json is a baseline template, not a dump of live server state. It still enables HW only. Never overwrite server route flags blindly.
- Shared gateway switch is incomplete until the existing HW frontend points to shared-gateway and the old sample gateway is stopped. Preserve active image overrides and adapt sample automation before rerunning it.
- Last observed Brevo response was 401 Key not found. Email reset is unresolved; HTTPS/readiness is not proof of email delivery or successful staff login.
- Template settings are NOT secret-bearing runtime settings. Copy only reviewed non-secret changes; never overwrite a teammate's configured .env files with examples.

## Secret-safe FDS configuration check

After copying scripts/check-fds-config.mjs to the server, explicitly run:

```bash
node /opt/forever-hotel/scripts/check-fds-config.mjs /opt/forever-hotel
```

This reads the FDS, broker, WebSocket and image/route files locally and reports variable names and mismatches only. It makes no network calls and prints no secrets. It intentionally blocks missing FDS release digests, disabled gateway routing and unconfigured WebSocket integration. Do not bypass those failures by disabling security. A pass is not proof of live password validity, migration state, baked image settings, Docker connectivity or external provider availability.

## Before sending another PR

1. Synchronize the intended integration branch without overwriting work; coordinate changes to shared workflows.
2. Run complete formatting/lint gates, tests for the changed behavior, and relevant integration tests on disposable databases.
3. Validate workflow YAML, reusable-job dependencies and shell syntax. PR publication skips are expected; merged integration-branch publication needs peer approval.
4. Build with intended public args and test runtime health/auth requests inside the image, not only whether a homepage redirects.
5. Run existing security audits; do not disable failing audit or coverage gates to publish.
6. Treat GitHub CI as the final environment-specific check. No single local check guarantees every dependency, runner or provider will behave identically.
