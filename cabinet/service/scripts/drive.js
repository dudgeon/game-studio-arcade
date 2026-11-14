#!/usr/bin/env node
// Drives the launcher by script in headless Chromium, with no window (D186), with
// the same verbs and D82 key names as cabinet/vm/drive:
//
//   press KEY [MS]        tap a key (default 60 ms)
//   hold KEY MS           hold it for MS, as hold-to-talk does
//   down KEY / up KEY     press and keep held / let go
//   type TEXT             type on the typing screen
//   say TEXT              feed the speech stub the next thing "heard" (D184)
//   wait SCREEN [PHASE]   wait until that screen or board (M3, A1...) is up (and that say phase)
//   restart [MS]          stop the service hard, wait MS (400), start it again on the same data (D189, D191)
//   manager topup N WHY   a grown-up adds N coins in the Manager, with a reason (D205)
//   manager reset WHY
//   #! ARGS               (a script's first lines) more flags for the service it starts, e.g. #! --replay-cost 140
//   #seed FILE            (the same) a JSON file of what the data folder holds first: ledger, makers, state
//   sleep MS              wait
//   shot NAME             a 1024x768 PNG, with the fit report beside it
//   # …                   a comment
//
// Keys: up down left right a b x y q e start enter esc star f1 f2 (D82), and ent: the Picade's ENT, F13 (D433).
//
//   node scripts/drive.js --script scripts/flows/penguin.drive --out DIR --replay ../../studio-kit/cli/fixtures/penguin-catch
//   node scripts/drive.js --script FILE --out DIR --url http://127.0.0.1:8330    (a service already running)
//   ... --url URL --cdp http://127.0.0.1:9222 --restart-cmd CMD
//        a Chromium somewhere else, over its DevTools port (the virtual cabinet's own, through an SSH
//        tunnel: cabinet/vm/replay-boards.sh); `restart` runs CMD, which restarts that service
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
  start: "Enter", enter: "Enter", esc: "Escape", star: "Escape", f1: "F1", ent: "F13", f2: "F2", coin: "F2",
};

/** @param {string} name */
const keyOf = (name) => {
  const k = KEYS[name];
  if (!k) throw new Error(`unknown key: ${name}`);
  return k;
};

/**
 * A key goes down or up. Playwright's keyboard has no F13 (the Picade's ENT, D433), so the page gets that one
 * as the same event from a script.
 * @param {any} page @param {"keydown" | "keyup"} type @param {string} code
 */
const key = (page, type, code) => {
  if (code !== "F13") return type === "keydown" ? page.keyboard.down(code) : page.keyboard.up(code);
  return page.evaluate(([t, c]) => void dispatchEvent(new KeyboardEvent(t, { code: c, key: c, cancelable: true, bubbles: true })), [type, code]);
};

/**
 * Start the real service in its own process, replaying. Resolves once it's listening.
 * @param {{ replay: string, data: string, pace?: number, port?: number, questionTimeout?: number, args?: string[] }} o
 */
