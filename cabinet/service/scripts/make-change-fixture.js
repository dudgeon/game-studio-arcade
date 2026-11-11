#!/usr/bin/env node
// Writes studio-kit/cli/fixtures/penguin-catch-change/: a hand-written change
// session (a fork of Penguin Catch) for the replay (D186, D208), until a live
// change is recorded. Its shape follows the recorded make: the same event types,
// one question, a plan with the changed rule, the parent's cart with one change.
// The cart is real: it validates and passes its playtest, so the replay commits it.
//
//   node cabinet/service/scripts/make-change-fixture.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(HERE, "../../../studio-kit/cli/fixtures");
const FROM = path.join(FIX, "penguin-catch");
const OUT = path.join(FIX, "penguin-catch-change");

fs.rmSync(path.join(OUT, "cart"), { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(path.join(FROM, "cart"), path.join(OUT, "cart"), { recursive: true });

// ---------- the changed cart ----------

const OLD_R12 = "The penguin looks like a penguin, and sliding on the ice feels slippery and fun.";
const NEW_R12 = "The penguin wears a red scarf that you can see while it slides.";
const specFile = path.join(OUT, "cart/spec.md");
let spec = fs.readFileSync(specFile, "utf8");
const swap = (/** @type {string} */ a, /** @type {string} */ b) => {
  if (!spec.includes(a)) throw new Error(`spec has no "${a}"`);
  spec = spec.replace(a, b);
};
swap(`- R12 (you check): ${OLD_R12}`, `- R12 (you check): ${NEW_R12}`);
swap("A chubby black and white penguin with an orange beak and feet.", "A chubby black and white penguin with an orange beak and feet, and a red scarf.");
swap("- v1: First version, from A's request.", "- v1: First version, from A's request.\n- v2: The penguin wears a red scarf (A asked for it). R12 changed to match.");
fs.writeFileSync(specFile, spec);

const gameFile = path.join(OUT, "cart/game.js");
let game = fs.readFileSync(gameFile, "utf8");
const DRAW = "    else g.spr(spr.peng, p.x + lean, p.y - hopY, {});\n";
if (!game.includes(DRAW)) throw new Error("game.js has changed: no penguin draw line");
game = game.replace(DRAW, `${DRAW}    // v2: a red scarf, drawn over the sprite so it slides and hops with it.\n    if (!flash) g.rectfill(p.x + lean + 3, p.y - hopY + 7, 10, 2, c.red);\n`);
fs.writeFileSync(gameFile, game);

const cartFile = path.join(OUT, "cart/cart.json");
const cart = JSON.parse(fs.readFileSync(cartFile, "utf8"));
fs.writeFileSync(cartFile, JSON.stringify({ ...cart, version: 2, parent: "penguin-catch@1", session_id: "sesn_replay_change" }, null, 2) + "\n");

const report = JSON.parse(fs.readFileSync(path.join(FROM, "report.json"), "utf8"));
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ ...report, summary: "Penguin Catch v2: the penguin wears a red scarf.", started_from: "penguin-catch v1", fix_rounds: 0, check_changes: [] }) + "\n");

// ---------- the session ----------

