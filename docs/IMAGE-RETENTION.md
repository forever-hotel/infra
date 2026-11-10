# VM application image retention

## Purpose and limits

This policy cleans local Docker application images on the staging VM. It does not delete GHCR versions, containers, volumes, Caddy/RabbitMQ images or build cache. GitHub currently lists GHCR container storage/bandwidth as free. Azure managed disk capacity is provisioned separately; freeing files prevents disk exhaustion but does not itself resize the disk or reduce the VM's fixed price.

Billing references: https://docs.github.com/en/billing/concepts/product-billing/github-packages and https://learn.microsoft.com/en-us/azure/virtual-machines/disks-understand-billing.

## Protected versions

For each application component, keep the current running image and previous healthy image from its successful service receipt. Also keep every image referenced by any running or stopped container. Images younger than 24 hours receive a grace period. Missing, failed, stale or ambiguous receipts (including a repeat deploy with no distinct previous image) cause that service to be skipped. Unknown, untagged or mixed-ownership images are preserved. This intentionally may retain more than two images when the evidence is incomplete or the extra images are recent.

The planner only selects older image references belonging to the allowlisted Forever Hotel application packages. It holds the same full-system and sample release locks as deployment. Immediately before removal it rechecks container use, image references and reference-to-image mapping. It never uses force or broad Docker prune commands. Docker remains an additional protection against removing container-referenced images. Interruption stops further removal and releases acquired locks.

## Installation and timing

Set repository variable VM_IMAGE_CLEANUP_ENABLED=true in infra, then peer-review and merge the cleanup implementation into develop. The existing validation job must pass and final-head approval is verified. Install reviewed VM image retention timer previews the plan over SSH and installs the two reviewed modules and systemd unit files. This job does not delete images or restart applications.

The timer first runs at the next scheduled 21:30 UTC, which is 03:00 Asia/Colombo the following day. Persistent=false prevents immediate catch-up deletion at installation. Old-image cleanup then runs daily. If a deployment holds either lock, cleanup skips that run. A failed Docker operation stops cleanup without forcing removal.

The scripts run as azureuser and use the already-authorized noninteractive Docker access. They read only sanitized image/container metadata and service receipts, not runtime env files. Routine application workflows do not need new pins for this independent VM timer.

## Preview and check on the VM

Run `node /opt/forever-hotel/.infra-release/cleanup/image-retention.mjs --dry-run` to preview after installation. Inspect `systemctl status hotel-image-cleanup.timer` and `sudo journalctl -u hotel-image-cleanup.service --since today` for timing and results. `sudo docker system df` shows current storage. The installer log appears under infra Actions; nightly runs appear in the VM journal.

Disable the timer with `sudo systemctl disable --now hotel-image-cleanup.timer`. Set VM_IMAGE_CLEANUP_ENABLED=false to prevent future installation jobs; that variable alone does not stop an already installed VM timer. Disabling never restores images already removed locally; retained GHCR versions remain available to pull.

## Initial evidence

A live dry-run selected 12 older local application images, protected 31 image IDs and skipped no service. No deletion or timer activation occurred during that preview. Actual candidate counts can change as releases occur. The first apply run remains dependent on reviewed merge and timer activation. GHCR deletion is outside this VM-only change.
