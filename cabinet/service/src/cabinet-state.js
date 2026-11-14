// @ts-check
// Small things the cabinet remembers between boots (D208): the first-ever boot's
// screens have been shown (B2, B3), which month's "pot is full" has been shown (B4),
// and a month the Studio is resting because the workspace's real limit refused a
// session (L5). cabinet-state.json beside the library; rewritten, never deleted.
import fs from "node:fs";
import path from "node:path";
import { monthOf } from "./pot.js";
import { writeJsonDurable } from "@game-studio-arcade/studio-cli/src/durable.js";

/** @typedef {{ intro_seen_at?: string, month_seen?: string, resting_month?: string, resting_since?: string }} CabinetState */

/** @param {{ root: string, now?: () => Date }} o */
export function cabinetState(o) {
  const now = o.now ?? (() => new Date());
  const file = path.join(o.root, "cabinet-state.json");
  /** @returns {CabinetState} */
  const read = () => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) ?? {};
    } catch {
      return {};
    }
  };
  /** @param {CabinetState} s */
  const write = (s) => {
    writeJsonDurable(file, s);
  };
  return {
    file,
    /** What the launcher shows on boot. */
    boot() {
      const s = read();
      const month = monthOf(now());
      return { intro: !s.intro_seen_at, new_month: !!s.intro_seen_at && s.month_seen !== month };
    },
    /** The first-ever boot's screens were shown: never again. The month counts as seen too. */
    introSeen() {
      const s = read();
      if (s.intro_seen_at) return;
      write({ ...s, intro_seen_at: now().toISOString(), month_seen: monthOf(now()) });
    },
    /** This month's "pot is full" was shown (B4). */
    monthSeen() {
      write({ ...read(), month_seen: monthOf(now()) });
    },
    /** The workspace's real limit refused a session: no making until the 1st (D204, L5). */
    rest() {
      write({ ...read(), resting_month: monthOf(now()), resting_since: now().toISOString() });
    },
    resting() {
      return read().resting_month === monthOf(now());
    },
  };
}
