// The Picade's Wi-Fi from the mini's side and the provisioning script's (D411, D412, D416): how the mini finds
// the cabinet when its name doesn't answer, and what provisioning installs. No cabinet and no network.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const CONNECT = path.join(REPO, "scripts/cabinet-card/picade-connect.sh");
const WIFI_SH = path.join(REPO, "cabinet/provision/wifi.sh");
const mac = process.platform === "darwin";

/** A stand-in for the cabinet's SSH port: says hello and echoes. */
function listener() {
  return new Promise((resolve) => {
    const server = net.createServer((s) => {
      s.on("error", () => {}); // the finder's probe connects and drops
      s.write("SSH-2.0-test\n");
      s.pipe(s);
    });
    server.listen(0, "127.0.0.1", () => resolve({ port: /** @type {net.AddressInfo} */ (server.address()).port, close: () => server.close() }));
  });
}

/** A folder for the Picade's files on the mini, and a name lookup that knows only `names`. */
function setup(/** @type {Record<string, string>} */ names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "picade-find-"));
  const resolver = path.join(dir, "resolve.sh");
  fs.writeFileSync(resolver, `#!/bin/bash\ncase "$1" in\n${Object.entries(names).map(([n, ip]) => `  ${n}) echo ${ip} ;;`).join("\n")}\nesac\n`, { mode: 0o755 });
  return { dir, env: { ...process.env, GSA_CABINET_DIR: dir, PICADE_RESOLVE: resolver } };
}

/** Run it as SSH would, read the first line the far end says. */
function connect(/** @type {NodeJS.ProcessEnv} */ env, /** @type {number} */ port) {
  return new Promise((resolve) => {
    const child = spawn("/bin/bash", [CONNECT, "arcade.local", String(port)], { env });
    let out = "";
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.stdout.on("data", (d) => {
      out += d;
      if (out.includes("\n")) child.kill();
    });
    child.on("close", (code) => resolve({ out, err, code }));
  });
}

test("the mini finds the Picade by its name and remembers the address", { skip: !mac }, async () => {
  const l = await listener();
  const { dir, env } = setup({ "arcade.local": "127.0.0.1" });
  const r = await connect(env, l.port);
  assert.equal(r.out, "SSH-2.0-test\n");
  assert.equal(r.err, "");
  assert.equal(fs.readFileSync(path.join(dir, "last-address"), "utf8"), "127.0.0.1\n");
  l.close();
});

