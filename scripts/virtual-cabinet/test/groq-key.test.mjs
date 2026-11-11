// groq-key.sh, end to end, with no VM, no network and a fake key (D263). curl, the driver, pbpaste and
// pbcopy are stand-ins; service-config.mjs is the real one, pointed at a temp folder.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const SCRIPT = path.join(REPO, "scripts/virtual-cabinet/groq-key.sh");
const SERVICE_CONFIG = path.join(REPO, "cabinet/vm/guest/service-config.mjs");
const KEY = "gsk_FAKEKEY1234567890abcdef";
const skip = process.platform === "darwin" ? false : "uses macOS's script(1) for a terminal";

function exe(file, body) {
  fs.writeFileSync(file, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
}

function world({ configured = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groq-test-"));
  const w = { root, bin: path.join(root, "bin"), log: path.join(root, "log"), etc: path.join(root, "etc"), data: path.join(root, "data"), vm: path.join(root, "vm"), clipboard: path.join(root, "clipboard") };
  for (const d of [w.bin, w.log, w.etc, w.vm, path.join(w.data, "carts")]) fs.mkdirSync(d, { recursive: true });
  if (configured) fs.writeFileSync(path.join(w.etc, "service.json"), JSON.stringify({ anthropic_api_key: "sk-ant-x", agent_id: "agent_1", environment_id: "env_1" }), { mode: 0o600 });
  fs.writeFileSync(w.clipboard, KEY);
  exe(path.join(w.bin, "curl"), `
echo "$*" >> "${w.log}/curl.argv"
if [ "$(cat)" = "Authorization: Bearer ${KEY}" ]; then echo ok > "${w.log}/curl.stdin"; else echo wrong > "${w.log}/curl.stdin"; fi
printf '%s' "\${STUB_STATUS:-200}"`);
  exe(path.join(w.bin, "stub-drive"), `
shift
echo "$*" >> "${w.log}/drive.argv"
case "$*" in
  "sudo node "*) shift 3; exec "${process.execPath}" "${SERVICE_CONFIG}" "$@" ;;
  *) echo "unexpected: $*" >&2; exit 9 ;;
esac`);
  exe(path.join(w.bin, "pbpaste"), `cat "${w.clipboard}"`);
  exe(path.join(w.bin, "pbcopy"), `cat > "${w.clipboard}"`);
  return w;
}

function envOf(w, extra = {}) {
  return { ...process.env, PATH: `${w.bin}:${process.env.PATH}`, HOME: w.root, GSA_VM_DIR: w.vm, ARCADE_DRIVE: path.join(w.bin, "stub-drive"), ARCADE_ETC: w.etc, ARCADE_DATA: w.data, ARCADE_NO_RESTART: "1", ARCADE_CONNECT_TRIES: "1", ...extra };
}

/** In a real terminal, answering each prompt as it appears. */
function inTerminal(w, { key = KEY, zdr = "y", env = {} } = {}) {
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "groq-term-"));
    const fifo = path.join(dir, "in");
    const outFile = path.join(dir, "out");
    execFileSync("mkfifo", [fifo]);
    const fd = fs.openSync(fifo, "r+");
    const outFd = fs.openSync(outFile, "w");
    const child = spawn("/bin/bash", ["-c", 'exec script -q /dev/null "$@" < <(cat "$TERM_FIFO")', "bash", SCRIPT], { env: { ...envOf(w, env), TERM_FIFO: fifo }, stdio: ["ignore", outFd, outFd] });
    let asked = false;
    let keyed = false;
    const poll = setInterval(() => {
      const out = fs.readFileSync(outFile, "utf8");
      if (!asked && out.includes("(y/n)")) {
        asked = true;
        setTimeout(() => fs.writeSync(fd, `${zdr}\n`), 100);
      }
      if (!keyed && out.includes("Paste the Groq")) {
        keyed = true;
        setTimeout(() => fs.writeSync(fd, `${key}\n`), 400);
      }
    }, 50);
    child.on("close", (code) => {
      clearInterval(poll);
      const out = fs.readFileSync(outFile, "utf8");
      fs.closeSync(fd);
      fs.closeSync(outFd);
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ code, out: out.replace(/\r/g, "") });
    });
  });
}

function noTerminal(w, { args = [] } = {}) {
  return new Promise((resolve) => {
    const child = execFile(SCRIPT, args, { env: envOf(w) }, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, out: stdout + stderr }));
    child.stdin.end(`${KEY}\n`);
  });
}

const config = (w) => JSON.parse(fs.readFileSync(path.join(w.etc, "service.json"), "utf8"));

test("a key as an argument, or with no terminal, is refused", { skip }, async () => {
  const a = await noTerminal(world(), { args: [KEY] });
  assert.notEqual(a.code, 0);
  assert.match(a.out, /never an argument/);
  assert.doesNotMatch(a.out, /FAKEKEY/);
  const w = world();
  const b = await noTerminal(w);
  assert.match(b.out, /Terminal window/);
  assert.equal(config(w).groq_api_key, undefined);
});

test("no Zero Data Retention, no key", { skip }, async () => {
  const w = world();
  const r = await inTerminal(w, { zdr: "n" });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /turn it on first/);
  assert.equal(fs.existsSync(path.join(w.log, "curl.argv")), false, "never asked for the key");
});

test("what isn't a Groq key, or one Groq refuses, never reaches the cabinet", { skip }, async () => {
  let w = world();
  assert.match((await inTerminal(w, { key: "sk-ant-api03-x" })).out, /start gsk_/);
  w = world();
  assert.match((await inTerminal(w, { env: { STUB_STATUS: "401" } })).out, /refused this key/);
  assert.equal(config(w).groq_api_key, undefined);
  assert.equal(fs.existsSync(path.join(w.log, "drive.argv")), false);
});

test("a good key lands in the cabinet's config, 0600, the rest kept; the clipboard is cleared; --off takes it out", { skip }, async () => {
  const w = world();
  const r = await inTerminal(w);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /FAKEKEY/, "never shown");
  assert.equal(fs.readFileSync(path.join(w.log, "curl.stdin"), "utf8").trim(), "ok", "checked with the key on stdin");
  assert.doesNotMatch(fs.readFileSync(path.join(w.log, "curl.argv"), "utf8"), /FAKEKEY/);
  assert.doesNotMatch(fs.readFileSync(path.join(w.log, "drive.argv"), "utf8"), /FAKEKEY/);
  const c = config(w);
  assert.equal(c.groq_api_key, KEY);
  assert.equal(c.agent_id, "agent_1");
  assert.equal((fs.statSync(path.join(w.etc, "service.json")).mode & 0o777).toString(8), "600");
  assert.equal(fs.readFileSync(w.clipboard, "utf8"), "");
  const off = await noTerminal(w, { args: ["--off"] });
  assert.equal(off.code, 0, off.out);
  assert.equal(config(w).groq_api_key, undefined);
  assert.equal(config(w).anthropic_api_key, "sk-ant-x");
});

test("a cabinet with no config yet is told to connect first", { skip }, async () => {
  const w = world({ configured: false });
  const r = await inTerminal(w);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /Connect it first/);
});
