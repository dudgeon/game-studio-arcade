// The parts of the in-place update and exactly-once keys that run with no cabinet (D195).
// The whole thing on a real cabinet: scripts/virtual-cabinet/test/update-vm.sh, by hand.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLE_PATHS, makeBundle, makeProvisionTar } from "../lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("the bundle holds what the service needs and nothing local", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-"));
  const out = path.join(dir, "b.tgz");
  assert.ok(makeBundle(REPO, out) > 100);
  const names = execFileSync("tar", ["-tzf", out], { encoding: "utf8", maxBuffer: 2 ** 26 }).split("\n");
  for (const f of ["package-lock.json", "cabinet/service/bin/cabinet-service.js", "cabinet/vm/guest/service-config.mjs", "studio-kit/spec/index.js"]) assert.ok(names.includes(f), f);
  assert.ok(!names.some((n) => n.startsWith("node_modules/")));
  assert.ok(!names.some((n) => n.includes("._")), "no macOS files");
  assert.ok(BUNDLE_PATHS.includes("cabinet/service"));
});

test("the provisioning tar holds the update script", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prov-"));
  const out = path.join(dir, "p.tgz");
  makeProvisionTar(REPO, out);
  const names = execFileSync("tar", ["-tzf", out], { encoding: "utf8" }).split("\n");
  for (const f of ["./provision.sh", "./update-on-cabinet.sh", "./lock.json", "./files/arcade-keyd"]) assert.ok(names.includes(f), f);
});

// update-on-cabinet.sh mustn't touch a key, a cart or a log, so it never names them for writing.
test("the update script never writes to the config, a cart or a log", () => {
  const s = fs.readFileSync(path.join(REPO, "cabinet/provision/update-on-cabinet.sh"), "utf8");
  for (const line of s.split("\n")) {
    if (/^\s*#/.test(line)) continue;
    assert.doesNotMatch(line, />\s*"?\$(CONFIG|DATA)/, line);
    assert.doesNotMatch(line, /rm .*\$(CONFIG|DATA)/, line);
  }
});

// The real daemon's logic, with its uinput device replaced, on a temp socket.
function keydStub() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keyd-"));
  const source = fs.readFileSync(path.join(REPO, "cabinet/provision/files/arcade-keyd"), "utf8");
  const harness = `${source.split('if __name__ == "__main__":')[0]}
LOG = ${JSON.stringify(path.join(dir, "keys.log"))}
presses = []
key = lambda fd, code, value: presses.append((code, value))
time.sleep = lambda s: None
done = {}
held = set()
def send(line):
    handle(0, held, line.split(), done)
send("id=one tap 60 44")
send("id=one tap 60 44")
send("id=two tap 60 44")
send("tap 60 45")
send("tap 60 45")
send("id=three seq 44:0 45:1")
send("id=three seq 44:0 45:1")
send("id=d down 44")
send("id=d down 44")
send("id=u up 44")
print(",".join(f"{c}:{v}" for c, v in presses))
print(sorted(held))
`;
  const file = path.join(dir, "h.py");
  fs.writeFileSync(file, harness);
  return { file, dir };
}

test("arcade-keyd: a repeated id presses nothing, and no id always presses", () => {
  const { file, dir } = keydStub();
  const out = execFileSync("python3", [file], { encoding: "utf8" }).trim().split("\n");
  const taps = "44:1,44:0";
  // one, once; two; the unnamed tap, twice; three, once (44 plain, then 45 with shift); down once; up.
  const seq = "44:1,44:0,42:1,45:1,45:0,42:0";
  assert.equal(out[0], `${taps},${taps},45:1,45:0,45:1,45:0,${seq},44:1,44:0`);
  assert.equal(out[1], "[]");
  const log = fs.readFileSync(path.join(dir, "keys.log"), "utf8").trim().split("\n");
  assert.equal(log.filter((l) => / one tap /.test(l)).length, 1, "the log shows one pressed once");
  assert.equal(log.filter((l) => / one ALREADY-DONE/.test(l)).length, 1, "and the repeat as a repeat");
});

// drive itself: SSH failing after the command ran is the case where a key's outcome is unknown (D195).
// The stand-in ssh keeps the daemon's rule (an id it has done is a repeat), and every first try runs, then fails as SSH.
const STUB = "#!/bin/bash\nfor a in \"$@\"; do case \"$a\" in id=*) id=\"${a#id=}\" ;; esac; done\n[ -n \"$id\" ] || exit 9\nif grep -qx \"$id\" \"DIR/done\" 2>/dev/null; then echo \"$id repeat\" >> \"DIR/log\"; exit 0; fi\necho \"$id\" >> \"DIR/done\"; echo \"$id pressed\" >> \"DIR/log\"\nexit 255\n";

test("drive: when SSH fails after a key landed, it asks again by id, and nothing is pressed twice", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drive-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "ssh"), STUB.replaceAll("DIR", dir), { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GSA_VM_DIR: dir, ARCADE_HOST: "stand-in", ARCADE_RIDE_S: "30" };
  for (const args of [["press", "a"], ["hold", "left", "500"], ["type", "Hi!"], ["down", "a"], ["up", "a"]]) {
    execFileSync(path.join(REPO, "cabinet/vm/drive"), args, { env, stdio: "ignore" });
  }
  const log = fs.readFileSync(path.join(dir, "log"), "utf8").trim().split("\n");
  assert.equal(log.filter((l) => l.endsWith("pressed")).length, 5, "each key pressed once");
  assert.equal(log.filter((l) => l.endsWith("repeat")).length, 5, "each asked again after SSH failed, and recognised");
  const ids = log.filter((l) => l.endsWith("pressed")).map((l) => l.split(" ")[0]);
  assert.equal(new Set(ids).size, 5, "a fresh id for each key");
});

test("drive: gives up after ARCADE_RIDE_S, exit 255, if the cabinet never answers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drive-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "ssh"), "#!/bin/bash\nexit 255\n", { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GSA_VM_DIR: dir, ARCADE_HOST: "stand-in", ARCADE_RIDE_S: "4" };
  let code = 0;
  try {
    execFileSync(path.join(REPO, "cabinet/vm/drive"), ["press", "a"], { env, stdio: "ignore" });
  } catch (e) {
    code = e.status;
  }
  assert.equal(code, 255);
});
