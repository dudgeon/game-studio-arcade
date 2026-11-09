// connect-cabinet.sh, end to end, with no VM, no network, no Console and a fake key (D155).
// ant, curl, the driver, pbpaste and pbcopy are stand-ins. service-config.mjs is the real one, pointed
// at a temp folder. The parts that need a real cabinet are in connect-vm.sh, run by hand.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const SCRIPT = path.join(REPO, "scripts/virtual-cabinet/connect-cabinet.sh");
const SERVICE_CONFIG = path.join(REPO, "cabinet/vm/guest/service-config.mjs");
const KEY = "sk-ant-api03-FAKEKEY1234567890";
const MINI_WORKSPACE = "wrkspc_MINI";
const skip = process.platform === "darwin" ? false : "uses macOS's script(1) for a terminal";

function exe(file, body) {
  fs.writeFileSync(file, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
}

/** A temp world: stand-ins on PATH, a mini's lock file, a cabinet's /etc/arcade and data. */
function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "connect-test-"));
  const w = {
    root,
    bin: path.join(root, "bin"),
    log: path.join(root, "log"),
    agent: path.join(root, "agent"),
    etc: path.join(root, "etc"),
    data: path.join(root, "data"),
    vm: path.join(root, "vm"),
    clipboard: path.join(root, "clipboard"),
  };
  for (const d of [w.bin, w.log, w.agent, w.etc, w.vm, path.join(w.data, "carts"), path.join(w.data, "logs")]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(w.agent, "claude-lock.json"), JSON.stringify({ origin: { workspace_id: MINI_WORKSPACE } }));
  fs.writeFileSync(w.clipboard, "");

  exe(path.join(w.bin, "ant"), `
echo "$*" >> "${w.log}/ant.argv"
env >> "${w.log}/ant.env"
k="$(cat)"
if [ "$k" = "${KEY}" ]; then echo ok >> "${w.log}/ant.stdin"; else echo wrong >> "${w.log}/ant.stdin"; fi
lock=""; prev=""
for a in "$@"; do [ "$prev" = --lock-file ] && lock="$a"; prev="$a"; done
case " $* " in
  *" --dry-run "*) echo "stand-in plan" ;;
  *" --yes "*) printf '{"version":1,"origin":{"workspace_id":"wrkspc_CABINET"},"resources":{"./agents/studio.md":{"kind":"agent","id":"agent_TEST","version":"3"},"./environments/studio.yaml":{"kind":"environment","id":"env_TEST"}}}' > "$lock"; echo "stand-in applied" ;;
esac`);
  exe(path.join(w.bin, "curl"), `
echo "$*" >> "${w.log}/curl.argv"
env >> "${w.log}/curl.env"
cat > "${w.log}/curl.stdin"
printf 'HTTP/2 %s\\r\\nanthropic-workspace-id: %s\\r\\n\\r\\n' "\${STUB_STATUS:-200}" "\${STUB_WS:-wrkspc_CABINET}"`);
  // The driver: `drive ssh sudo node GUEST cmd` runs the real helper here, stdin and all.
  exe(path.join(w.bin, "stub-drive"), `
shift
echo "$*" >> "${w.log}/drive.argv"
case "$*" in
  "sudo node "*) shift 3; exec "${process.execPath}" "${SERVICE_CONFIG}" "$@" ;;
  "systemctl is-active arcade-launcher") echo active ;;
  *) echo "unexpected: $*" >&2; exit 9 ;;
esac`);
  exe(path.join(w.bin, "pbpaste"), `cat "${w.clipboard}"`);
  exe(path.join(w.bin, "pbcopy"), `cat > "${w.clipboard}"`);
  return w;
}

