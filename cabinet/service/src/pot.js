// @ts-check
// The family coin pot (D202-D205): one pot per cabinet, 100 coins = $10 a month,
// each make charged its real cost. The ledger is append-only (D5), one line per
// charge, refill, top-up or reset, in logs/coin_ledger.jsonl beside studio_session
// so the Manager's Activity can join them (§9.5). The balance is never stored on
// its own: it's the last entry's pot_after_cents, so the ledger is the only truth.
import fs from "node:fs";
import path from "node:path";

/** The numbers in the handoff's §2. Settings, not constants (D203): the config's `pot` overrides them. */
export const POT_DEFAULTS = {
  /** What the pot is set to on the 1st (D202). */
  monthly_coins: 100,
  /** 1 coin = 10 cents (D202). */
  cents_per_coin: 10,
  /** The start gate (D203). */
  usual_cost_new: 6,
  usual_cost_change: 2, // D214: the first live change cost 9c; 2 until more are measured
  /** About how long each takes, for the coin check and the time left (M3, R3). */
  usual_minutes_new: 7,
  usual_minutes_change: 4,
  /** Over this many times the usual cost, the result says "more than usual" (L4). */
  over_usual: 1.5,
  /** The cabinet workspace's real limit (D204); the Manager warns past it. */
  workspace_limit_cents: 1500,
};

/** @typedef {typeof POT_DEFAULTS} PotSettings */
/** @typedef {"new" | "change"} MakeKind */

/**
 * @typedef {{
 *   type: "coin_ledger", id: string, at: string, month: string,
 *   kind: "charge" | "refill" | "topup" | "reset",
 *   who: string, by?: string | null,
 *   what: string,
 *   cart_id?: string | null, cart_version?: number | null, session_id?: string | null,
 *   cents: number, cost_cents?: number | null, cost_known?: boolean,
 *   coins: number, outcome?: string | null, reason?: string | null,
 *   pot_before_cents: number, pot_after_cents: number,
 * }} LedgerEntry
 *   who: a maker id, "cabinet" (a refill) or "grown-up" (a top-up or reset, with `by`).
 *   what: "new game", "change", "refill", "top-up" or "reset".
 *   cents: the change to the pot, negative for a charge. cost_cents: what a make cost.
 */

/** Whole coins for kids: rounded to nearest, the same way either side of zero (56c is 6, -56c is -6). @param {number} cents @param {number} [perCoin] */
export function coinsOf(cents, perCoin = POT_DEFAULTS.cents_per_coin) {
  return Math.sign(cents) * Math.round(Math.abs(cents) / perCoin);
}

/** The cabinet's local month, "2026-11". @param {Date} d */
export const monthOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** The 1st of the next month, local midnight. @param {Date} d */
export const nextRefill = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 1);

/** "2026-12-01" for a local date. @param {Date} d */
const dayOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The month before "2026-11". @param {string} m */
const monthBefore = (m) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};

/** A reason must be words (D205). @param {unknown} r */
const reasonOf = (r) => {
  const s = typeof r === "string" ? r.trim().replace(/\s+/g, " ") : "";
  return s.length >= 2 && s.length <= 200 ? s : null;
};

export class PotError extends Error {}

/**
 * @param {{ logsDir: string, settings?: Partial<PotSettings>, now?: () => Date }} o
 */
