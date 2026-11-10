#!/usr/bin/env bash
set -euo pipefail
: "${STAGING_HOST:?Set staging host}"
: "${STAGING_USER:?Set staging user}"
: "${SSH_PRIVATE_KEY:?Set encrypted SSH key}"
: "${SSH_KNOWN_HOSTS:?Set verified host entry}"
[[ "$STAGING_HOST" = forever-hotel-staging.malaysiawest.cloudapp.azure.com ]]
[[ "$STAGING_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]
[[ "$SERVICE" =~ ^(mad|fds|foss|wkms|kms|gateway|websocket|hw)$ ]]
[[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ ]]
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]]
ssh_dir="$RUNNER_TEMP/service-ssh"
install -d -m 700 "$ssh_dir"
printf '%s\n' "$SSH_PRIVATE_KEY" > "$ssh_dir/key"
printf '%s\n' "$SSH_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
chmod 600 "$ssh_dir/key" "$ssh_dir/known_hosts"
trap 'rm -f -- "$ssh_dir/key" "$ssh_dir/known_hosts"' EXIT
opts=(-i "$ssh_dir/key" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts" -o ConnectTimeout=20)
server="$STAGING_USER@$STAGING_HOST"
incoming="/opt/forever-hotel/.infra-release/$SERVICE-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
manifest="$RUNNER_TEMP/service-release/release-images.json"
if test ! -f "$manifest"; then manifest="$RUNNER_TEMP/service-release/release-image.json"; fi
bundle="$RUNNER_TEMP/service-bundle"
install -d -m 700 "$bundle"
cp "$ACTION_ROOT/../../../scripts/service-release.mjs" "$bundle/service-release.mjs"
cp "$manifest" "$bundle/release.json"
tar -czf "$RUNNER_TEMP/service-release.tgz" -C "$bundle" service-release.mjs release.json
ssh "${opts[@]}" "$server" "umask 077; mkdir -p '$incoming'"
scp "${opts[@]}" "$RUNNER_TEMP/service-release.tgz" "$server:$incoming/bundle.tgz"
result=0
ssh "${opts[@]}" "$server" "tar -xzf '$incoming/bundle.tgz' -C '$incoming'; cd '$incoming'; node service-release.mjs release.json '$GITHUB_SHA' /opt/forever-hotel/.infra-release/host.json '$SERVICE'" || result=$?
# Always try to retain a matching receipt, without accidentally uploading an earlier run's record.
scp "${opts[@]}" "$server:/opt/forever-hotel/.infra-release/$SERVICE-last-attempt.json" "$RUNNER_TEMP/service-release/receipt.json" 2>/dev/null || true
if test -f "$RUNNER_TEMP/service-release/receipt.json"; then
  node -e 'const fs=require("fs");const p=process.argv[1];try{if(JSON.parse(fs.readFileSync(p,"utf8")).commit!==process.env.GITHUB_SHA)fs.unlinkSync(p)}catch{fs.rmSync(p,{force:true})}' "$RUNNER_TEMP/service-release/receipt.json"
fi
exit "$result"
