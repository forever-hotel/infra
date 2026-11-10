#!/usr/bin/env bash
# Runs only from a protected GitHub deployment job. No env files travel in this bundle.
set -euo pipefail
: "${DEPLOY_HOST:?Set deployment host}"
: "${DEPLOY_USER:?Set deployment user}"
: "${DEPLOY_DIRECTORY:?Set approved deployment directory}"
: "${DEPLOY_ENVIRONMENT:?Set environment}"
: "${SSH_PRIVATE_KEY:?Set private key through GitHub Secrets}"
: "${SSH_KNOWN_HOSTS:?Set independently verified known_hosts entry}"
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]]
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]
[[ "$DEPLOY_DIRECTORY" =~ ^/opt/[a-zA-Z0-9_/-]+$ && "$DEPLOY_DIRECTORY" != *..* ]]
[[ "$DEPLOY_ENVIRONMENT" = staging || "$DEPLOY_ENVIRONMENT" = production ]]
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]]
ssh_dir="$RUNNER_TEMP/infra-ssh"
install -d -m 700 "$ssh_dir"
printf '%s\n' "$SSH_PRIVATE_KEY" > "$ssh_dir/key"
printf '%s\n' "$SSH_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
chmod 600 "$ssh_dir/key" "$ssh_dir/known_hosts"
trap 'rm -f -- "$ssh_dir/key" "$ssh_dir/known_hosts"' EXIT
opts=(-i "$ssh_dir/key" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts" -o ConnectTimeout=20)
server="$DEPLOY_USER@$DEPLOY_HOST"
incoming="$DEPLOY_DIRECTORY/.infra-release/incoming-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
tar -czf "$RUNNER_TEMP/infra-release.tgz" scripts/deploy.mjs scripts/release-core.mjs release/current.json
ssh "${opts[@]}" "$server" "umask 077; mkdir -p '$incoming'"
scp "${opts[@]}" "$RUNNER_TEMP/infra-release.tgz" "$server:$incoming/bundle.tgz"
ssh "${opts[@]}" "$server" "tar -xzf '$incoming/bundle.tgz' -C '$incoming'; cd '$incoming'; node scripts/deploy.mjs deploy release/current.json '$DEPLOY_DIRECTORY/.infra-release/host.json' '$DEPLOY_ENVIRONMENT'"
mkdir -p reports
scp "${opts[@]}" "$server:$DEPLOY_DIRECTORY/.infra-release/receipt.json" reports/receipt.json
