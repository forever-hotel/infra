#!/usr/bin/env bash
set -euo pipefail
: "${STAGING_HOST:?Set staging host}"
: "${STAGING_USER:?Set staging user}"
: "${SSH_PRIVATE_KEY:?Set encrypted SSH key}"
: "${SSH_KNOWN_HOSTS:?Set verified host key}"
[[ "$STAGING_HOST" = forever-hotel-staging.malaysiawest.cloudapp.azure.com ]]
[[ "$STAGING_USER" = azureuser ]]
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]]
ssh_dir="$RUNNER_TEMP/image-cleanup-ssh"
install -d -m 700 "$ssh_dir"
printf '%s\n' "$SSH_PRIVATE_KEY" > "$ssh_dir/key"
printf '%s\n' "$SSH_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
chmod 600 "$ssh_dir/key" "$ssh_dir/known_hosts"
trap 'rm -f -- "$ssh_dir/key" "$ssh_dir/known_hosts"' EXIT
opts=(-i "$ssh_dir/key" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts" -o ConnectTimeout=20)
server="$STAGING_USER@$STAGING_HOST"
incoming="/opt/forever-hotel/.infra-release/cleanup-incoming-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
tar -czf "$RUNNER_TEMP/image-cleanup.tgz" scripts/image-retention.mjs scripts/service-release.mjs config/hotel-image-cleanup.service config/hotel-image-cleanup.timer
ssh "${opts[@]}" "$server" "umask 077; mkdir -p '$incoming'"
scp "${opts[@]}" "$RUNNER_TEMP/image-cleanup.tgz" "$server:$incoming/bundle.tgz"
ssh "${opts[@]}" "$server" "set -e; tar -xzf '$incoming/bundle.tgz' -C '$incoming'; cd '$incoming'; test -x /usr/bin/node; node scripts/image-retention.mjs --dry-run"
# Reviewed installation; no image deletion is performed by this job.
ssh "${opts[@]}" "$server" "set -e; install -d -m 700 /opt/forever-hotel/.infra-release/cleanup; install -m 600 '$incoming/scripts/image-retention.mjs' /opt/forever-hotel/.infra-release/cleanup/image-retention.mjs; install -m 600 '$incoming/scripts/service-release.mjs' /opt/forever-hotel/.infra-release/cleanup/service-release.mjs; sudo -n install -m 644 '$incoming/config/hotel-image-cleanup.service' /etc/systemd/system/hotel-image-cleanup.service; sudo -n install -m 644 '$incoming/config/hotel-image-cleanup.timer' /etc/systemd/system/hotel-image-cleanup.timer; sudo -n systemctl daemon-reload; sudo -n systemctl enable --now hotel-image-cleanup.timer; sudo -n systemctl is-enabled hotel-image-cleanup.timer"
