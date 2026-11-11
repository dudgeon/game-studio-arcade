#!/usr/bin/env node
// The family coin pot, from the Mac mini, until the Cabinet Manager exists (D215).
// A grown-up adds coins or resets the pot, with a reason the kids see in the coin history (A2).
//
//   node scripts/coin.mjs pair                    make the cabinet's Manager token (once) and keep it here
//   node scripts/coin.mjs show                    the pot, this month's makers, the last entries
//   node scripts/coin.mjs add N "reason" [--yes]  add N coins; past the workspace limit it asks for --yes
//   node scripts/coin.mjs reset "reason"          set the pot back to 100
//
// It uses the cabinet's own token-gated endpoints (D208), through the cabinet's SSH (cabinet/vm/drive,
// which finds the private link, D241). The token lives on the cabinet in /etc/arcade/manager-token and here
// in ~/.config/game-studio-arcade/manager-token, both 0600. It only ever travels on stdin: never in a
// command line, a log or this repo. ARCADE_HOST picks the cabinet, as for drive.
//
//   --url URL --token-file F    talk to a service directly instead (tests, or a service on this machine)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRIVE = path.join(REPO, "cabinet/vm/drive");
export const TOKEN_HOME = path.join(os.homedir(), ".config", "game-studio-arcade", "manager-token");
const CABINET_TOKEN = "/etc/arcade/manager-token";

/** Runs on the cabinet: one request to its own service, all of it read from stdin. */
const REMOTE = `let s="";process.stdin.on("data",d=>s+=d).on("end",async()=>{const q=JSON.parse(s);try{const r=await fetch("http://127.0.0.1:8330"+q.path,{method:q.method,headers:{"Content-Type":"application/json",Authorization:"Bearer "+q.token},body:q.body});process.stdout.write(JSON.stringify({status:r.status,body:await r.text()}))}catch(e){process.stdout.write(JSON.stringify({status:0,body:String(e.message)}))}})`;

/** @param {string} command @param {string} [input] */
function onCabinet(command, input) {
  const r = spawnSync(DRIVE, ["ssh", command], { input, encoding: "utf8", env: { ...process.env, ARCADE_SSH_TIMEOUT_S: "60" }, maxBuffer: 2 ** 24 });
  if (r.status === 255) throw new Error("can't reach the cabinet over SSH. Is it up? (scripts/virtual-cabinet/vm-state.sh)");
  return r;
}

/**
 * One request to the Manager endpoints, here or on the cabinet.
 * @param {{ url?: string, token: string }} at @param {"GET" | "POST"} method @param {string} p @param {object} [body]
 * @returns {Promise<{ status: number, body: any }>}
 */
export async function request(at, method, p, body) {
  let status;
  let text;
  if (at.url) {
    const r = await fetch(`${at.url}${p}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${at.token}` }, body: body ? JSON.stringify(body) : undefined });
    status = r.status;
    text = await r.text();
  } else {
    const r = onCabinet(`node -e '${REMOTE}'`, JSON.stringify({ method, path: p, token: at.token, body: body ? JSON.stringify(body) : undefined }));
    if (r.status !== 0) throw new Error(`the cabinet's helper failed: ${(r.stderr || "").trim().split("\n").at(-1)}`);
    ({ status, body: text } = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "{}"));
  }
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {}
  return { status, body: parsed };
}

/** @param {string} file */
export function readToken(file) {
  if (!fs.existsSync(file)) throw new Error(`no Manager token at ${file}. Run: node scripts/coin.mjs pair`);
  const st = fs.statSync(file);
  if (st.mode & 0o077) throw new Error(`${file} can be read by others (mode ${(st.mode & 0o777).toString(8)}); chmod 600 it`);
  return fs.readFileSync(file, "utf8").trim();
}

/** Make the cabinet's token if it has none, and keep a copy here. The token is never printed. */
function pair() {
  const make = `sudo sh -c 'if [ ! -s ${CABINET_TOKEN} ]; then umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d " \\n" > ${CABINET_TOKEN}; chown arcade:arcade ${CABINET_TOKEN}; chmod 600 ${CABINET_TOKEN}; fi; cat ${CABINET_TOKEN}'`;
  const r = onCabinet(make);
  const token = (r.stdout || "").trim().split("\n").at(-1) ?? "";
  if (r.status !== 0 || !/^[0-9a-f]{64}$/.test(token)) throw new Error("the cabinet didn't make a token");
  fs.mkdirSync(path.dirname(TOKEN_HOME), { recursive: true, mode: 0o700 });
  fs.writeFileSync(TOKEN_HOME, `${token}\n`, { mode: 0o600 });
  fs.chmodSync(TOKEN_HOME, 0o600);
  return TOKEN_HOME;
}

