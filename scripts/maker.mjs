#!/usr/bin/env node
// Grown-up makers on the cabinet, from the Mac mini (D236), in the style of coin.mjs.
// A grown-up maker is someone like Geoff who makes a version of a game on the mini: the cabinet's logs
// name them, but the kids' "who's making" list (M1) doesn't offer them. Only this command adds one;
// the cabinet service never writes makers.json on its own, so an update's data check stays exact (D196).
//
//   node scripts/maker.mjs list                   every maker on the cabinet, grown-ups marked
//   node scripts/maker.mjs add-grown-up NAME      add NAME as a grown-up maker; one already there is left as is
//
// It uses the cabinet's token-gated Manager endpoints (D208) through the cabinet's SSH, with the token
// coin.mjs pairs (node scripts/coin.mjs pair). ARCADE_HOST picks the cabinet, as for drive.
//
//   --url URL --token-file F    talk to a service directly instead (tests, or a service on this machine)
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { TOKEN_HOME, readToken, request } from "./coin.mjs";

/** @param {any[]} makers */
export function describe(makers) {
  if (!makers.length) return "No makers yet.";
  return makers.map((m) => `  ${m.name} (${m.id})${m.grown_up ? ", grown-up" : m.guest ? ", added at the cabinet" : ""}${m.hidden ? ", hidden" : ""}`).join("\n");
}

/** @param {string[]} argv @param {{ log?: (s: string) => void }} [io] */
export async function main(argv, io = {}) {
  const log = io.log ?? ((/** @type {string} */ s) => console.log(s));
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { url: { type: "string" }, "token-file": { type: "string" } } });
  const [cmd, ...rest] = positionals;
  const at = { url: values.url, token: readToken(values["token-file"] ?? TOKEN_HOME) };
  const check = (/** @type {{status: number, body: any}} */ r) => {
    if (r.status === 200) return r.body;
    throw new Error(`the cabinet said ${r.status}: ${typeof r.body === "object" ? r.body.error : r.body}`);
  };
  if (cmd === "list" || !cmd) {
    log(describe(check(await request(at, "GET", "/api/manager/makers")).makers));
    return 0;
  }
  if (cmd === "add-grown-up") {
    const name = rest.join(" ").trim();
    if (!name) throw new Error("add-grown-up needs a first name: add-grown-up Geoff");
    const r = check(await request(at, "POST", "/api/manager/makers/grown-up", { name }));
    const m = r.maker;
    if (r.added) log(`Added ${m.name} (${m.id}) as a grown-up maker. The kids' "who's making" list doesn't show grown-ups.`);
    else log(`${m.name} (${m.id}) is already a maker${m.grown_up ? ", a grown-up" : ", added at the cabinet"}. Left as is.`);
    return 0;
  }
  throw new Error(`unknown command ${cmd}: list, add-grown-up NAME`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e) => {
      console.error(`maker: ${e.message}`);
      process.exit(1);
    },
  );
}
