#!/usr/bin/env node
// Runs on a rehearsal cabinet (never a real one) until the power goes: a mix of what the family does, as fast
// as the service allows (D370). Prints one line per step on stdout, which the mini keeps:
//   BEGIN <what>          a step started
//   ACK <what> <json>     the service said it was done: after a power cut, this must still be there
// Steps: a make through to the shelf (a cart commit, its session, its charge in the coin ledger), a coin top-up
// (the ledger), a new maker (makers.json), a play ending (the play log), a game being played (the heartbeat).
//   node power-workload.mjs SERVICE_URL MANAGER_TOKEN SEED
const [base = "http://127.0.0.1:8330", token = "", seedArg = "1"] = process.argv.slice(2);
let seed = Number(seedArg) || 1;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const say = (s) => process.stdout.write(`${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** @param {string} p @param {any} [body] @param {Record<string, string>} [h] */
async function call(p, body, h = {}) {
  const r = await fetch(base + p, body === undefined ? { headers: h } : { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify(body) });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}
  if (!r.ok) throw new Error(`${p} ${r.status} ${text.slice(0, 120)}`);
  return j;
}
const manager = token ? { Authorization: `Bearer ${token}` } : {};

async function topup() {
  say("BEGIN topup");
  const r = await call("/api/manager/pot/topup", { coins: 1 + Math.floor(rand() * 5), reason: "power rehearsal", by: "rehearsal" }, manager);
  say(`ACK topup ${JSON.stringify({ id: r.entry?.id })}`);
}
async function maker() {
  say("BEGIN maker");
  const name = `P${Date.now().toString(36).slice(-5)}`;
  const r = await call("/api/makers", { name });
  say(`ACK maker ${JSON.stringify({ id: r.maker?.id ?? r.id, name })}`);
}
async function play() {
  say("BEGIN play");
  const carts = (await call("/api/carts")).carts ?? [];
  if (!carts.length) return;
  const c = carts[Math.floor(rand() * carts.length)];
  await call("/api/arcade/playing", { playing: true, what: c.id });
  const id = `pw${Date.now().toString(36)}`;
  await call("/api/plays", { cart_id: c.id, play_id: id, started_at: new Date(Date.now() - 4000).toISOString(), duration_s: 4, ended: "back", sides: ["p1"] });
  await call("/api/arcade/playing", { playing: false });
  say(`ACK play ${JSON.stringify({ id })}`);
}
async function make() {
  const makers = (await call("/api/makers")).makers ?? [];
  if (!makers.length) return maker();
  say("BEGIN make");
  const m = makers[Math.floor(rand() * makers.length)];
  const before = (await call("/api/studio")).results?.length ?? 0;
  const r = await call("/api/studio/start", { maker: m.id, request: "a penguin catching fish" });
  if (r.ok === false) return say(`SKIP make ${JSON.stringify(r.why ?? r)}`);
  for (let i = 0; i < 600; i++) {
    const s = await call("/api/studio");
    if (s.pending) {
      await call("/api/studio/answer", { id: s.pending.id, choice: s.pending.kind === "question" ? "A" : "build" }).catch(() => {});
    } else if (s.phase === "idle") {
      const done = (s.results ?? []).slice(before);
      for (const x of done) {
        say(`ACK make ${JSON.stringify({ result: x.id, ok: x.ok, cart_id: x.cart_id ?? x.cart?.id ?? x.id_of_cart ?? null, version: x.cart_version ?? x.version ?? null, session_id: x.session_id ?? null })}`);
        await call("/api/studio/result-seen", { id: x.id }).catch(() => {});
      }
      return;
    }
    await sleep(250);
  }
}

const steps = [[make, 4], [topup, 3], [play, 3], [maker, 1]];
const total = steps.reduce((a, [, w]) => a + w, 0);
for (;;) {
  let x = rand() * total;
  const [step] = steps.find(([, w]) => (x -= w) < 0) ?? steps[0];
  try {
    await step();
  } catch (e) {
    say(`ERR ${e.message}`);
    await sleep(1000);
  }
}
