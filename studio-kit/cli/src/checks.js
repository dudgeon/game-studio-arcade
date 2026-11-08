// Local validate + playtest of a downloaded cart. The validator (task 4) and the
// playtest harness (task 5) belong to other packages; this adapter is the only
// place that knows how to reach them.
//
// Assumed contract (to confirm with those packages):
//   @game-studio-arcade/spec      export async function validateCart(dir) -> {ok, problems: string[]}
//   @game-studio-arcade/playtest  export async function playtest(dir)     -> report (playtest.json shape)
//     report.rules: [{id, kind, passed, reason}], report.generic: [{name, passed, reason}]

/**
 * @typedef {{ok: boolean, unavailable?: boolean, problems?: string[]}} ValidateResult
 * @typedef {{ok: boolean, unavailable?: boolean, report?: any, failing?: string[]}} PlaytestResult
 * @typedef {{validate: (dir: string) => Promise<ValidateResult>, playtest: (dir: string) => Promise<PlaytestResult>}} Checker
 */

/** Summarise a playtest report: ok only if every auto rule and generic check passed. */
export function judgeReport(report) {
  const failing = [];
  for (const r of report?.rules ?? []) {
    if ((r.kind ?? "auto") === "auto" && r.passed !== true) failing.push(r.id);
  }
  for (const g of report?.generic ?? []) if (g.passed !== true) failing.push(`generic:${g.name}`);
  const anyAuto = (report?.rules ?? []).some((r) => (r.kind ?? "auto") === "auto");
  return { ok: anyAuto && failing.length === 0, failing };
}

/** @returns {Checker} */
export function defaultChecker() {
  return {
    async validate(dir) {
      const mod = await tryImport("@game-studio-arcade/spec");
      if (!mod?.validateCart) return { ok: false, unavailable: true, problems: ["validate_cart isn't available yet (task 4)"] };
      return mod.validateCart(dir);
    },
    async playtest(dir) {
      const mod = await tryImport("@game-studio-arcade/playtest");
      if (!mod?.playtest) return { ok: false, unavailable: true, failing: ["playtest harness isn't available yet (task 5)"] };
      const report = await mod.playtest(dir);
      return { report, ...judgeReport(report) };
    },
  };
}

async function tryImport(name) {
  try {
    return await import(name);
  } catch {
    return null;
  }
}
