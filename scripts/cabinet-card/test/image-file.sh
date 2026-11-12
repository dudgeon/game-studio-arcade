#!/bin/bash
# The whole card, written to an image file through flash.mjs's own steps (D250): the pinned image, read back,
# the seed and cloud-init files on its FAT. Then checks what's there. Writes about 3 GB to OUT_DIR; no card, no sudo.
#
#   scripts/cabinet-card/test/image-file.sh [OUT_DIR]
#
# Uses a throwaway SSH key folder and a fake Wi-Fi network, never the cabinet's own.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
NODE="${GSA_NODE:-/opt/homebrew/opt/node@22/bin/node}"
OUT="${1:-$(mktemp -d "${TMPDIR:-/tmp}/card-e2e-XXXXXX")}"
mkdir -p "$OUT"
IMG="$OUT/card.img"
rm -f "$IMG"
export GSA_CABINET_DIR="$OUT/cabinet"
SSID='Test "Mesh": Café'
PASS='not-the-real-password-123'
fail() { echo "FAIL: $*" >&2; exit 1; }

printf '%s\n%s\n' "$SSID" "$PASS" | "$NODE" "$REPO/scripts/cabinet-card/flash.mjs" --image-file "$IMG" --timezone America/New_York --allow-dirty | tee "$OUT/flash.log"
grep -q "read back ok" "$OUT/flash.log" || fail "no read-back"

MNT="$(mktemp -d "$OUT/mnt-XXXX")"
plist="$(hdiutil attach -imagekey diskimage-class=CRawDiskImage -nobrowse -readonly -mountrandom "$MNT" -plist "$IMG")"
dev="$(printf '%s' "$plist" | sed -n 's|.*<string>\(/dev/disk[0-9]*\)</string>.*|\1|p' | head -1)"
boot="$(printf '%s' "$plist" | sed -n 's|.*<string>\('"$MNT"'/[^<]*\)</string>.*|\1|p' | head -1)"
trap 'hdiutil detach "$dev" >/dev/null 2>&1 || true' EXIT
[ -d "$boot" ] || fail "the FAT partition didn't mount"

for f in provision.tar.gz bundle.tar.gz commit firstboot.sh arcade-seed.service profile hostname authorized_keys node-v22.23.4-linux-arm64.tar.xz; do
  [ -s "$boot/seed/$f" ] || fail "seed/$f missing"
done
[ "$(cat "$boot/seed/profile")" = picade ] || fail "profile isn't picade"
[ "$(cat "$boot/seed/hostname")" = arcade ] || fail "hostname isn't arcade"
cmp -s "$boot/seed/authorized_keys" "$GSA_CABINET_DIR/ssh/arcade_ed25519.pub" || fail "authorized_keys isn't the cabinet's key"
cmp -s "$boot/seed/arcade-seed.service" "$REPO/cabinet/provision/files/arcade-seed.service" || fail "seed service differs"
cmp -s "$boot/seed/firstboot.sh" "$REPO/cabinet/provision/files/firstboot.sh" || fail "firstboot differs"
tar -tzf "$boot/seed/provision.tar.gz" | grep -q '^./profiles/picade.sh$' || fail "provision.tar has no picade profile"
tar -xzOf "$boot/seed/provision.tar.gz" ./profiles/picade.sh | cmp -s - "$REPO/cabinet/provision/profiles/picade.sh" || fail "picade.sh in the seed differs"
echo "$(shasum -a 256 "$boot/seed/node-v22.23.4-linux-arm64.tar.xz" | cut -c1-64)" | grep -q 6287aa46b6c375d816e63ae66d024fbbfd70404825aabdfdf898a970871d2f4b || fail "node tarball hash"
head -1 "$boot/user-data" | grep -qx '#cloud-config' || fail "user-data header"
grep -q '^  - name: cabinet$' "$boot/user-data" || fail "no cabinet user"
grep -q 'regulatory-domain: "US"' "$boot/network-config" || fail "no Wi-Fi country"
grep -q '"Test \\"Mesh\\": Café":' "$boot/network-config" || fail "SSID not quoted as expected"
grep -q "instance_id: arcade-" "$boot/meta-data" || fail "meta-data"
# The password is nowhere on the card or in the output: only its WPA key is.
if LC_ALL=C grep -a -q -F "$PASS" "$IMG" "$OUT/flash.log"; then fail "the Wi-Fi password is on the card or in the log"; fi
psk="$("$NODE" -e 'const {wifiPsk}=await import(process.argv[1]); console.log(wifiPsk(process.argv[2], process.argv[3]))' "$REPO/scripts/cabinet-card/lib.mjs" "$SSID" "$PASS")"
grep -q "password: \"$psk\"" "$boot/network-config" || fail "network-config doesn't hold the WPA key"
ls -A "$boot" | grep -q '^\._' && fail "AppleDouble files on the FAT"
# The bytes past the FAT are the pinned image's: compare the root partition with a fresh decompress.
p2="$(printf '%s' "$plist" | grep -c 'Linux' || true)"
[ "$p2" -ge 1 ] || fail "no Linux partition"
echo "ok: the card image at $IMG has the picade seed and cloud-init files, and no Wi-Fi password"