function envOf(w, extra = {}) {
  const env = {
    ...process.env,
    PATH: `${w.bin}:${process.env.PATH}`,
    HOME: w.root,
    GSA_VM_DIR: w.vm,
    GSA_NODE: process.execPath,
    ARCADE_DRIVE: path.join(w.bin, "stub-drive"),
    ARCADE_AGENT_DIR: w.agent,
    ARCADE_ETC: w.etc,
    ARCADE_DATA: w.data,
    ARCADE_NO_RESTART: "1",
    ...extra,
  };
  if (!("ANTHROPIC_API_KEY" in extra)) delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

/** Run in a real terminal. Answers each prompt as it appears, as a person would. */
function inTerminal(w, { key = KEY, confirm = "y", args = [], env = {} } = {}) {
  return new Promise((resolve) => {
    // script(1) needs a true pipe on stdin. Node's pipes are sockets, and so are FIFOs on macOS. So bash
    // turns a FIFO into a true pipe, and the output goes to a file.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "connect-term-"));
    const fifo = path.join(dir, "in");
    const outFile = path.join(dir, "out");
    execFileSync("mkfifo", [fifo]);
    const fd = fs.openSync(fifo, "r+");
    const outFd = fs.openSync(outFile, "w");
    const command = 'exec script -q /dev/null "$@" < <(cat "$TERM_FIFO")';
    const child = spawn("/bin/bash", ["-c", command, "bash", SCRIPT, ...args], { env: { ...envOf(w, env), TERM_FIFO: fifo }, stdio: ["ignore", outFd, outFd] });
    let keyed = false;
    let confirmed = false;
    const poll = setInterval(() => {
      const out = fs.readFileSync(outFile, "utf8");
      if (!keyed && out.includes("Paste the cabinet")) {
        keyed = true;
        // Past the moment read -s turns echo off, as a person's paste would be.
        setTimeout(() => fs.writeSync(fd, `${key}\n`), 400);
      }
      if (!confirmed && out.includes("(y/n)")) {
        confirmed = true;
        setTimeout(() => fs.writeSync(fd, `${confirm}\n`), 100);
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

/** Run with no terminal at all. */
function noTerminal(w, { args = [], env = {}, input = "" } = {}) {
  return new Promise((resolve) => {
    const child = execFile(SCRIPT, args, { env: envOf(w, env) }, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, out: stdout + stderr }));
    child.stdin.end(input);
  });
}

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
const configOf = (w) => path.join(w.etc, "service.json");

/** Every file under the temp world holding the key, apart from where it belongs. */
function keyFilesOutsideConfig(w) {
  const hits = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (p !== configOf(w) && fs.readFileSync(p, "latin1").includes("FAKEKEY")) hits.push(path.relative(w.root, p));
    }
  };
  walk(w.root);
  return hits;
}

test("refuses a key as an argument, without repeating it", { skip }, async () => {
  const r = await noTerminal(world(), { args: [KEY] });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /never an argument/);
  assert.doesNotMatch(r.out, /FAKEKEY/);
});

test("refuses to read a key with no terminal, so it can't land in a chat or a log", { skip }, async () => {
  const w = world();
  const r = await noTerminal(w, { input: `${KEY}\n` });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /Terminal window/);
  assert.equal(read(path.join(w.log, "ant.stdin")), "");
});

test("stops if ANTHROPIC_API_KEY is set (D16)", { skip }, async () => {
  const r = await noTerminal(world(), { env: { ANTHROPIC_API_KEY: "x" } });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /must never be set/);
});

test("refuses an Admin key", { skip }, async () => {
  const w = world();
  const r = await inTerminal(w, { key: "sk-ant-admin01-FAKEKEY" });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /Admin key/);
  assert.equal(read(path.join(w.log, "curl.argv")), "", "never sent anywhere");
});

