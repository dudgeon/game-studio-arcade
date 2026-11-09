#!/bin/bash
# First boot, from the FAT seed (D143). Copies the provisioning script off FAT
# (which can't hold modes or symlinks) and runs it with the profile in the seed.
set -euo pipefail
SEED=/boot/firmware/seed
echo "=== firstboot $(date -u) ==="
PROFILE="$(cat "$SEED/profile")"
WORK=/opt/arcade/provision
rm -rf "$WORK.new"
install -d "$WORK.new"
tar -xzf "$SEED/provision.tar.gz" -C "$WORK.new"
rm -rf "$WORK"
mv "$WORK.new" "$WORK"
/bin/bash "$WORK/provision.sh" --profile "$PROFILE" --payload "$SEED"
echo "=== firstboot ok $(date -u) ==="
touch "$SEED/provision.ok"