const coins = (/** @type {number} */ cents) => Math.sign(cents) * Math.round(Math.abs(cents) / 10);
const dollars = (/** @type {number} */ cents) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

/** The pot, as text. @param {any} v */
export function describe(v) {
  const p = v.pot;
  const lines = [`Pot: ${p.coins} coins (${dollars(p.cents)}) of ${p.full_coins}. Fills back up on ${p.refill_on}.`];
  lines.push(`This month: ${dollars(p.spent_cents)} spent${p.added_cents ? `, ${dollars(p.added_cents)} added by grown-ups` : ""}.`);
  for (const m of p.makers) lines.push(`  ${m.name}: ${m.coins} coins (${dollars(m.cents)}), ${m.makes} make${m.makes === 1 ? "" : "s"}`);
  lines.push("Latest:");
  for (const e of v.history.slice(0, 8)) {
    const who = e.kind === "charge" ? (e.name ?? e.who) : e.kind === "refill" ? "the 1st" : `a grown-up${e.by ? ` (${e.by})` : ""}`;
    const what = e.kind === "charge" ? `${e.what}, ${e.cost_cents}c, ${e.outcome}` : e.kind === "topup" ? `added ${coins(e.cents)} coins: "${e.reason}"` : e.kind === "reset" ? `reset to 100: "${e.reason}"` : "refilled to 100";
    lines.push(`  ${e.at.slice(0, 16).replace("T", " ")}  ${who}: ${what}  (pot ${coins(e.pot_after_cents)})`);
  }
  return lines.join("\n");
}

/** @param {string[]} argv @param {{ log?: (s: string) => void }} [io] */
export async function main(argv, io = {}) {
  const log = io.log ?? ((/** @type {string} */ s) => console.log(s));
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { url: { type: "string" }, "token-file": { type: "string" }, yes: { type: "boolean", default: false }, by: { type: "string" } } });
  const [cmd, ...rest] = positionals;
  if (cmd === "pair") {
    if (values.url) throw new Error("pair works on the cabinet, not --url");
    log(`Paired: the token is in ${pair()} (0600) and on the cabinet in ${CABINET_TOKEN}.`);
    return 0;
  }
  const at = { url: values.url, token: readToken(values["token-file"] ?? TOKEN_HOME) };
  const by = values.by ?? os.userInfo().username;
  const check = (/** @type {{status: number, body: any}} */ r) => {
    if (r.status === 200) return r.body;
    throw new Error(`the cabinet said ${r.status}: ${typeof r.body === "object" ? r.body.error : r.body}`);
  };
  if (cmd === "show" || !cmd) {
    log(describe(check(await request(at, "GET", "/api/manager/pot"))));
    return 0;
  }
  if (cmd === "add") {
    const n = Number(rest[0]);
    const reason = rest.slice(1).join(" ").trim();
    if (!Number.isInteger(n) || n < 1) throw new Error('add needs a whole number of coins: add 20 "Birthday bonus"');
    if (!reason) throw new Error('add needs a reason, which the kids see: add 20 "Birthday bonus"');
    const preview = check(await request(at, "GET", `/api/manager/pot/preview?coins=${n}`));
    if (preview.over_limit && !values.yes) {
      log(`Careful: with ${n} more coins this month could spend ${dollars(preview.month_total_cents)}, past the workspace's real limit of ${dollars(preview.workspace_limit_cents)} (D204, D211). A make that hits it stops, and the Studio rests until the 1st. Run it again with --yes to add them anyway.`);
      return 3;
    }
    const r = check(await request(at, "POST", "/api/manager/pot/topup", { coins: n, reason, by }));
    log(`Added ${n} coin${n === 1 ? "" : "s"} (${dollars(n * 10)}): "${reason}". The pot now has ${coins(r.entry.pot_after_cents)} coins.`);
    return 0;
  }
  if (cmd === "reset") {
    const reason = rest.join(" ").trim();
    if (!reason) throw new Error('reset needs a reason, which the kids see: reset "Fresh start"');
    const r = check(await request(at, "POST", "/api/manager/pot/reset", { reason, by }));
    log(`Reset the pot to ${coins(r.entry.pot_after_cents)} coins: "${reason}".`);
    return 0;
  }
  throw new Error(`unknown command ${cmd}: pair, show, add N "reason", reset "reason"`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e) => {
      console.error(`coin: ${e.message}`);
      process.exit(1);
    },
  );
}