test("refuses what isn't a key, and a key with stray characters", { skip }, async () => {
  assert.match((await inTerminal(world(), { key: "hello" })).out, /doesn't look like an API key/);
  assert.match((await inTerminal(world(), { key: 'sk-ant-api03-a"b' })).out, /character keys don't have/);
});

test("refuses a key for the mini's own workspace (D131)", { skip }, async () => {
  const w = world();
  const r = await inTerminal(w, { env: { STUB_WS: MINI_WORKSPACE } });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /the mini's own workspace/);
  assert.equal(read(path.join(w.log, "ant.argv")), "", "ant never ran");
});

test("says so when the API refuses the key, or it isn't scoped to a workspace", { skip }, async () => {
  assert.match((await inTerminal(world(), { env: { STUB_STATUS: "401" } })).out, /refused this key/);
  assert.match((await inTerminal(world(), { env: { STUB_STATUS: "400" } })).out, /isn't scoped to a workspace/);
});

test("answering no at the plan changes nothing", { skip }, async () => {
  const w = world();
  const r = await inTerminal(w, { confirm: "n" });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /nothing applied/);
  assert.equal(fs.existsSync(configOf(w)), false);
  assert.equal(fs.existsSync(path.join(w.agent, "claude-lock.arcade-virtual.json")), false);
  assert.doesNotMatch(read(path.join(w.log, "ant.argv")), /--yes/);
});

test("the full path: the key reaches ant and the cabinet by pipe, and nowhere else", { skip }, async () => {
  const w = world();
  fs.writeFileSync(w.clipboard, KEY);
  const inPs = [];
  const watch = setInterval(() => {
    execFile("ps", ["-axww", "-o", "command"], { maxBuffer: 2 ** 26 }, (_e, stdout) => {
      if (stdout?.includes("FAKEKEY")) inPs.push(stdout.split("\n").find((l) => l.includes("FAKEKEY")));
    });
  }, 100);
  const r = await inTerminal(w);
  clearInterval(watch);

  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /The cabinet is live in workspace wrkspc_CABINET/);
  assert.doesNotMatch(r.out, /FAKEKEY/, "not on screen");
  assert.deepEqual(inPs, [], "never in a process's arguments");

  // ant: the key on stdin, twice; the plan, then the apply, against this cabinet's own lock file.
  assert.deepEqual(read(path.join(w.log, "ant.stdin")).trim().split("\n"), ["ok", "ok"]);
  const argv = read(path.join(w.log, "ant.argv")).trim().split("\n");
  assert.match(argv[0], /^--api-key-stdin apply --lock-file claude-lock\.arcade-virtual\.json --dry-run agents\/studio\.md environments\/studio\.yaml$/);
  assert.match(argv[1], /--yes/);

  // Never an argument or an environment variable, anywhere.
  for (const f of ["ant.argv", "curl.argv", "drive.argv", "ant.env", "curl.env"]) assert.doesNotMatch(read(path.join(w.log, f)), /FAKEKEY/, f);
  for (const f of ["ant.env", "curl.env"]) assert.doesNotMatch(read(path.join(w.log, f)), /^ANTHROPIC_API_KEY=/m, f);
  assert.match(read(path.join(w.log, "curl.stdin")), /^x-api-key: sk-ant-/, "curl got it on stdin");

  // The cabinet's file.
  const stat = fs.statSync(configOf(w));
  assert.equal(stat.mode & 0o777, 0o600);
  assert.equal(stat.uid, fs.statSync(path.join(w.data, "carts")).uid, "owned by whoever owns the data, arcade on a cabinet");
  const config = JSON.parse(read(configOf(w)));
  assert.equal(config.anthropic_api_key, KEY);
  assert.equal(config.agent_id, "agent_TEST");
  assert.equal(config.agent_version, 3);
  assert.equal(config.environment_id, "env_TEST");
  assert.equal(config.budget_cents, 300);
  assert.equal(read(path.join(w.etc, "service.env")), `ARCADE_SERVICE_ARGS=--config ${configOf(w)}\n`);

  // Clipboard cleared; and with that, the key is in service.json and no other file in this world
  // (the stand-ins' logs included, which catch whatever the script hands them).
  assert.equal(read(w.clipboard), "");
  // bin/ant holds it to compare against, and curl.stdin is the stand-in's record of the header it was piped.
  assert.deepEqual(keyFilesOutsideConfig(w).filter((f) => f !== "log/curl.stdin" && f !== "bin/ant"), []);
  assert.match(read(path.join(w.agent, "claude-lock.arcade-virtual.json")), /wrkspc_CABINET/);
});

test("leaves a clipboard alone unless it holds the key", { skip }, async () => {
  const w = world();
  fs.writeFileSync(w.clipboard, "Geoff's own words");
  assert.equal((await inTerminal(w)).code, 0);
  assert.equal(read(w.clipboard), "Geoff's own words");
});

test("--reapply reuses the key on the cabinet and asks for none", { skip }, async () => {
  const w = world();
  assert.equal((await inTerminal(w)).code, 0);
  fs.writeFileSync(path.join(w.log, "ant.argv"), "");
  fs.writeFileSync(path.join(w.log, "ant.stdin"), "");
  const r = await inTerminal(w, { args: ["--reapply"] });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /Paste the cabinet/);
  assert.doesNotMatch(r.out, /FAKEKEY/);
  assert.deepEqual(read(path.join(w.log, "ant.stdin")).trim().split("\n"), ["ok", "ok"]);
  assert.doesNotMatch(read(path.join(w.log, "ant.argv")), /agents\/studio\.md/, "the lock file already tracks them");
});

test("--reapply stops on a cabinet with no key yet", { skip }, async () => {
  const r = await inTerminal(world(), { args: ["--reapply"] });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /no key yet/);
});

for (const [what, plant] of [
  ["a replay cart", (w) => {
    fs.mkdirSync(path.join(w.data, "carts/penguin-catch"));
    fs.writeFileSync(path.join(w.data, "carts/penguin-catch/cart.json"), JSON.stringify({ session_id: "sesn_replay" }));
  }],
  ["a replay session in the logs", (w) => fs.writeFileSync(path.join(w.data, "logs/studio_session.jsonl"), '{"id":"sesn_replay"}\n')],
  ["a replay session folder", (w) => fs.mkdirSync(path.join(w.data, "sessions/sesn_replay"), { recursive: true })],
]) {
  test(`won't go live with ${what} on the cabinet (D150), before asking for a key`, { skip }, async () => {
    const w = world();
    plant(w);
    const r = await inTerminal(w);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /replay data/);
    assert.match(r.out, /rebuild\.sh/);
    assert.doesNotMatch(r.out, /Paste the cabinet/);
  });
}

test("a seeded cart with no session isn't replay data", { skip }, async () => {
  const w = world();
  fs.mkdirSync(path.join(w.data, "carts/apple-catch"));
  fs.writeFileSync(path.join(w.data, "carts/apple-catch/cart.json"), JSON.stringify({ id: "apple-catch" }));
  assert.equal((await inTerminal(w)).code, 0);
});

test("service-config: bad input fails without quoting the key", { skip }, async () => {
  const w = world();
  const run = (input) =>
    new Promise((resolve) => {
      const c = execFile(process.execPath, [SERVICE_CONFIG, "install"], { env: envOf(w) }, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, out: stdout + stderr }));
      c.stdin.end(input);
    });
  for (const input of [`not json ${KEY}`, JSON.stringify({ anthropic_api_key: KEY }), JSON.stringify({ anthropic_api_key: KEY, agent_id: "a" })]) {
    const r = await run(input);
    assert.notEqual(r.code, 0);
    assert.doesNotMatch(r.out, /FAKEKEY/);
    assert.equal(fs.existsSync(configOf(w)), false);
  }
});
