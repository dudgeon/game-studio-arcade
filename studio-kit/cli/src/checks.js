// Local validate + playtest of a downloaded cart. The validator (task 4) and the
// playtest harness (task 5) belong to other packages; this adapter is the only
// place that knows how to reach them.
//
// Contracts:
//   @game-studio-arcade/spec      validateRuleCoverage(dir) -> {ok, errors: [{message}], warnings} (D30, on main).
//                                 A fuller validateCart(dir) is used instead if one is exported later.
//   @game-studio-arcade/playtest  playtest(dir) -> report, written to <dir>/playtest.json (D62, task 5).
//     report.ok, report.rules: [{id, kind, status, reason}] with status pass | fail | missing | you-check | skipped,
//     report.generic: [{id, status, reason}], report.coverage, report.frameTime, report.errors.
//     judgeReport also still reads the older {passed, name} shape used by this package's fixtures.

/**
 * @typedef {{ok: boolean, unavailable?: boolean, problems?: string[]}} ValidateResult
 * @typedef {{ok: boolean, unavailable?: boolean, report?: any, failing?: string[]}} PlaytestResult
 * @typedef {{validate: (dir: string) => Promise<ValidateResult>, playtest: (dir: string) => Promise<PlaytestResult>}} Checker
 */

/** Summarise a playtest report: ok only if every auto rule and generic check passed. */
export function judgeReport(report) {
  const passed = (x) => (x.status !== undefined ? x.status === "pass" : x.passed === true);
  const failing = [];
  for (const r of report?.rules ?? []) {
    if ((r.kind ?? "auto") === "auto" && r.status !== "skipped" && !passed(r)) failing.push(r.id);
  }
  for (const g of report?.generic ?? []) if (!passed(g)) failing.push(`generic:${g.id ?? g.name}`);
  if ((report?.coverage ?? []).length) failing.push("coverage");
  const anyAuto = (report?.rules ?? []).some((r) => (r.kind ?? "auto") === "auto");
  return { ok: anyAuto && failing.length === 0 && report?.ok !== false, failing };
}

/** @returns {Checker} */
export function defaultChecker() {
  return {
    async validate(dir) {
      const mod = await tryImport("@game-studio-arcade/spec");
      if (mod?.validateCart) return mod.validateCart(dir);
      if (!mod?.validateRuleCoverage) return { ok: false, unavailable: true, problems: ["validate_cart isn't available"] };
      return coverageResult(await mod.validateRuleCoverage(dir));
    },
    async playtest(dir) {
      const mod = await tryImport("@game-studio-arcade/playtest");
      if (!mod?.playtest) return { ok: false, unavailable: true, failing: ["playtest harness isn't available yet (task 5)"] };
      let report;
      try {
        report = await mod.playtest(dir);
      } catch (e) {
        // HarnessError: no runtime, no spec, no Playwright. The harness couldn't run.
        return { ok: false, unavailable: true, failing: [`playtest couldn't run: ${e instanceof Error ? e.message : e}`] };
      }
      return { report, ...judgeReport(report) };
    },
  };
}

/** Map the spec package's coverage report to a ValidateResult. */
export function coverageResult(report) {
  const fmt = (i) => `${i.rule ? `${i.rule}: ` : ""}${i.message}`;
  return { ok: Boolean(report?.ok), problems: (report?.errors ?? []).map(fmt), warnings: (report?.warnings ?? []).map(fmt) };
}

async function tryImport(name) {
  try {
    return await import(name);
  } catch {
    return null;
  }
}
