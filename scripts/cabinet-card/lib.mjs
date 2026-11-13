// Pure helpers for the Picade's microSD card (D250-D256): what goes on the card, and whether a disk may be
// written. No disk, no network, so they can be tested.
import { pbkdf2Sync } from "node:crypto";

/** The real cabinet. Its hostname comes from the picade profile, so there's one place to change it. */
export const CABINET = "arcade";
export const PROFILE = "picade";
export const ADMIN = "cabinet";

/** A microSD card for the cabinet: big enough for the image and years of carts, small enough not to be a drive. */
export const MIN_BYTES = 8e9;
export const MAX_BYTES = 260e9;
/** What macOS calls the buses a card reader or a USB stick sits on. */
const CARD_BUSES = new Set(["USB", "Secure Digital", "SD"]);

/** The hostname the picade profile sets, read from its text. */
export function profileHostname(profileText) {
  const m = profileText.match(/^HOSTNAME_WANTED=([a-z][a-z0-9-]*)$/m);
  if (!m) throw new Error("the picade profile has no HOSTNAME_WANTED");
  return m[1];
}

/** A YAML double-quoted string. JSON's escapes are a subset of YAML's, so JSON.stringify is exact. */
const q = (s) => JSON.stringify(String(s));

/**
 * The WPA-PSK the access point uses: PBKDF2-HMAC-SHA1(passphrase, SSID, 4096, 32), as wpa_passphrase prints it.
 * The card holds this, not the passphrase. A 64-hex-digit key is already a PSK and is used as it is.
 */
export function wifiPsk(ssid, passphrase) {
  const ssidBytes = Buffer.from(ssid, "utf8");
  if (ssidBytes.length < 1 || ssidBytes.length > 32) throw new Error("a Wi-Fi network name is 1 to 32 bytes");
  if (/^[0-9a-fA-F]{64}$/.test(passphrase)) return passphrase.toLowerCase();
  if (!/^[\x20-\x7e]{8,63}$/.test(passphrase)) throw new Error("a WPA2 password is 8 to 63 printable ASCII characters");
  return pbkdf2Sync(Buffer.from(passphrase, "utf8"), ssidBytes, 4096, 32, "sha1").toString("hex");
}

/**
 * cloud-init's meta-data. A new instance id per card, so cloud-init treats each flash as a new machine. The key is
 * `instance-id`: Pi OS's own template says `instance_id`, which cloud-init ignores (the rehearsal came up as
 * "nocloud", D300+ rehearsal).
 */
export function metaData(instanceId) {
  if (!/^[A-Za-z0-9._-]+$/.test(instanceId)) throw new Error("bad instance id");
  return `# Written by scripts/cabinet-card (D250).\ndsmode: local\ninstance-id: ${instanceId}\n`;
}

/**
 * cloud-init's network-config: the home Wi-Fi, by its PSK. Applied once, on first boot; then user-data's
 * runcmd overwrites this file, so the PSK lives only in /etc/netplan on the cabinet (D251).
 */
export function networkConfig({ ssid, psk, country }) {
  // A 64-hex WPA key, or (--wpa3: WPA3's SAE can't use a precomputed key) the passphrase itself.
  if (!/^[0-9a-f]{64}$/.test(psk) && !/^[\x20-\x7e]{8,63}$/.test(psk)) throw new Error("the PSK must be 64 hex digits, or an 8-63 character passphrase");
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("the Wi-Fi country is a two-letter code, such as US");
  return [
    "# Written by scripts/cabinet-card (D251). Replaced on first boot, once cloud-init has applied it.",
    "network:",
    "  version: 2",
    "  renderer: NetworkManager",
    "  wifis:",
    "    wlan0:",
    "      dhcp4: true",
    "      optional: true",
    `      regulatory-domain: ${q(country)}`,
    "      access-points:",
    `        ${q(ssid)}:`,
    `          password: ${q(psk)}`,
    "",
  ].join("\n");
}

/** What network-config becomes after first boot. */
export const NETWORK_CONFIG_APPLIED = "# Applied on the cabinet's first boot. Its Wi-Fi settings are in /etc/netplan now (D251).\n";

/**
 * cloud-init's user-data. Makes the admin user with the mini's key (Pi OS's own add_user renames the image's
 * first user and masks its rename wizard), sets the clock's zone and the locale, turns SSH on, and plants the
 * seed's first-boot service, which runs provision.sh with the picade profile (D143, D250).
 */
