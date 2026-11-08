// Runs inside the virtual cabinet: the playtest harness on every cart in its own
// library, node driver (D145), with each result labelled host "virtual" (D128).
// A pass here doesn't prove a pass on the Pi. Prints one JSON document.
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { playtest } from "../../../studio-kit/playtest/index.js";

const library = process.argv[2] ?? "/var/lib/arcade/carts";
const results = [];
for (const id of readdirSync(library).sort()) {
  const dir = join(library, id);
  if (!existsSync(join(dir, "game.js"))) continue;
  const report = await playtest(dir, { driver: "node", out: null });
  results.push({
    host: "virtual",
    cart: id,
    driver: "node",
    ok: report.ok,
    frameTime: report.frameTime,
    failed: [...report.rules, ...report.generic].filter((r) => r.passed === false).map((r) => ({ id: r.id, reason: r.reason })),
  });
}
console.log(JSON.stringify({ host: "virtual", note: "M6 core, not a Pi 5; the Pi's gate is the final word (D128)", node: process.version, results }, null, 2));
process.exit(results.length > 0 && results.every((r) => r.ok) ? 0 : 1);
