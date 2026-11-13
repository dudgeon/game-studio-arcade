// Runs on a cabinet: the publish gate (D310) on every cart in a library and every
// guest, exactly as the service runs it (gate-run.js under nice, its own Chromium),
// and prints what each cost in seconds. Reads only; writes nothing in the library.
// The same carts on the Picade later set gate.cpu_factor (D128).
//
//   node gate-shelf.mjs [LIBRARY] [--profile virtual|picade] [--guest-port N]
//     LIBRARY defaults to /var/lib/arcade/carts. With --guest-port, the guests on
//     that running guest server are smoke-checked too.
import { readdirSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { createGate, gateSettings, cabinetProfile } from "../../service/src/gate.js";

const { values: v, positionals } = parseArgs({ allowPositionals: true, options: { profile: { type: "string" }, "guest-port": { type: "string" }, guests: { type: "string" } } });
const library = positionals[0] ?? "/var/lib/arcade/carts";
const settings = gateSettings({ profile: v.profile ?? cabinetProfile() });
const logs = mkdtempSync(join(tmpdir(), "gate-shelf-"));
const gate = createGate({ settings, playing: () => false, logsDir: logs });

const rows = [];
for (const id of readdirSync(library).sort()) {
  const dir = join(library, id);
  if (!existsSync(join(dir, "game.js"))) continue;
  const r = await gate.cart(dir, { what: id });
  rows.push({ kind: "cart", id, ok: r.ok, seconds: r.seconds, driver: r.driver, p95_ms: r.frame_time?.p95Ms ?? null, max_ms: r.frame_time?.maxMs ?? null, failing: r.failing.map((f) => `${f.id}: ${f.reason}`) });
  console.error(`${r.ok ? "PASS" : "FAIL"} ${id} ${r.seconds} s${r.ok ? "" : ` ${r.failing.map((f) => f.id).join(", ")}`}`);
}
if (v["guest-port"]) {
  const dirs = (v.guests ?? "/opt/arcade/current/guests").split(",");
  for (const d of dirs) {
    for (const id of existsSync(d) ? readdirSync(d).sort() : []) {
      const file = join(d, id, "guest.json");
      if (!existsSync(file)) continue;
      const meta = JSON.parse(readFileSync(file, "utf8"));
      const r = await gate.guest(id, `http://127.0.0.1:${v["guest-port"]}/${id}/${meta.entry}`);
      rows.push({ kind: "guest", id, ok: r.ok, seconds: r.seconds, failing: r.failing.map((f) => `${f.id}: ${f.reason}`) });
      console.error(`${r.ok ? "PASS" : "FAIL"} guest ${id} ${r.seconds} s`);
    }
  }
}
const carts = rows.filter((r) => r.kind === "cart");
const secs = carts.map((r) => r.seconds).sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      host: settings.host,
      note: settings.host === "virtual" ? "M6 cores, not a Pi 5: frame times judged against the Pi's budget over cpu_factor, a guess until the Picade runs the same carts (D128)" : undefined,
      budget_ms: settings.budgetMs,
      cpu_factor: settings.cpuFactor,
      nice: settings.nice,
      carts: carts.length,
      passed: carts.filter((r) => r.ok).length,
      seconds: secs.length ? { min: secs[0], median: secs[Math.floor(secs.length / 2)], max: secs.at(-1), total: Math.round(secs.reduce((a, b) => a + b, 0) * 10) / 10 } : null,
      rows,
    },
    null,
    1,
  ),
);