test("when the name is quiet it tries the router's name, then the last address, and says which", { skip: !mac }, async () => {
  const l = await listener();
  const router = setup({ "arcade.lan": "127.0.0.1" });
  const viaRouter = await connect(router.env, l.port);
  assert.equal(viaRouter.out, "SSH-2.0-test\n");
  assert.match(viaRouter.err, /didn't answer by name; reaching it at 127\.0\.0\.1 \(arcade\.lan\)/);

  const last = setup({});
  fs.writeFileSync(path.join(last.dir, "last-address"), "127.0.0.1\n");
  const viaLast = await connect(last.env, l.port);
  assert.equal(viaLast.out, "SSH-2.0-test\n");
  assert.match(viaLast.err, /\(last-address\)/);
  l.close();
});

test("off the home Wi-Fi: Tailscale's address, then the addresses the card worker recorded for the cable and the USB port", { skip: !mac }, async () => {
  const l = await listener();
  const ts = setup({});
  const tailscale = path.join(ts.dir, "tailscale");
  fs.writeFileSync(tailscale, '#!/bin/bash\n[ "$1 $2 $3" = "ip -4 arcade" ] && echo 127.0.0.1\n', { mode: 0o755 });
  const viaTailscale = await connect({ ...ts.env, PICADE_TAILSCALE: tailscale }, l.port);
  assert.equal(viaTailscale.out, "SSH-2.0-test\n");
  assert.match(viaTailscale.err, /\(tailscale\)/);

  const usb = setup({});
  fs.writeFileSync(path.join(usb.dir, "last-known-address.json"), '{\n  "eth0": { "mac": "02:00:00:00:00:01", "link_local": "fe80::ff:fe00:1" },\n  "usb_gadget": { "ipv4": "127.0.0.1" }\n}\n');
  const viaUsb = await connect({ ...usb.env, PICADE_TAILSCALE: "", PICADE_CABLE_IF: "lo0" }, l.port);
  assert.equal(viaUsb.out, "SSH-2.0-test\n");
  assert.match(viaUsb.err, /\(usb-port\)/);
  l.close();
});

test("with nothing answering it fails, saying what it tried; a damaged last-address file is never used", { skip: !mac }, async () => {
  const none = setup({});
  const r = spawnSync("/bin/bash", [CONNECT, "arcade.local", "1"], { env: none.env, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /can't find the Picade/);
  fs.writeFileSync(path.join(none.dir, "last-address"), "127.0.0.1; rm -rf x\n");
  const bad = spawnSync("/bin/bash", [CONNECT, "arcade.local", "1"], { env: none.env, encoding: "utf8" });
  assert.equal(bad.status, 1);
});

test("SSH to the Picade goes through the finder: the driver and the Manager", () => {
  const drive = fs.readFileSync(path.join(REPO, "cabinet/vm/drive"), "utf8");
  assert.match(drive, /ProxyCommand=\$REPO\/scripts\/cabinet-card\/picade-connect\.sh %h %p/);
  assert.match(fs.readFileSync(path.join(REPO, "manager/cabinet.mjs"), "utf8"), /ProxyCommand=\$\{PICADE_CONNECT\} %h %p/);
  assert.ok(fs.statSync(CONNECT).mode & 0o100, "picade-connect.sh is executable");
});

test("the driver reaches the Picade with the Picade's own key and known_hosts, never the virtual cabinet's", () => {
  // A stand-in ssh that prints what it was given.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drive-ssh-"));
  fs.writeFileSync(path.join(dir, "ssh"), '#!/bin/bash\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
  const picade = path.join(dir, "picade");
  const vm = path.join(dir, "vm");
  const drive = (/** @type {Record<string, string>} */ env) =>
    execFileSync("/bin/bash", [path.join(REPO, "cabinet/vm/drive"), "ssh", "true"], { encoding: "utf8", env: { PATH: `${dir}:/usr/bin:/bin`, HOME: dir, GSA_CABINET_DIR: picade, GSA_VM_DIR: vm, ARCADE_RIDE_S: "1", ...env } });
  for (const env of [{ CABINET: "real" }, { ARCADE_CABINET: "real" }, { ARCADE_HOST: "arcade.local" }]) {
    const args = drive(env);
    assert.match(args, new RegExp(`^${picade}/ssh/arcade_ed25519$`, "m"), JSON.stringify(env));
    assert.match(args, new RegExp(`^UserKnownHostsFile=${picade}/ssh/known_hosts$`, "m"));
    assert.match(args, /^cabinet@arcade\.local$/m);
    assert.match(args, /^ProxyCommand=.*picade-connect\.sh %h %p$/m);
    assert.doesNotMatch(args, new RegExp(vm));
  }
  const virtual = drive({});
  assert.match(virtual, new RegExp(`^${vm}/ssh/arcade-virtual_ed25519$`, "m"));
  assert.match(virtual, /^cabinet@arcade-virtual\.local$/m);
  assert.doesNotMatch(virtual, /ProxyCommand/);
  // A rehearsal on a forwarded port keeps the key it was given.
  const rehearsal = drive({ ARCADE_HOST: "127.0.0.1", ARCADE_SSH_PORT: "2299", ARCADE_SSH_DIR: path.join(dir, "r"), ARCADE_SSH_KEY_NAME: "arcade_ed25519" });
  assert.match(rehearsal, new RegExp(`^${dir}/r/arcade_ed25519$`, "m"));
  assert.doesNotMatch(rehearsal, /ProxyCommand/);
});

test("drive screenshot keeps the Picade's real grab: 1152x864 with a note, 1024x768 quietly; refuses what isn't a screen (D419)", async () => {
  const { encodePng } = await import("../../../studio-kit/playtest/src/png.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drive-shot-"));
  const png = (/** @type {number} */ w, /** @type {number} */ h) => {
    const file = path.join(dir, `${w}x${h}.png`);
    fs.writeFileSync(file, encodePng({ width: w, height: h, pixels: new Uint8Array(w * h) }, ["#000000"]));
    return file;
  };
  // A stand-in ssh: whatever is asked, it answers with the file named in SHOT.
  fs.writeFileSync(path.join(dir, "ssh"), '#!/bin/bash\ncat "$SHOT"\n', { mode: 0o755 });
  const shot = (/** @type {string} */ from, /** @type {string} */ name) => {
    const out = path.join(dir, name);
    const r = spawnSync("/bin/bash", [path.join(REPO, "cabinet/vm/drive"), "screenshot", out], { encoding: "utf8", env: { PATH: `${dir}:/usr/bin:/bin`, HOME: dir, GSA_CABINET_DIR: path.join(dir, "picade"), CABINET: "real", ARCADE_RIDE_S: "1", SHOT: from } });
    return { ...r, out };
  };
  const picade = shot(png(1152, 864), "picade.png");
  assert.equal(picade.status, 0, picade.stderr);
  assert.equal(picade.stdout.trim(), picade.out);
  assert.match(picade.stderr, /the cabinet's screen is 1152x864, not 1024x768/);
  assert.ok(fs.existsSync(picade.out) && !fs.existsSync(`${picade.out}.tmp`));
  const exact = shot(png(1024, 768), "exact.png");
  assert.equal(exact.status, 0);
  assert.equal(exact.stderr, "");
  const small = shot(png(640, 480), "small.png");
  assert.equal(small.status, 1);
  assert.match(small.stderr, /not a PNG of at least 1024x768/);
  assert.ok(!fs.existsSync(small.out) && fs.existsSync(`${small.out}.tmp`), "what came back is kept beside, for a look");
  const text = path.join(dir, "words.txt");
  fs.writeFileSync(text, "sudo: arcade-screenshot: command not found\n");
  assert.equal(shot(text, "words.png").status, 1);
});

/** A function of wifi.sh's, run in bash. */
const fn = (/** @type {string} */ name) => execFileSync("/bin/bash", ["-c", `. "${WIFI_SH}"; ${name}`], { encoding: "utf8" });

test("provisioning turns Wi-Fi power saving off and retries a network for ever (D411)", () => {
  const conf = fn("nm_wifi_conf");
  assert.match(conf, /^\[main\]\nautoconnect-retries-default=0$/m);
  assert.match(conf, /^\[connection-arcade-wifi\]\nwifi\.powersave=2$/m);
});

test("the watch and the socket: root's, restarted for ever, and only the kiosk's user may ask (D412, D414)", () => {
  const watch = fn("wifi_watch_unit");
  assert.match(watch, /^ExecStart=\/usr\/local\/bin\/node \/opt\/arcade\/current\/cabinet\/service\/bin\/arcade-wifi\.js watch$/m);
  assert.match(watch, /^Restart=always$/m);
  assert.doesNotMatch(watch, /^User=/m);
  assert.match(watch, /^RuntimeDirectory=arcade-wifi$/m);
  const socket = fn("wifi_socket_unit");
  assert.match(socket, /^ListenStream=\/run\/arcade-wifi\.sock$/m);
  assert.match(socket, /^SocketGroup=arcade$/m);
  assert.match(socket, /^SocketMode=0660$/m);
  assert.match(socket, /^Accept=yes$/m);
  const serve = fn("wifi_serve_unit");
  assert.match(serve, /arcade-wifi\.js serve$/m);
  assert.match(serve, /^StandardInput=socket$/m);
  // The paths the units name are the ones the helper uses.
  const src = fs.readFileSync(path.join(REPO, "cabinet/service/src/wifi.js"), "utf8");
  assert.match(src, /SOCKET = "\/run\/arcade-wifi\.sock"/);
  assert.match(src, /STATUS_FILE = "\/run\/arcade-wifi\/status\.json"/);
  assert.ok(fs.existsSync(path.join(REPO, "cabinet/service/bin/arcade-wifi.js")));
});

test("provisioning runs the Wi-Fi step after the arcade is unpacked, and writes its files whole", () => {
  const provision = fs.readFileSync(path.join(REPO, "cabinet/provision/provision.sh"), "utf8");
  assert.match(provision, /\. "\$SELF_DIR\/wifi\.sh"/);
  assert.ok(provision.indexOf("\nstep_wifi\n") > provision.indexOf("\nstep_services\n"));
  const sh = fs.readFileSync(WIFI_SH, "utf8");
  for (const f of ["arcade-wifi.conf", "arcade-wifi-watch.service", "arcade-wifi.socket", "arcade-wifi@.service"]) assert.match(sh, new RegExp(`put_file "\\$tmp/\\w+" \\S*${f.replace(/[.@]/g, "\\$&")} 0644`), f);
  assert.equal(spawnSync("/bin/bash", ["-n", WIFI_SH]).status, 0);
});
