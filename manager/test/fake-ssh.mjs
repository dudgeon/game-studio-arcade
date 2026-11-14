#!/usr/bin/env node
// A stand-in for ssh in the Manager's tests (D369): a cabinet on this machine. Put it first on PATH as "ssh".
//   -M ... -L 127.0.0.1:P:127.0.0.1:8330   the held connection: forwards P to FAKE_SERVICE_PORT, until killed
//   -O check                               answers whether the held connection is up
//   anything else                          runs the command here with bash, the cabinet's folders under FAKE_ROOT,
//                                          and sudo, arcade-screenshot and arcade-keyd as stand-ins
// Every call's arguments are appended to FAKE_SSH_LOG as one JSON line.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_SSH_LOG ?? "/dev/null", JSON.stringify(args) + "\n");
const WITH_VALUE = new Set(["-i", "-o", "-S", "-L", "-O", "-p", "-l"]);
/** @type {Record<string, string[]>} */
const opts = {};
const rest = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (WITH_VALUE.has(a)) (opts[a] ??= []).push(args[++i]);
  else if (a.startsWith("-") && rest.length === 0) (opts[a] ??= []).push("");
  else rest.push(a);
}
const control = opts["-S"]?.[0] ?? "/tmp/fake-ssh-control";
const up = `${control}.up`;

if (opts["-O"]?.[0] === "check") process.exit(fs.existsSync(up) ? 0 : 255);
if (opts["-O"]?.[0] === "exit") {
  fs.rmSync(up, { force: true });
  process.exit(0);
}
if (opts["-M"]) {
  if (process.env.FAKE_SSH_UNREACHABLE) {
    console.error("ssh: connect to host arcade.local port 22: No route to host");
    process.exit(255);
  }
  const fwd = opts["-L"]?.[0];
  const servers = [];
  if (fwd) {
    const [, port] = fwd.split(":");
    const s = net.createServer((c) => {
      const t = net.connect(Number(process.env.FAKE_SERVICE_PORT), "127.0.0.1");
      c.pipe(t).pipe(c);
      c.on("error", () => t.destroy());
      t.on("error", () => c.destroy());
    });
    s.listen(Number(port), "127.0.0.1");
    servers.push(s);
  }
  fs.writeFileSync(up, String(process.pid));
  const bye = () => {
    fs.rmSync(up, { force: true });
    process.exit(0);
  };
  process.on("SIGTERM", bye);
  process.on("SIGINT", bye);
  setInterval(() => {}, 1 << 30);
} else {
  const root = process.env.FAKE_ROOT ?? "/tmp/fake-cabinet";
  const command = (rest.slice(1).join(" ") || "true").replaceAll("/var/lib/arcade", path.join(root, "var/lib/arcade")).replaceAll("/etc/arcade", path.join(root, "etc/arcade")).replaceAll("/run/arcade", path.join(root, "run/arcade"));
  const shims = path.join(root, "shims");
  const child = spawn("bash", ["-c", command], { stdio: ["pipe", "inherit", "inherit"], env: { ...process.env, PATH: `${shims}:${process.env.PATH}` } });
  process.stdin.pipe(child.stdin);
  child.on("exit", (code) => process.exit(code ?? 1));
}