export function startServiceProcess(o) {
  const bin = path.join(HERE, "../bin/cabinet-service.js");
  const child = spawn(process.execPath, [bin, "--port", String(o.port ?? 0), "--guest-port", "0", "--data", o.data, "--replay", o.replay, "--pace", String(o.pace ?? 150), ...(o.questionTimeout ? ["--question-timeout", String(o.questionTimeout)] : []), ...(o.args ?? [])], { stdio: ["ignore", "pipe", "pipe"] });
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

/** A headless browser at the cabinet's screen size; never a window. With `cdp`, one already running there. @param {string} url @param {string} [cdp] */
export async function openBrowser(url, cdp) {
  const { chromium } = await import("playwright");
  const browser = cdp ? await chromium.connectOverCDP(cdp) : await chromium.launch({ headless: true }).catch(() => chromium.launch({ headless: true, channel: "chrome" }));
  const context = cdp ? await browser.newContext({ viewport: { width: 1024, height: 768 } }) : null;
  const page = context ? await context.newPage() : await browser.newPage({ viewport: { width: 1024, height: 768 } });
  /** @type {string[]} */
  const problems = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => {
    // A failed load is reported below with its URL; the console's copy doesn't name it.
    if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) problems.push(`console error: ${m.text()}`);
  });
  page.on("response", (/** @type {any} */ r) => {
    if (r.status() >= 400 && !/favicon\.ico$/.test(r.url())) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  await page.goto(url);
  await page.waitForFunction(() => /** @type {any} */ (window).launcher);
  return { browser, page, problems };
}

/** A script's own service flags and seed: its "#! ..." and "#seed FILE" lines. @param {string} text */
export function scriptSetup(text) {
  /** @type {string[]} */
  const args = [];
  let seed = null;
  for (const l of text.split("\n").map((x) => x.trim())) {
    if (l.startsWith("#!")) args.push(...l.slice(2).trim().split(/\s+/).filter(Boolean));
    else if (l.startsWith("#seed ")) seed = l.slice(6).trim();
  }
  return { args, seed };
}

/**
 * Lay a seed down in a fresh data folder: a pot partly spent, last month's makes,
 * the first boot already seen. Times are relative to now, so a seed never goes stale.
 * Ledger lines are written as the pot would write them, in order.
 * @param {string} data @param {any} seed
 */
export function plantSeed(data, seed) {
  const logs = path.join(data, "logs");
  fs.mkdirSync(logs, { recursive: true });
  const now = new Date();
  const month = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 10, 12);
  let pot = 0;
  let n = 0;
  const lines = [];
  for (const e of seed.ledger ?? []) {
    const at = e.last_month ? new Date(lastMonth.getTime() + n * 3600_000) : new Date(now.getTime() - (100 - n) * 60_000);
    n++;
    const before = pot;
    const delta = e.kind === "refill" || e.kind === "reset" ? 1000 - pot : e.kind === "charge" ? -e.cost_cents : e.cents;
    pot += delta;
    lines.push({ type: "coin_ledger", id: `pot_seed${n}`, at: at.toISOString(), month: month(at), kind: e.kind, who: e.who ?? (e.kind === "charge" ? "owen" : e.kind === "refill" ? "cabinet" : "grown-up"), what: e.what ?? (e.kind === "charge" ? "new game" : e.kind), cart_id: e.cart_id ?? null, cart_version: null, session_id: e.kind === "charge" ? `sesn_seed${n}` : null, cents: delta, cost_cents: e.cost_cents ?? null, coins: Math.sign(e.cost_cents ?? delta) * Math.round(Math.abs(e.cost_cents ?? delta) / 10), outcome: e.outcome ?? (e.kind === "charge" ? "on the shelf" : null), reason: e.reason ?? null, pot_before_cents: before, pot_after_cents: pot });
  }
  if (lines.length) fs.writeFileSync(path.join(logs, "coin_ledger.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  if (seed.makers) fs.writeFileSync(path.join(data, "makers.json"), JSON.stringify(seed.makers.map((/** @type {string} */ name, /** @type {number} */ i) => ({ id: name.toLowerCase(), name, added: new Date(now.getTime() - (10 - i) * 86400_000).toISOString(), guest: true })), null, 2));
  const state = seed.state === "first-boot" ? {} : seed.state === "new-month" ? { intro_seen_at: lastMonth.toISOString(), month_seen: month(lastMonth) } : { intro_seen_at: now.toISOString(), month_seen: month(now) };
  fs.writeFileSync(path.join(data, "cabinet-state.json"), JSON.stringify(state));
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
 * @param {{ page: any, url: string, steps: {verb: string, rest: string}[], out?: string, timeoutMs?: number, log?: (s: string) => void, restart?: (downMs: number) => Promise<string>, managerToken?: string }} o
 * @returns {Promise<{ shots: {name: string, file: string|null, screen: string, boxes: any[]}[] }>}
 */
export async function runSteps(o) {
  const { page } = o;
  let url = o.url;
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
        await key(page, "keydown", keyOf(args[0]));
        await page.waitForTimeout(Number(args[1] ?? 60));
        await key(page, "keyup", keyOf(args[0]));
        await page.waitForTimeout(30);
        break;
      case "hold":
        await key(page, "keydown", keyOf(args[0]));
        await page.waitForTimeout(Number(args[1]));
        await key(page, "keyup", keyOf(args[0]));
        await page.waitForTimeout(30);
        break;
      case "down":
        await key(page, "keydown", keyOf(args[0]));
        await page.waitForTimeout(30);
        break;
      case "up":
        await key(page, "keyup", keyOf(args[0]));
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
              return (l.screen() === s || l.board?.() === s) && (!ph || l.phase() === ph);
            },
            [args[0], args[1] ?? null],
            { timeout },
          )
          .catch(async (/** @type {Error} */ e) => {
            const at = await page.evaluate(() => {
              const l = /** @type {any} */ (window).launcher;
              return `${l.screen()} ${l.board?.() ?? ""} ${l.phase() ?? ""} (Studio: ${l.studio().phase})`;
            });
            throw new Error(`"wait ${rest}" timed out on ${at}: ${e.message.split("\n")[0]}`);
          });
        await page.waitForTimeout(40); // one frame drawn on it
        break;
      case "restart": {
        if (!o.restart) throw new Error("restart: only for a service drive.js started");
        url = await o.restart(Number(args[0] || 400));
        break;
      }
      case "manager": {
        const [what, ...more] = args;
        const body = what === "topup" ? { coins: Number(more[0]), reason: more.slice(1).join(" "), by: "a grown-up" } : { reason: more.join(" "), by: "a grown-up" };
        const r = await fetch(`${url}/api/manager/pot/${what}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${o.managerToken ?? ""}` }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error(`manager ${what}: ${await r.text()}`);
        break;
      }
      case "sleep":
        await page.waitForTimeout(Number(args[0]));
        break;
      case "shot": {
        n++;
        const name = `${String(n).padStart(2, "0")}-${args[0]}`;
        const state = await page.evaluate(() => {
          const l = /** @type {any} */ (window).launcher;
          return { screen: l.screen(), board: l.board?.() ?? l.screen(), boxes: l.boxes() };
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
      port: { type: "string" },
      cdp: { type: "string" },
      "restart-cmd": { type: "string" },
    },
  });
  if (!values.script || (!values.replay && !values.url)) {
    console.error("usage: drive.js --script FILE --out DIR (--replay FIXTURE [--data DIR] [--pace MS] | --url URL)");
    return 2;
  }
  const text = fs.readFileSync(values.script, "utf8");
  const steps = parseScript(text);
  const setup = scriptSetup(text);
  const data = values.data ?? fs.mkdtempSync(path.join(os.tmpdir(), "gsa-cabinet-"));
  if (setup.seed && !values.url) plantSeed(data, JSON.parse(fs.readFileSync(path.resolve(path.dirname(values.script), setup.seed), "utf8")));
  const managerToken = "drive-manager-token";
  const startOpts = { replay: path.resolve(/** @type {string} */ (values.replay ?? "")), data, pace: Number(values.pace), port: values.port ? Number(values.port) : 0, args: [...setup.args, "--manager-token", managerToken] };
  /** @type {any} */
  let service = values.url ? null : await startServiceProcess(startOpts);
  const url = values.url ?? service.url;
  const { browser, page, problems } = await openBrowser(url, values.cdp);
  // The same port again, so the page's own reconnect finds it (D189).
  const port = values.url ? 0 : Number(new URL(url).port);
  let restarted = false;
  const restart = async (/** @type {number} */ downMs) => {
    restarted = true;
    if (values["restart-cmd"]) {
      const { execSync } = await import("node:child_process");
      execSync(values["restart-cmd"], { stdio: "inherit", env: { ...process.env, DOWN_MS: String(downMs) } });
      return url;
    }
    service.kill();
    await new Promise((r) => setTimeout(r, downMs));
    service = await startServiceProcess({ ...startOpts, port });
    return service.url;
  };
  let failed = false;
  try {
    const { shots } = await runSteps({ page, url, steps, out: values.out, log: (s) => console.log(`  ${s}`), restart, managerToken: values.url ? process.env.GSA_MANAGER_TOKEN : managerToken });
    const faults = await page.evaluate(() => /** @type {any} */ (window).launcher.faults());
    const cut = shots.flatMap((s) => s.boxes.filter((b) => b.cut).map((b) => `${s.name} ${b.id}: "${b.lines.at(-1)?.text}"`));
    console.log(`\n${shots.length} shots${values.out ? ` in ${values.out}` : ""}. Data in ${data}.`);
    console.log(`Fit faults: ${faults.length}`);
    for (const f of faults) console.log(`  ${f}`);
    console.log(`Cut text (deliberate): ${cut.length}`);
    for (const c of cut) console.log(`  ${c}`);
    // A restart the script asked for drops the page's connections; that's the point, not a problem.
    if (restarted) problems.splice(0, problems.length, ...problems.filter((p) => !/ERR_CONNECTION_REFUSED|ERR_INCOMPLETE_CHUNKED_ENCODING|ERR_EMPTY_RESPONSE/.test(p)));
    if (problems.length) console.log(`Page problems:\n  ${problems.join("\n  ")}`);
    failed = faults.length > 0 || problems.length > 0;
    const boards = await page.evaluate(() => /** @type {any} */ (window).launcher.boards());
    console.log(`Boards: ${boards.join(" ")}`);
    if (values.out) fs.writeFileSync(path.join(values.out, "report.json"), JSON.stringify({ shots: shots.map((s) => ({ name: s.name, board: /** @type {any} */ (s).board })), boards, faults, cut, problems }, null, 2) + "\n");
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
