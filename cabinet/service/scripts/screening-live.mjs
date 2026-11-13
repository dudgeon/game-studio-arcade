#!/usr/bin/env node
// Runs the screening table (test-support/screening-table.js) through the real model,
// once, on the mini's own login (the game-studio-arcade profile, D16). Spends real
// money: about $0.005 for the whole table (D272). Run only with the director's go.
//   node cabinet/service/scripts/screening-live.mjs
import { createClient } from "@game-studio-arcade/auth";
import { modelCheck } from "../src/screening.js";
import { TABLE } from "../test-support/screening-table.js";

const client = createClient();
let cost = 0;
let wrong = 0;
for (const row of TABLE) {
  const t0 = Date.now();
  const r = await modelCheck(client, row.text, { kind: row.kind, question: row.question ?? null, timeoutMs: 20000 }).catch((e) => ({ verdict: `error: ${e.message}`, alternative: "", why: "", cost: 0 }));
  cost += r.cost ?? 0;
  // An answer's alternative must still answer its question (D276).
  const ok = r.verdict === row.expect && (!row.answers || r.verdict !== "redirect" || row.answers.test(r.alternative));
  if (!ok) wrong++;
  console.log(`${ok ? "ok  " : "MISS"} ${row.expect.padEnd(8)} ${String(r.verdict).padEnd(8)} ${String(Date.now() - t0).padStart(5)}ms $${(r.cost ?? 0).toFixed(5)}  ${row.note}${r.alternative ? `  -> ${r.alternative}` : ""}`);
}
console.log(`${TABLE.length - wrong}/${TABLE.length} right, $${cost.toFixed(4)} in all, $${(cost / TABLE.length).toFixed(5)} a check`);
process.exit(wrong ? 1 : 0);