export function userData({ hostname, timezone, locale, authorizedKey, country }) {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(hostname)) throw new Error("bad hostname");
  if (!/^[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)*$/.test(timezone)) throw new Error("bad time zone");
  if (!/^[a-z]{2,3}_[A-Z]{2}\.UTF-8$/.test(locale)) throw new Error("bad locale");
  if (!/^ssh-ed25519 [A-Za-z0-9+/=]+( [^\n]*)?$/.test(authorizedKey.trim())) throw new Error("the key must be one ssh-ed25519 public key");
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("bad Wi-Fi country");
  const plant = [
    "install -m 0644 /boot/firmware/seed/arcade-seed.service /etc/systemd/system/arcade-seed.service",
    "systemctl daemon-reload",
    "systemctl enable arcade-seed.service",
    "systemctl start --no-block arcade-seed.service",
  ].join(" && ");
  return [
    "#cloud-config",
    "# Written by scripts/cabinet-card for the Picade's first boot (D250). Holds no secrets.",
    `hostname: ${hostname}`,
    "manage_etc_hosts: true",
    `timezone: ${q(timezone)}`,
    `locale: ${q(locale)}`,
    "enable_ssh: true",
    "ssh_pwauth: false",
    "users:",
    `  - name: ${ADMIN}`,
    "    gecos: Cabinet admin",
    "    shell: /bin/bash",
    "    lock_passwd: true",
    "    sudo: ALL=(ALL) NOPASSWD:ALL",
    "    groups: [sudo, systemd-journal]",
    "    ssh_authorized_keys:",
    `      - ${q(authorizedKey.trim())}`,
    "bootcmd:",
    // Pi OS keeps Wi-Fi blocked until a country is set; network-config's regulatory-domain should do it.
    `  - [sh, -c, ${q(`raspi-config nonint do_wifi_country ${country} || true; rfkill unblock wifi || true`)}]`,
    // D244's networkd wait, masked now: provision.sh masks it too, but only after cloud-config, which it holds 2 minutes.
    `  - [sh, -c, ${q("systemctl mask systemd-networkd-wait-online.service; systemctl stop --no-block systemd-networkd-wait-online.service || true")}]`,
    "runcmd:",
    `  - [sh, -c, ${q(`printf '%s' ${shellQuote(NETWORK_CONFIG_APPLIED)} > /boot/firmware/network-config`)}]`,
    `  - [sh, -c, ${q(plant)}]`,
    "",
  ].join("\n");
}

/** A POSIX single-quoted word. */
export function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** The files a picade seed holds, beside the cloud-init files at the FAT's root. */
export const SEED_FILES = ["provision.tar.gz", "bundle.tar.gz", "commit", "firstboot.sh", "arcade-seed.service", "profile", "hostname", "authorized_keys"];

/**
 * Whether a disk may be written. `info` is `diskutil info -plist` as JSON; `bootWholeDisks` are the whole
 * disks behind the mini's own volumes. Returns the reasons to refuse; none means it's a card we may erase.
 */
export function refusals(info, { bootWholeDisks = [] } = {}) {
  const r = [];
  const id = info.DeviceIdentifier ?? "";
  if (!/^disk\d+$/.test(id) || info.WholeDisk !== true) r.push(`${id || "it"} isn't a whole disk; name the disk (disk4), not a partition`);
  if (bootWholeDisks.includes(id) || bootWholeDisks.includes(info.ParentWholeDisk)) r.push(`${id} holds the mini's own system`);
  if (info.Internal !== false) r.push(`${id} is an internal disk`);
  if (info.VirtualOrPhysical !== "Physical") r.push(`${id} isn't a physical disk (it's ${info.VirtualOrPhysical ?? "unknown"}: a disk image, APFS container or RAID)`);
  if (!CARD_BUSES.has(info.BusProtocol)) r.push(`${id} is on ${info.BusProtocol ?? "an unknown bus"}, not a card reader or USB`);
  if (!(info.RemovableMedia === true || info.Removable === true || info.Ejectable === true || info.RemovableMediaOrExternalDevice === true)) r.push(`${id} isn't removable`);
  const size = Number(info.TotalSize ?? info.Size ?? 0);
  if (!(size >= MIN_BYTES && size <= MAX_BYTES)) r.push(`${id} is ${gb(size)}; a cabinet card is ${gb(MIN_BYTES)} to ${gb(MAX_BYTES)}`);
  if (info.WritableMedia === false) r.push(`${id} is read-only (check the card's lock switch)`);
  return r;
}

export const gb = (bytes) => `${(Number(bytes) / 1e9).toFixed(1)} GB`;

/** What Geoff types to erase it: names the disk and its size, so a different card can't be confirmed by habit. */
export function confirmPhrase(info) {
  return `erase ${info.DeviceIdentifier} ${Math.round(Number(info.TotalSize ?? info.Size) / 1e9)}GB`;
}

/** The same card still? Compared just before writing, in case it was swapped after confirming. */
export function sameDisk(a, b) {
  const keys = ["DeviceIdentifier", "TotalSize", "MediaName", "IORegistryEntryName", "BusProtocol", "DiskUUID"];
  return keys.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

/** The lines shown before the confirmation: the disk, then each volume and partition on it. */
export function describe(info, parts) {
  const lines = [`${info.DeviceIdentifier}: ${info.MediaName || info.IORegistryEntryName || "unnamed"}, ${gb(info.TotalSize ?? info.Size)}, ${info.BusProtocol}`];
  if (!parts.length) lines.push("  (no partitions)");
  for (const p of parts) lines.push(`  ${p.DeviceIdentifier}  ${p.VolumeName || p.Content || "no name"}  ${gb(p.Size ?? 0)}${p.MountPoint ? `  mounted at ${p.MountPoint}` : ""}`);
  return lines;
}

/** The wheels in speech's requirements.lock: name, version and SHA-256 of each (D261). */
export function lockedWheels(lockText) {
  const out = [];
  for (const line of lockText.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z0-9_.-]+)==([^\s]+)\s+--hash=sha256:([0-9a-f]{64})$/);
    if (!m) throw new Error(`requirements.lock: can't read "${t}"`);
    out.push({ name: m[1], version: m[2], sha256: m[3] });
  }
  return out;
}
