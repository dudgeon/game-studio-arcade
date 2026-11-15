#!/usr/bin/env node
// Makers on the cabinet, from the Mac mini (D236), in the style of coin.mjs.
// A grown-up maker is someone like Geoff who makes a version of a game on the mini: the cabinet's logs
// name them, but the kids' "who's making" list (M1) doesn't offer them. A kid maker is the entry the cabinet's
// own "Someone new" makes (D87), added here when a kid's game is made on the mini (D236, a kid from the mini).
//
//   node scripts/maker.mjs list                   every maker on the cabinet, grown-ups marked
//   node scripts/maker.mjs add NAME               add NAME as a kid maker, as "Someone new" does; one already there is left as is
//   node scripts/maker.mjs add-grown-up NAME      add NAME as a grown-up maker; one already there is left as is
//
// It uses the cabinet's token-gated Manager endpoints (D208) through the cabinet's SSH. `add` checks the token on
// those, then fills the cabinet's own new-name slot (POST /api/makers), so the entry is exactly a kid's.
//
//   --cabinet NAME              which cabinet, as the Manager knows them (virtual, real, …), with its own key and
//                               token (manager-token-real for the Picade). ARCADE_CABINET does the same.
//   (neither)                   the virtual cabinet through cabinet/vm/drive and coin.mjs's token, as before
//   --url URL --token-file F    talk to a service directly instead (tests, or a service on this machine)
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { TOKEN_HOME, readToken, request } from "./coin.mjs";

/** @param {any[]} makers */
export function describe(makers) {
  if (!makers.length) return "No makers yet.";
  return makers.map((m) => `  ${m.name} (${m.id})${m.grown_up ? ", grown-up" : m.guest ? ", added at the cabinet" : ""}${m.hidden ? ", hidden" : ""}${m.off ? ", hidden from Who's making?" : ""}`).join("\n");
}

/**
 * How requests reach the cabinet: a Manager cabinet by name, or coin.mjs's way.
 * @param {{ url?: string, "token-file"?: string, cabinet?: string }} values
 */
async function link(values) {
  const name = values.cabinet ?? (values.url ? undefined : process.env.ARCADE_CABINET);
  if (name) {
    const { Cabinet, loadCabinets } = await import("../manager/cabinet.mjs");
    const config = loadCabinets().find((c) => c.name === name);
    if (!config) throw new Error(`no cabinet called ${name}: ${loadCabinets().map((c) => c.name).join(", ")}`);
    const cab = new Cabinet(config);
    return {
      /** @param {"GET" | "POST"} method @param {string} p @param {object} [body] */
      request: (method, p, body) => cab.service(method, p, body),
      close: () => cab.close(),
    };
  }
  const at = { url: values.url, token: readToken(values["token-file"] ?? TOKEN_HOME) };
  return { request: (/** @type {"GET" | "POST"} */ method, /** @type {string} */ p, /** @type {object} */ body) => request(at, method, p, body), close: () => {} };
}

/** @param {string[]} argv @param {{ log?: (s: string) => void }} [io] */
export async function main(argv, io = {}) {
  const log = io.log ?? ((/** @type {string} */ s) => console.log(s));
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { url: { type: "string" }, "token-file": { type: "string" }, cabinet: { type: "string" } } });
  const [cmd, ...rest] = positionals;
  if ((cmd === "add" || cmd === "add-grown-up") && !rest.join(" ").trim()) throw new Error(`${cmd} needs a first name: ${cmd} ${cmd === "add" ? "Ivy" : "Geoff"}`);
  const c = await link(values);
  const check = (/** @type {{status: number, body: any}} */ r) => {
    if (r.status === 200) return r.body;
    throw new Error(`the cabinet said ${r.status}: ${typeof r.body === "object" ? r.body.error : r.body}`);
  };
  try {
    if (cmd === "list" || !cmd) {
      log(describe(check(await c.request("GET", "/api/manager/makers")).makers));
      return 0;
    }
    if (cmd === "add") {
      const name = rest.join(" ").trim();
      // The Manager's token first: only a paired grown-up adds a name from the mini.
      const before = check(await c.request("GET", "/api/manager/makers")).makers;
      const r = check(await c.request("POST", "/api/makers", { name }));
      const m = r.maker;
      const was = before.find((/** @type {any} */ x) => x.id === m.id);
      if (!was) log(`Added ${m.name} (${m.id}) as a maker, as "Someone new" at the cabinet would. Games published with maker ${m.id} are "by ${m.name}".`);
      else log(`${m.name} (${m.id}) is already a maker${m.grown_up ? ", a grown-up" : ", added at the cabinet"}. Left as is.`);
      return 0;
    }
    if (cmd === "add-grown-up") {
      const name = rest.join(" ").trim();
      const r = check(await c.request("POST", "/api/manager/makers/grown-up", { name }));
      const m = r.maker;
      if (r.added) log(`Added ${m.name} (${m.id}) as a grown-up maker. The kids' "who's making" list doesn't show grown-ups.`);
      else log(`${m.name} (${m.id}) is already a maker${m.grown_up ? ", a grown-up" : ", added at the cabinet"}. Left as is.`);
      return 0;
    }
    throw new Error(`unknown command ${cmd}: list, add NAME, add-grown-up NAME`);
  } finally {
    c.close();
  }
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
