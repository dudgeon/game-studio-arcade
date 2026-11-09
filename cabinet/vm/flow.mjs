#!/usr/bin/env node
// Runs a .drive script on the virtual cabinet's own screens, from the mini, with no window (D154).
// Same verbs as cabinet/service/scripts/drive.js, which drives a headless browser. Here the keys
// go through uinput and the shots come from the compositor, so this is what a kid would see.
//
//   node cabinet/vm/flow.mjs --script FILE --out DIR
//
// One more verb here: `expect TEXT` fails unless TEXT is in a text box on screen now.
// Exit 0 only if every step worked with no fit faults and no page errors.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRIVE = path.join(HERE, "drive");
const GUEST = "/opt/arcade/current/cabinet/vm/guest/launcher.mjs";
const SETTLE_MS = 150; // a key's frame reaches the screen before the next step looks at it

const { values } = parseArgs({ options: { script: { type: "string" }, out: { type: "string" } } });
if (!values.script || !values.out) {
  console.error("usage: flow.mjs --script FILE --out DIR");
  process.exit(2);
}

const VM_ROOT = process.env.GSA_VM_DIR || path.join(os.homedir(), "game-studio-data/vm");
const hostFile = path.join(VM_ROOT, "host");
const HOST = process.env.ARCADE_HOST || (fs.existsSync(hostFile) ? fs.readFileSync(hostFile, "utf8").trim() : "arcade-virtual.local");
// One SSH connection for the whole flow, so a key takes milliseconds, not a new handshake.
const CONTROL = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "flow-")), "c");
const env = { ...process.env, ARCADE_HOST: HOST, ARCADE_SSH_CONTROL: CONTROL };
const sshArgs = ["-4", "-i", path.join(VM_ROOT, "ssh/arcade-virtual_ed25519"), "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", `UserKnownHostsFile=${path.join(VM_ROOT, "ssh/known_hosts")}`, "-o", "StrictHostKeyChecking=accept-new", "-S", CONTROL];
const target = `cabinet@${HOST}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const drive = (...a) => run(DRIVE, a, { env, maxBuffer: 2 ** 26 });
const guest = (...a) => run("ssh", [...sshArgs, target, "sudo", "-u", "arcade", "node", GUEST, ...a], { maxBuffer: 2 ** 26 });

async function state() {
  return JSON.parse((await guest("state")).stdout);
}

function parseScript(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [verb, ...args] = l.split(/\s+/);
      return { verb, args, rest: l.slice(verb.length).trim(), line: l };
    });
}

async function step(s, out, shots) {
  const { verb, args, rest } = s;
  switch (verb) {
    case "press":
      await drive("press", args[0], args[1] ?? "60");
      await sleep(30);
      return;
    case "hold":
      await drive("hold", args[0], args[1]);
      await sleep(30);
      return;
    case "down":
    case "up":
      await drive(verb, args[0]);
      await sleep(30);
      return;
    case "type":
      await drive("type", rest);
      return;
    case "say": {
      const child = spawn("ssh", [...sshArgs, target, "sudo", "-u", "arcade", "node", GUEST, "say"], { stdio: ["pipe", "ignore", "inherit"] });
      child.stdin.end(rest);
      const code = await new Promise((r) => child.on("close", r));
      if (code !== 0) throw new Error("say failed");
      return;
    }
    case "wait":
      await guest("wait", args[0], args[1] ?? "-");
      await sleep(SETTLE_MS);
      return;
    case "sleep":
      await sleep(Number(args[0]));
      return;
    case "expect": {
      await sleep(SETTLE_MS);
      const st = await state();
      const words = st.boxes.flatMap((b) => b.lines.map((l) => l.text)).join(" ");
      // Long text wraps across lines, so spaces don't count.
      const flat = (t) => t.replace(/\s+/g, "");
      if (!flat(words).includes(flat(rest))) throw new Error(`expected "${rest}" on screen; ${st.screen} shows: ${words}`);
      return;
    }
    case "shot": {
      await sleep(SETTLE_MS);
      const name = `${String(shots.length + 1).padStart(2, "0")}-${args[0]}`;
      await drive("screenshot", path.join(out, `${name}.png`));
      const st = await state();
      fs.writeFileSync(path.join(out, `${name}.fit.json`), `${JSON.stringify({ screen: st.screen, boxes: st.boxes }, null, 1)}\n`);
      shots.push({ name, screen: st.screen, boxes: st.boxes });
      return;
    }
    default:
      throw new Error(`unknown step: ${verb}`);
  }
}

async function main() {
  const steps = parseScript(fs.readFileSync(values.script, "utf8"));
  fs.mkdirSync(values.out, { recursive: true });
  await run("ssh", [...sshArgs, "-M", "-N", "-f", target], { timeout: 20000 }).catch((e) => {
    throw new Error(`can't reach the cabinet at ${HOST}: ${e.message}`);
  });
  const errors = [];
  const watcher = spawn("ssh", [...sshArgs, target, "sudo", "-u", "arcade", "node", GUEST, "errors"], { stdio: ["ignore", "pipe", "ignore"] });
  watcher.stdout.on("data", (d) => errors.push(...d.toString().split("\n").filter(Boolean)));
  await sleep(800);

  const shots = [];
  let failed = null;
  const start = Date.now();
  for (const s of steps) {
    try {
      await step(s, values.out, shots);
      console.log(`  ok   ${s.line.slice(0, 90)}`);
    } catch (e) {
      failed = `"${s.line}": ${String(e.stderr || e.message).trim().slice(0, 400)}`;
      console.log(`  FAIL ${s.line.slice(0, 90)}`);
      break;
    }
  }
  const end = await state().catch(() => null);
  const faults = end?.faults ?? ["could not read the launcher at the end"];
  const cut = shots.flatMap((s) => s.boxes.filter((b) => b.cut).map((b) => `${s.name} ${b.id}: "${b.lines.at(-1)?.text}"`));
  watcher.kill();
  await run("ssh", [...sshArgs, "-O", "exit", target]).catch(() => {});

  console.log(`\n${shots.length} shots in ${values.out}, ${((Date.now() - start) / 1000).toFixed(0)} s.`);
  console.log(`Fit faults: ${faults.length}`);
  faults.forEach((f) => console.log(`  ${f}`));
  console.log(`Cut text (deliberate): ${cut.length}`);
  cut.forEach((c) => console.log(`  ${c}`));
  console.log(`Page errors: ${errors.length}`);
  errors.forEach((e) => console.log(`  ${e}`));
  if (failed) console.log(`Stopped at ${failed}`);
  fs.writeFileSync(path.join(values.out, "report.json"), `${JSON.stringify({ host: "virtual", shots: shots.map((s) => s.name), faults, cut, errors, failed }, null, 1)}\n`);
  return failed || faults.length || errors.length ? 1 : 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(`flow: ${e.message}`);
    process.exit(1);
  },
);
