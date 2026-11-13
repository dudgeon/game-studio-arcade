// The activity view (D283): the cabinet's logs joined as §9.5 says. Read-only; nothing is kept on the mini.

const coinsOf = (/** @type {number} */ cents) => Math.sign(cents) * Math.round(Math.abs(cents) / 10);

/**
 * @param {Record<string, any[]>} files  each log file's records, by name (studio_session, coin_ledger, …)
 * @returns {{ makes: any[], plays: any[], screened: any[], coins: any[], gates: any[] }}
 */
export function activity(files) {
  const ledger = files.coin_ledger ?? [];
  /** @type {Map<string, any>} */
  const charges = new Map();
  for (const e of ledger) if (e.kind === "charge" && e.session_id) charges.set(e.session_id, e);
  /** @type {Map<string, any[]>} */
  const corrections = new Map();
  for (const c of files.studio_session_correction ?? []) {
    if (!corrections.has(c.corrects)) corrections.set(c.corrects, []);
    corrections.get(c.corrects)?.push({ at: c.at, why: c.why });
  }
  // One make, one row: a session a restart cut off has an early record and the one written when it was
  // collected (D189, D191). The last record is the final outcome; the earlier ones only say a restart happened.
  /** @type {Map<string, any>} */
  const sessions = new Map();
  /** @type {Set<string>} */
  const restarted = new Set();
  /** @type {any[]} */
  const noId = [];
  for (const s of files.studio_session ?? []) {
    if (!s.id) {
      noId.push(s);
      continue;
    }
    const before = sessions.get(s.id);
    if (before || s.outcome === "service_restarted") restarted.add(s.id);
    sessions.set(s.id, s);
  }
  const playsBy = new Map();
  for (const p of files.play ?? []) if (p.session_id) playsBy.set(p.session_id, (playsBy.get(p.session_id) ?? 0) + 1);

  const makes = [...sessions.values(), ...noId].map((s) => {
    const charge = s.id ? charges.get(s.id) : undefined;
    const listCents = s.list_cost?.amount != null ? Math.round(Number(s.list_cost.amount)) : s.list_cost_usd != null ? Math.round(Number(s.list_cost_usd) * 100) : null;
    const cents = charge ? Number(charge.cost_cents ?? -charge.cents) : listCents;
    return {
      at: s.started_at ?? s.ended_at ?? null,
      ended_at: s.ended_at ?? null,
      id: s.id ?? null,
      kind: s.kind === "change" || s.parent ? "change" : "new",
      parent: s.parent ?? null,
      who: s.maker ?? null,
      with: s.with ?? null,
      origin: s.origin ?? null,
      said: s.request ?? null,
      answers: (s.turns ?? []).map((/** @type {any} */ t) => ({ question: t.question, a: t.option_a, b: t.option_b, choice: t.choice, said: t.said ?? null })),
      ended_by: s.ended_by ?? null,
      outcome: s.outcome ?? null,
      kid_outcome: charge?.outcome ?? null,
      cart: s.cart_id ? { id: s.cart_id, version: s.cart_version ?? null } : null,
      cents,
      coins: charge ? Number(charge.coins ?? coinsOf(cents ?? 0)) : cents == null ? null : coinsOf(cents),
      charged: Boolean(charge),
      minutes: s.wall_seconds != null ? Math.round(Number(s.wall_seconds) / 6) / 10 : null,
      errors: (s.errors ?? []).length,
      plays: s.id ? (playsBy.get(s.id) ?? 0) : 0,
      restarted: Boolean(s.id && restarted.has(s.id)),
      corrections: s.id ? (corrections.get(s.id) ?? []) : [],
      // The cabinet's own re-test before the shelf (D310): passed, or why it kept the game off.
      gate: gateOf(s.playtest?.local?.gate),
    };
  });

  const plays = [
    ...(files.play ?? []).map((p) => ({ at: p.started_at, game: p.cart_id, version: p.cart_version, guest: false, seconds: p.duration_s, score: p.score ?? null, ended: p.ended ?? (p.early_quit ? "quit early" : null), errors: p.errors ?? 0, made_by: sessions.get(p.session_id)?.maker ?? null })),
    ...(files.guest_play ?? []).map((p) => ({ at: p.started_at, game: p.guest_id, version: p.guest_version, guest: true, seconds: p.duration_s, score: p.score ?? null, ended: p.ended ?? null, errors: p.errors ?? 0, made_by: null })),
  ];

  const screened = Object.entries(files)
    .filter(([name]) => /screen/.test(name))
    .flatMap(([name, rows]) => rows.map((r) => ({ log: name, at: r.at ?? r.started_at ?? r.created ?? null, who: r.maker ?? r.who ?? null, said: r.request ?? r.said ?? r.text ?? null, verdict: r.verdict ?? r.outcome ?? r.result ?? null, offered: r.offered ?? r.alternative ?? r.suggestion ?? null, record: r })));

  const coins = ledger.map((e) => ({ at: e.at, kind: e.kind, who: e.kind === "charge" ? (e.name ?? e.who) : e.kind === "refill" ? "the 1st" : `grown-up${e.by ? ` (${e.by})` : ""}`, what: e.what ?? null, reason: e.reason ?? null, cents: e.cents, pot_after_coins: coinsOf(Number(e.pot_after_cents ?? 0)) }));

  // Downloaded games' smoke checks, and every gate run, newest first (D310).
  const gates = (files.publish_gate ?? []).map((g) => ({ at: g.at, kind: g.kind, what: g.what, ...gateOf(g) }));

  const newest = (/** @type {any} */ a, /** @type {any} */ b) => String(b.at ?? "").localeCompare(String(a.at ?? ""));
  return { makes: makes.sort(newest), plays: plays.sort(newest), screened: screened.sort(newest), coins: coins.sort(newest), gates: gates.sort(newest) };
}

/** A publish-gate run, for a person (D310). @param {any} g */
function gateOf(g) {
  if (!g) return null;
  return {
    ok: Boolean(g.ok),
    host: g.host ?? null,
    driver: g.driver ?? null,
    seconds: g.seconds ?? null,
    waited_s: g.waited_s ?? 0,
    restarts: g.restarts ?? 0,
    fallback: g.fallback ?? null,
    failing: (g.failing ?? []).map((/** @type {any} */ f) => ({ id: f.id, reason: f.reason ?? null })),
    frame_p95_ms: g.frame_time?.p95Ms ?? null,
    budget_ms: g.budget_ms ?? null,
  };
}