export function potStore(o) {
  const now = o.now ?? (() => new Date());
  /** @type {PotSettings} */
  const set = { ...POT_DEFAULTS, ...(o.settings ?? {}) };
  const file = path.join(o.logsDir, "coin_ledger.jsonl");
  const full = set.monthly_coins * set.cents_per_coin;
  const coins = (/** @type {number} */ c) => coinsOf(c, set.cents_per_coin);

  /** @returns {LedgerEntry[]} */
  const read = () => {
    let text = "";
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (/** @type {any} */ e) {
      if (e.code !== "ENOENT") throw e;
    }
    /** @type {LedgerEntry[]} */
    const out = [];
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // A torn last line from a power cut: skipped, never rewritten (D5).
      }
    }
    return out;
  };

  let seq = 0;
  /** @param {Omit<LedgerEntry, "type" | "id" | "at" | "month" | "pot_before_cents" | "pot_after_cents" | "coins"> & { set_to?: number }} e */
  const append = (e) => {
    const all = read();
    const before = all.length ? all[all.length - 1].pot_after_cents : 0;
    const t = now();
    const { set_to, ...rest } = e;
    const delta = set_to != null ? set_to - before : e.cents;
    /** @type {LedgerEntry} */
    const entry = {
      type: "coin_ledger",
      id: `pot_${t.getTime().toString(36)}${(seq++).toString(36)}`,
      at: t.toISOString(),
      month: monthOf(t),
      ...rest,
      cents: delta,
      coins: coins(e.kind === "charge" ? (e.cost_cents ?? 0) : delta),
      pot_before_cents: before,
      pot_after_cents: before + delta,
    };
    fs.mkdirSync(o.logsDir, { recursive: true });
    fs.appendFileSync(file, JSON.stringify(entry) + "\n");
    return entry;
  };

  /** The 1st: set to 100, leftovers and debts both gone (D202). Lazily, before anything reads the pot. */
  const ensureMonth = () => {
    const all = read();
    const m = monthOf(now());
    if (all.some((e) => e.kind === "refill" && e.month === m)) return;
    const last = all[all.length - 1];
    const before = last?.pot_after_cents ?? 0;
    const why = !last ? "the first month" : before < 0 ? "a new month: last month went over, and starts fresh" : "a new month";
    append({ kind: "refill", who: "cabinet", what: "refill", cents: 0, set_to: full, reason: why });
  };

  /** @param {LedgerEntry[]} all @param {string} month */
  const makersIn = (all, month) => {
    /** @type {Map<string, {maker: string, cents: number, makes: number}>} */
    const by = new Map();
    for (const e of all) {
      if (e.kind !== "charge" || e.month !== month) continue;
      const m = by.get(e.who) ?? { maker: e.who, cents: 0, makes: 0 };
      m.cents += e.cost_cents ?? 0;
      m.makes++;
      by.set(e.who, m);
    }
    return [...by.values()].map((m) => ({ ...m, coins: coins(m.cents) })).sort((a, b) => b.cents - a.cents || a.maker.localeCompare(b.maker));
  };

  const api = {
    settings: set,
    file,
    /** Everything the screens show about the pot. */
    state() {
      ensureMonth();
      const all = read();
      const t = now();
      const month = monthOf(t);
      const cents = all[all.length - 1].pot_after_cents;
      const prev = monthBefore(month);
      const prevEntries = all.filter((e) => e.month === prev);
      const lastMonth = prevEntries.length
        ? { month: prev, makers: makersIn(all, prev), ended_cents: prevEntries[prevEntries.length - 1].pot_after_cents, ended_coins: coins(prevEntries[prevEntries.length - 1].pot_after_cents) }
        : null;
      const spent = makersIn(all, month).reduce((s, m) => s + m.cents, 0);
      return {
        month,
        cents,
        coins: coins(cents),
        full_coins: set.monthly_coins,
        cents_per_coin: set.cents_per_coin,
        refill_on: dayOf(nextRefill(t)),
        spent_cents: spent,
        added_cents: all.filter((e) => e.month === month && (e.kind === "topup" || e.kind === "reset")).reduce((s, e) => s + e.cents, 0),
        makers: makersIn(all, month),
        last_month: lastMonth,
        usual: { new: set.usual_cost_new, change: set.usual_cost_change },
        minutes: { new: set.usual_minutes_new, change: set.usual_minutes_change },
        over_usual: set.over_usual,
      };
    },
    /**
     * The start gate (D203): the pot, in whole coins, must hold the usual cost.
     * @param {MakeKind} kind
     */
    gate(kind) {
      const s = api.state();
      const need = kind === "change" ? set.usual_cost_change : set.usual_cost_new;
      if (s.coins <= 0) return { ok: false, why: "empty", coins: s.coins, need };
      if (s.coins < need) return { ok: false, why: "low", coins: s.coins, need };
      return { ok: true, why: null, coins: s.coins, need };
    },
    /**
     * A make's real cost, at its end, whatever happened (D202: no refunds). Once per session.
     * @param {{ maker: string, what: MakeKind, session_id: string | null, cost_cents: number | null, outcome: string, cart_id?: string | null, cart_version?: number | null }} c
     */
    charge(c) {
      ensureMonth();
      if (c.session_id && read().some((e) => e.kind === "charge" && e.session_id === c.session_id)) return null;
      const known = Number.isFinite(c.cost_cents);
      const cost = known ? Math.max(0, Math.round(/** @type {number} */ (c.cost_cents))) : 0;
      return append({
        kind: "charge",
        who: c.maker,
        what: c.what === "change" ? "change" : "new game",
        cart_id: c.cart_id ?? null,
        cart_version: c.cart_version ?? null,
        session_id: c.session_id,
        cents: -cost,
        cost_cents: cost,
        cost_known: known,
        outcome: c.outcome,
        reason: null,
      });
    },
    /**
     * A grown-up adds coins, in the Manager (D205). The reason is shown to the kids.
     * @param {{ coins: number, reason: unknown, by?: string | null }} t
     */
    topUp(t) {
      const n = Number(t.coins);
      if (!Number.isInteger(n) || n < 1 || n > 1000) throw new PotError("coins must be a whole number from 1 to 1000");
      const reason = reasonOf(t.reason);
      if (!reason) throw new PotError("a top-up needs a reason, which the kids see");
      ensureMonth();
      return append({ kind: "topup", who: "grown-up", by: t.by ?? null, what: "top-up", cents: n * set.cents_per_coin, reason });
    },
    /**
     * A grown-up sets the pot back to the monthly amount (D205).
     * @param {{ reason: unknown, by?: string | null }} r
     */
    reset(r) {
      const reason = reasonOf(r.reason);
      if (!reason) throw new PotError("a reset needs a reason, which the kids see");
      ensureMonth();
      return append({ kind: "reset", who: "grown-up", by: r.by ?? null, what: "reset", cents: 0, set_to: full, reason });
    },
    /** What a top-up would do to this month's real spend, for the Manager's warning (D204). @param {number} addCoins */
    preview(addCoins) {
      const s = api.state();
      const added = Math.max(0, Math.round(addCoins)) * set.cents_per_coin;
      // Spent so far, plus all the pot would then hold: what the month can reach before any overrun.
      const total = s.spent_cents + Math.max(0, s.cents + added);
      return { dollars: added / 100, month_total_cents: total, over_limit: total > set.workspace_limit_cents, workspace_limit_cents: set.workspace_limit_cents };
    },
    /** The ledger, newest first (A2, the Manager's History). @param {{ limit?: number }} [q] */
    history(q = {}) {
      ensureMonth();
      const all = read().reverse();
      return q.limit ? all.slice(0, q.limit) : all;
    },
    /** Whether a usual cost was gone over by a lot (L4). @param {number} costCents @param {MakeKind} kind */
    overUsual(costCents, kind) {
      const usual = (kind === "change" ? set.usual_cost_change : set.usual_cost_new) * set.cents_per_coin;
      return costCents > usual * set.over_usual;
    },
    coins,
  };
  return api;
}
