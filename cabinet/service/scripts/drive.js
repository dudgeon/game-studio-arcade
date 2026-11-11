#!/usr/bin/env node
// Drives the launcher by script in headless Chromium, with no window (D186), with
// the same verbs and D82 key names as cabinet/vm/drive:
//
//   press KEY [MS]        tap a key (default 60 ms)
//   hold KEY MS           hold it for MS, as hold-to-talk does
//   down KEY / up KEY     press and keep held / let go
//   type TEXT             type on the typing screen
//   say TEXT              feed the speech stub the next thing "heard" (D184)
//   wait SCREEN [PHASE]   wait until that screen is up (and that say phase)
//   sleep MS              wait
//   shot NAME             a 1024x768 PNG, with the fit report beside it
//   # …                   a comment
//
// Keys: up down left right a b x y q e start enter esc star f1 f2 (D82).
//
//   node scripts/drive.js --script scripts/flows/penguin.drive --out DIR --replay ../../studio-kit/cli/fixtures/penguin-catch
//   node scripts/drive.js --script FILE --out DIR --url http://127.0.0.1:8330    (a service already running)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** D82's keys, by the names cabinet/vm/drive uses, as KeyboardEvent.code. */
export const KEYS = {
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
  a: "KeyZ", b: "KeyX", x: "KeyC", y: "KeyV", q: "KeyQ", e: "KeyE",
  start: "Enter", enter: "Enter", esc: "Escape", star: "Escape", f1: "F1", f2: "F2",
};

/** @param {string} name */
const keyOf = (name) => {
  const k = KEYS[name];
  if (!k) throw new Error(`unknown key: ${name}`);
  return k;
};

/**
 * Start the real service in its own process, replaying. Resolves once it's listening.
 * @param {{ replay: string, data: string, pace?: number, port?: number, questionTimeout?: number }} o
 */
export function startServiceProcess(o) {
  const bin = path.join(HERE, "../bin/cabinet-service.js");
  const child = spawn(process.execPath, [bin, "--port", String(o.port ?? 0), "--guest-port", "0", "--data", o.data, "--replay", o.replay, "--pace", String(o.pace ?? 150), ...(o.questionTimeout ? ["--question-timeout", String(o.questionTimeout)] : [])], { stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  return new Promise((resolve, reject) => {
    child.on("exit", (c) => reject(new Error(`the service stopped (${c}): ${err}`)));
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      const m = /cabinet service on (http:\S+),/.exec(out);
      if (m) resolve({ url: m[1], stop: () => child.kill("SIGTERM"), kill: () => child.kill("SIGKILL"), stderr: () => err });
    });
  });
}

/** A headless browser at the cabinet's screen size; never a window. */
export async function openBrowser(url) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ headless: true, channel: "chrome" }));
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  /** @type {string[]} */
  const problems = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon/.test(m.text())) problems.push(`console error: ${m.text()}`);
  });
  await page.goto(url);
  await page.waitForFunction(() => /** @type {any} */ (window).launcher);
  return { browser, page, problems };
}

/** Parse a script: one step a line. @param {string} text */
export function parseScript(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const at = l.indexOf(" ");
      return at < 0 ? { verb: l, rest: "" } : { verb: l.slice(0, at), rest: l.slice(at + 1).trim() };
    });
}

/**
 * @param {{ page: any, url: string, steps: {verb: string, rest: string}[], out?: string, timeoutMs?: number, log?: (s: string) => void }} o
 * @returns {Promise<{ shots: {name: string, file: string|null, screen: string, boxes: any[]}[] }>}
 */
