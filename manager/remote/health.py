# The cabinet's health (D365), read on the cabinet and printed as one JSON object. The Manager sends this file
# over SSH each time (sudo -n python3 -), so a cabinet needs nothing installed for it, and it only reads.
# Python's standard library only. Anything a cabinet doesn't have (no Wi-Fi on the virtual cabinet, no vcgencmd
# answer in a VM) is null, never an error.
import json
import os
import re
import shutil
import subprocess


def run(*cmd, timeout=5):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.stdout if r.returncode == 0 else None
    except Exception:
        return None


def read(path):
    try:
        with open(path) as f:
            return f.read().strip()
    except Exception:
        return None


out = {}

# CPU temperature: the SoC's thermal zone (millidegrees), or vcgencmd's.
temp = None
for zone in sorted(os.listdir("/sys/class/thermal")) if os.path.isdir("/sys/class/thermal") else []:
    if zone.startswith("thermal_zone"):
        t = read(f"/sys/class/thermal/{zone}/temp")
        if t and t.lstrip("-").isdigit():
            temp = int(t) / 1000
            break
if temp is None:
    m = re.search(r"temp=([\d.]+)", run("vcgencmd", "measure_temp") or "")
    temp = float(m.group(1)) if m else None
out["cpu_temp_c"] = temp

# Throttling (Raspberry Pi firmware): bits 0-3 now, 16-19 since boot.
thr = None
m = re.search(r"throttled=(0x[0-9a-fA-F]+)", run("vcgencmd", "get_throttled") or "")
if m:
    v = int(m.group(1), 16)
    names = {0: "under-voltage", 1: "frequency capped", 2: "throttled", 3: "soft temperature limit"}
    thr = {
        "raw": m.group(1),
        "now": [n for b, n in names.items() if v & (1 << b)],
        "since_boot": [n for b, n in names.items() if v & (1 << (b + 16))],
    }
out["throttled"] = thr

# Wi-Fi: the active connection's signal (0-100) and band, from NetworkManager.
wifi = None
for line in (run("nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL,FREQ,DEVICE", "dev", "wifi") or "").splitlines():
    parts = re.split(r"(?<!\\):", line)
    if len(parts) >= 5 and parts[0] == "yes":
        freq = int(re.sub(r"\D", "", parts[3]) or 0)
        wifi = {"ssid": parts[1].replace("\\:", ":"), "signal": int(parts[2] or 0), "mhz": freq, "band": "5 GHz" if freq >= 4900 else "2.4 GHz" if freq else None, "device": parts[4]}
        break
if wifi:
    m = re.search(r"signal:\s*(-?\d+)\s*dBm", run("iw", "dev", wifi["device"], "link") or run("/usr/sbin/iw", "dev", wifi["device"], "link") or "")
    wifi["dbm"] = int(m.group(1)) if m else None
out["wifi"] = wifi

# Disk free: the root filesystem and the boot partition.
disks = {}
for name, mount in (("root", "/"), ("boot", "/boot/firmware")):
    if os.path.ismount(mount) or mount == "/":
        try:
            u = shutil.disk_usage(mount)
            disks[name] = {"mount": mount, "total_mb": u.total // 2**20, "free_mb": u.free // 2**20, "free_pct": round(100 * u.free / u.total, 1)}
        except Exception:
            pass
out["disk"] = disks

up = read("/proc/uptime")
out["uptime_s"] = int(float(up.split()[0])) if up else None
out["version"] = read("/etc/arcade/provisioned-version")
out["release"] = os.path.basename(os.path.realpath("/opt/arcade/current")) if os.path.exists("/opt/arcade/current") else None
out["profile"] = (re.search(r"^profile=(\S+)", read("/etc/arcade/cabinet.conf") or "", re.M) or [None, None])[1]
out["services"] = {s: (run("systemctl", "is-active", s) or "inactive").strip() or "unknown" for s in ("arcade-launcher", "arcade-kiosk")}

# The service's last warnings and errors, newest last. The kids' words are in the logs under /var/lib/arcade, not here.
errors = []
for line in (run("journalctl", "-u", "arcade-launcher", "-u", "arcade-kiosk", "-p", "warning", "-n", "12", "--no-pager", "-o", "short-iso", timeout=10) or "").splitlines():
    if line.startswith("-- "):
        continue
    errors.append(line[:400])
out["journal"] = errors

print(json.dumps(out))