const recorded = fs.readFileSync(path.join(FROM, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const plan = recorded.find((e) => e.name === "show_plan").input;

let n = 0;
let t = Date.parse("2026-11-11T10:00:00Z");
const id = () => `sevt_chg${String(++n).padStart(4, "0")}`;
const at = () => new Date((t += 1500)).toISOString().replace("Z", "000Z");
/** @type {any[]} */
const ev = [];
const push = (/** @type {any} */ e) => ev.push({ id: id(), processed_at: at(), ...e });
let cost = 0;
const usage = (/** @type {number} */ cents) => {
  cost = cents;
  push({ type: "session.usage", usage: { active_seconds: cents * 4, input_tokens: 10 * cents, output_tokens: 30 * cents, cache_read_input_tokens: 2000 * cents, list_cost: { amount: String(cents), currency: "USD" } } });
};
const custom = (/** @type {string} */ name, /** @type {any} */ input, /** @type {string} */ answer) => {
  push({ type: "agent.custom_tool_use", name, input });
  const use = ev[ev.length - 1].id;
  push({ type: "session.status_idle", stop_reason: { type: "requires_action", event_ids: [use] } });
  push({ type: "user.custom_tool_result", custom_tool_use_id: use, content: [{ type: "text", text: answer }], is_error: false });
  push({ type: "session.status_running" });
};
const tool = (/** @type {string} */ name, /** @type {any} */ input) => {
  push({ type: "agent.tool_use", name, input });
  push({ type: "agent.tool_result", tool_use_id: ev[ev.length - 1].id, content: [{ type: "text", text: "ok" }] });
};

push({ type: "session.status_running" });
push({ type: "user.message", content: [{ type: "text", text: "(the change request)" }] });
custom("tell_player", { message: "Opening your game", stage: "setup" }, '{"ok":true}');
tool("bash", { command: "mkdir -p /workspace/kit && tar -xzf /mnt/session/uploads/studio-kit.tgz -C /workspace/kit && mkdir -p /workspace/cart && tar -xzf /mnt/session/uploads/parent.tgz -C /workspace/cart" });
usage(4);
custom("ask_player", { question: "What color should the scarf be?", option_a: "Red, like a fire truck", option_b: "Blue, like the ice" }, '{"choice":"A"}');
usage(9);
tool("edit", { file_path: "/workspace/cart/spec.md", old_string: OLD_R12, new_string: NEW_R12 });
const rules = plan.rules.map((/** @type {any} */ r) => (r.id === "R12" ? { ...r, text: "The penguin wears a red scarf you can see while it slides.", was: r.text } : r));
custom(
  "show_plan",
  {
    summary: "Penguin Catch, now with a red scarf on the penguin.",
    controls: "Stick: slide left and right. START: play.",
    top_rules: ["R12", "R2", "R4", "R3"],
    rules,
    changes: [{ id: "R12", text: "The penguin wears a red scarf now." }],
  },
  '{"choice":"build"}',
);
usage(14);
custom("tell_player", { message: "Adding the scarf", stage: "building" }, '{"ok":true}');
tool("edit", { file_path: "/workspace/cart/game.js", old_string: "g.spr(spr.peng", new_string: "g.spr(spr.peng" });
usage(20);
custom("tell_player", { message: "Playing your game to check every rule", stage: "testing" }, '{"ok":true}');
tool("bash", { command: "cd /workspace/kit; node studio-kit/spec/bin/validate-cart.js /workspace/cart" });
tool("bash", { command: "cd /workspace/kit; node studio-kit/playtest/bin/gsa-playtest.js /workspace/cart --driver node" });
usage(27);
tool("bash", { command: "tar -czf /mnt/session/outputs/cart.tgz -C /workspace/cart . && echo '{}' > /mnt/session/outputs/DONE.json" });
usage(31);
custom("tell_player", { message: "Done! The scarf is on", stage: "done" }, '{"ok":true}');
push({ type: "agent.message", content: [{ type: "text", text: "Changed R12 and added a red scarf to the penguin. Every rule passes." }] });
push({ type: "session.status_idle", stop_reason: { type: "end_turn" } });

fs.writeFileSync(path.join(OUT, "events.jsonl"), ev.map((e) => JSON.stringify(e)).join("\n") + "\n");
fs.writeFileSync(
  path.join(OUT, "README.md"),
  `# penguin-catch-change\n\nHand-written by \`cabinet/service/scripts/make-change-fixture.js\`, not recorded: a change (fork) of Penguin Catch, version 2, by its maker. One question, a plan with R12 changed, the parent's cart with a red scarf. It ends at ${cost}¢ of list cost, a guess until a live change is measured (D203). Replace it with a recorded change once one has run.\n`,
);
console.log(`wrote ${OUT}: ${ev.length} events, ends at ${cost}c`);