export async function runSteps(o) {
  const { page, url } = o;
  const log = o.log ?? (() => {});
  const timeout = o.timeoutMs ?? 180_000;
  /** @type {{name: string, file: string|null, screen: string, boxes: any[]}[]} */
  const shots = [];
  let n = 0;
  if (o.out) fs.mkdirSync(o.out, { recursive: true });
  for (const { verb, rest } of o.steps) {
    log(`${verb} ${rest}`);
    const args = rest.split(/\s+/);
    switch (verb) {
      case "press":
        await page.keyboard.down(keyOf(args[0]));
        await page.waitForTimeout(Number(args[1] ?? 60));
        await page.keyboard.up(keyOf(args[0]));
        await page.waitForTimeout(30);
        break;
      case "hold":
        await page.keyboard.down(keyOf(args[0]));
        await page.waitForTimeout(Number(args[1]));
        await page.keyboard.up(keyOf(args[0]));
        await page.waitForTimeout(30);
        break;
      case "down":
        await page.keyboard.down(keyOf(args[0]));
        await page.waitForTimeout(30);
        break;
      case "up":
        await page.keyboard.up(keyOf(args[0]));
        await page.waitForTimeout(30);
        break;
      case "type":
        await page.keyboard.type(rest, { delay: 5 });
        break;
      case "say": {
        const r = await fetch(`${url}/api/speech/feed`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: rest }) });
        if (!r.ok) throw new Error(`say: ${await r.text()}`);
        break;
      }
      case "wait":
        await page
          .waitForFunction(
            ([s, ph]) => {
              const l = /** @type {any} */ (window).launcher;
              return l.screen() === s && (!ph || l.phase() === ph);
            },
            [args[0], args[1] ?? null],
            { timeout },
          )
          .catch(async (/** @type {Error} */ e) => {
            const at = await page.evaluate(() => {
              const l = /** @type {any} */ (window).launcher;
              return `${l.screen()} ${l.phase() ?? ""} (Studio: ${l.studio().phase})`;
            });
            throw new Error(`"wait ${rest}" timed out on ${at}: ${e.message.split("\n")[0]}`);
          });
        await page.waitForTimeout(40); // one frame drawn on it
        break;
      case "sleep":
        await page.waitForTimeout(Number(args[0]));
        break;
      case "shot": {
        n++;
        const name = `${String(n).padStart(2, "0")}-${args[0]}`;
        const state = await page.evaluate(() => {
          const l = /** @type {any} */ (window).launcher;
          return { screen: l.screen(), boxes: l.boxes() };
        });
        let file = null;
        if (o.out) {
          file = path.join(o.out, `${name}.png`);
          await page.screenshot({ path: file });
          fs.writeFileSync(path.join(o.out, `${name}.fit.json`), JSON.stringify(state, null, 1) + "\n");
        }
        shots.push({ name, file, ...state });
        break;
      }
      default:
        throw new Error(`unknown step: ${verb}`);
    }
  }
  return { shots };
}

async function main() {
  const { values } = parseArgs({
    options: {
      script: { type: "string" },
      out: { type: "string" },
      replay: { type: "string" },
      url: { type: "string" },
      data: { type: "string" },
      pace: { type: "string", default: "150" },
    },
  });
  if (!values.script || (!values.replay && !values.url)) {
    console.error("usage: drive.js --script FILE --out DIR (--replay FIXTURE [--data DIR] [--pace MS] | --url URL)");
    return 2;
  }
  const steps = parseScript(fs.readFileSync(values.script, "utf8"));
  const data = values.data ?? fs.mkdtempSync(path.join(os.tmpdir(), "gsa-cabinet-"));
  const service = values.url ? null : await startServiceProcess({ replay: path.resolve(/** @type {string} */ (values.replay)), data, pace: Number(values.pace) });
  const url = values.url ?? /** @type {any} */ (service).url;
  const { browser, page, problems } = await openBrowser(url);
  let failed = false;
  try {
    const { shots } = await runSteps({ page, url, steps, out: values.out, log: (s) => console.log(`  ${s}`) });
    const faults = await page.evaluate(() => /** @type {any} */ (window).launcher.faults());
    const cut = shots.flatMap((s) => s.boxes.filter((b) => b.cut).map((b) => `${s.name} ${b.id}: "${b.lines.at(-1)?.text}"`));
    console.log(`\n${shots.length} shots${values.out ? ` in ${values.out}` : ""}. Data in ${data}.`);
    console.log(`Fit faults: ${faults.length}`);
    for (const f of faults) console.log(`  ${f}`);
    console.log(`Cut text (deliberate): ${cut.length}`);
    for (const c of cut) console.log(`  ${c}`);
    if (problems.length) console.log(`Page problems:\n  ${problems.join("\n  ")}`);
    failed = faults.length > 0 || problems.length > 0;
    if (values.out) fs.writeFileSync(path.join(values.out, "report.json"), JSON.stringify({ shots: shots.map((s) => s.name), faults, cut, problems }, null, 2) + "\n");
  } finally {
    await browser.close();
    service?.stop();
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      console.error(`drive: ${e?.message ?? e}`);
      process.exit(1);
    },
  );
}
