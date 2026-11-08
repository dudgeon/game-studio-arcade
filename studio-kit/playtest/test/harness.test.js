// @ts-nocheck -- test code; the harness itself is type-checked
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { playtest, comparable, soakScript, frameStats, encodePng } from "../index.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixture = (name) => join(here, "fixtures", name);
const fake = pathToFileURL(join(here, "fake-runtime", "index.js")).href;
const opts = { runtime: fake, out: null, timeoutMs: 2000 };
const tmp = () => mkdtemp(join(tmpdir(), "gsa-playtest-"));

const status = (report) => ({
  rules: Object.fromEntries(report.rules.map((r) => [r.id, r.status])),
  generic: Object.fromEntries(report.generic.map((g) => [g.id, g.status])),
});
const reason = (report, id) => (report.rules.find((r) => r.id === id) ?? report.generic.find((g) => g.id === id))?.reason;

test("a good cart passes every auto rule and generic check", async () => {
  const r = await playtest(fixture("dot-catch"), opts);
  assert.equal(r.ok, true, JSON.stringify(r, null, 1));
  assert.deepEqual(status(r), {
    rules: { R1: "pass", R2: "pass", R3: "pass", R4: "you-check", R5: "pass" },
    generic: { loads: "pass", "no-errors": "pass", soak: "pass", palette: "pass", "frame-time": "pass", deterministic: "pass" },
  });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.coverage, []);
  assert.equal(r.frameTime.frames, 2400);
});

test("a deliberately broken cart fails the right rules with readable reasons", async () => {
  const r = await playtest(fixture("dot-catch-broken"), opts);
  assert.equal(r.ok, false);
  assert.deepEqual(status(r), {
    rules: { R1: "fail", R2: "fail", R3: "pass", R4: "you-check", R5: "fail" },
    generic: { loads: "pass", "no-errors": "fail", soak: "fail", palette: "fail", "frame-time": "pass", deterministic: "fail" },
  });
  assert.equal(reason(r, "R1"), "holding right for 10 frames should move the basket from x=116 to 136, but it went to 126");
  assert.match(reason(r, "R2"), /^catching one dot should make the score 10, but it's [01]$/);
  assert.match(reason(r, "R5"), /^the game crashed during frames \d+-\d+: .*restart is not a function$/);
  assert.match(reason(r, "soak"), /random input: the game crashed at frame 1 of the random-input soak: .*reading 'use'/);
  assert.match(reason(r, "palette"), /^frame 1 has 108 pixels of color 40, which isn't in the 32-color palette/);
  assert.match(reason(r, "deterministic"), /no input drew a different screen at frame 60; the game may be using Math.random/);
  assert.match(reason(r, "no-errors"), /^3 errors; first in soak at frame 1/);
  assert.deepEqual(r.errors.map((e) => e.where), ["soak", "soak-2", "R5"]);
});

test("a cart stuck in a loop fails that check on a timeout, and the rest still run", async () => {
  const r = await playtest(fixture("hangs"), { ...opts, timeoutMs: 1000 });
  assert.equal(status(r).rules.R2, "fail");
  assert.equal(reason(r, "R2"), "didn't finish within 1 s; the game or the check may be stuck in a loop");
  assert.equal(status(r).rules.R1, "pass");
  assert.equal(status(r).rules.R3, "pass");
  assert.equal(r.ok, false);
});

test("a check that steps too many frames is stopped", async () => {
  const r = await playtest(fixture("dot-catch"), { ...opts, maxFrames: 100 });
  assert.equal(status(r).rules.R1, "fail");
  assert.equal(reason(r, "R1"), "the check stepped more than 100 frames (1.6666666666666667 s of game time) and was stopped");
});

test("spec/checks drift: a missing check and an orphan check are reported", async () => {
  const dir = await tmp();
  try {
    await cp(fixture("dot-catch"), dir, { recursive: true });
    const spec = await readFile(join(dir, "spec.md"), "utf8");
    await writeFile(
      join(dir, "spec.md"),
      spec
        .replace(/- R5 \(auto\):.*\n/, "- R6 (auto): The basket is tan.\n")
        .replace("- v1: First version.", "- v1: First version.\n- v2: Removed R5; added R6."),
    );
    const r = await playtest(dir, opts);
    assert.equal(status(r).rules.R6, "missing");
    assert.equal(reason(r, "R6"), "checks.js has no check for R6");
    assert.ok(r.coverage.some((c) => c.rule === "R5"), JSON.stringify(r.coverage));
    assert.equal(r.ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--rules runs only the named rules; the rest are skipped", async () => {
  const r = await playtest(fixture("dot-catch"), { ...opts, rules: ["R1"] });
  assert.deepEqual(status(r).rules, { R1: "pass", R2: "skipped", R3: "skipped", R4: "you-check", R5: "skipped" });
  assert.deepEqual(r.only, ["R1"]);
  assert.equal(r.ok, true);
});

test("the same cart gives the same comparable report twice", async () => {
  const a = await playtest(fixture("dot-catch-broken"), opts);
  const b = await playtest(fixture("dot-catch-broken"), opts);
  assert.deepEqual(comparable(a), comparable(b));
  assert.equal(comparable(a).env, undefined);
});

test("writes playtest.json and key frames as indexed PNGs", async () => {
  const dir = await tmp();
  try {
    const r = await playtest(fixture("dot-catch"), { ...opts, out: dir });
    const saved = JSON.parse(await readFile(join(dir, "playtest.json"), "utf8"));
    assert.deepEqual(saved, JSON.parse(JSON.stringify(r)));
    const names = r.frames.map((f) => f.name);
    for (const n of ["load", "R1", "R2", "R3", "R5", "soak-0120", "soak-0600"]) assert.ok(names.includes(n), `${n} in ${names}`);
    for (const f of r.frames) assert.ok(existsSync(join(dir, f.file)), f.file);
    const png = await readFile(join(dir, "playtest-frames", "load.png"));
    const px = decodeIndexedPng(png);
    assert.equal(px.width, 256);
    assert.equal(px.height, 192);
    assert.equal(px.pixels[0], 1); // night sky
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("encodePng round-trips palette indices", () => {
  const pixels = Array.from({ length: 4 * 3 }, (_, i) => i % 32);
  const png = encodePng({ width: 4, height: 3, pixels }, Array.from({ length: 32 }, (_, i) => `#${i.toString(16).padStart(2, "0")}0000`));
  const d = decodeIndexedPng(png);
  assert.deepEqual([...d.pixels], pixels);
  assert.equal(d.palette[3 * 7], 7);
});

test("the soak script is seeded and covers exactly the frames asked for", () => {
  const a = soakScript(600, 42);
  assert.deepEqual(a, soakScript(600, 42));
  assert.notDeepEqual(a, soakScript(600, 43));
  assert.equal(a.reduce((n, s) => n + s.frames, 0), 600);
  assert.ok(a.some((s) => s.p1.includes("start")) || a.some((s) => s.p2.includes("start")));
});

test("frameStats", () => {
  const s = frameStats(Array.from({ length: 100 }, (_, i) => i + 1), 4);
  assert.deepEqual(s, { frames: 100, meanMs: 50.5, p50Ms: 51, p95Ms: 96, maxMs: 100, budgetMs: 4 });
});

const run = promisify(execFile);
const bin = join(here, "..", "bin", "gsa-playtest.js");
const cli = (...args) => run(process.execPath, [bin, ...args]).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));

test("CLI exit codes: 0 ok, 1 failed, 2 couldn't run", async () => {
  const rt = join(here, "fake-runtime");
  const dir = await tmp();
  try {
    assert.equal((await cli(fixture("dot-catch"), "--runtime", rt, "--out", dir)).code, 0);
    const bad = await cli(fixture("dot-catch-broken"), "--runtime", rt, "--out", dir);
    assert.equal(bad.code, 1);
    assert.match(bad.stdout, /FAIL {6}R1: holding right/);
    const none = await cli(dir, "--runtime", rt);
    assert.equal(none.code, 2);
    assert.match(none.stderr, /no spec\.md/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- against the real house runtime, when it's there (task 2). GSA_RUNTIME_DIR
// points at a runtime folder that isn't installed yet (e.g. another worktree).
const realDir = process.env.GSA_RUNTIME_DIR ?? join(here, "..", "..", "..", "runtime");
const hasReal = existsSync(join(realDir, "index.js"));
const hasHost = hasReal && existsSync(join(realDir, "dev-server.js")) && existsSync(join(realDir, "play.html"));
const real = { runtime: pathToFileURL(join(realDir, "index.js")).href, runtimeDevServer: pathToFileURL(join(realDir, "dev-server.js")).href, out: null };

// The real runtime wraps color 40 into the palette but records a dev warning,
// which fails the palette check.
const BROKEN_REAL = {
  rules: { R1: "fail", R2: "fail", R3: "pass", R4: "you-check", R5: "fail" },
  generic: { loads: "pass", "no-errors": "fail", soak: "fail", palette: "fail", "frame-time": "pass", deterministic: "fail" },
};

test("real runtime: headless driver", { skip: !hasReal && "runtime/index.js isn't here yet" }, async () => {
  const good = await playtest(fixture("dot-catch"), real);
  assert.equal(good.ok, true);
  assert.deepEqual(good.warnings, []);
  const r = await playtest(fixture("dot-catch-broken"), real);
  assert.deepEqual(status(r), BROKEN_REAL);
  assert.equal(r.warnings.length, 1);
  assert.match(reason(r, "palette"), /^the game drew with a color outside the palette \(load, frame \d+\): .*color 40/);
});

test("frame-time budget: 4 ms for node, a whole frame for the browser (D64)", async () => {
  assert.equal((await playtest(fixture("dot-catch"), opts)).frameTime.budgetMs, 4);
  assert.equal((await playtest(fixture("dot-catch"), { ...opts, budgetMs: 16.7 })).frameTime.budgetMs, 16.7);
});

let browserSkip = !hasHost && "the runtime host page isn't here yet";
if (!browserSkip) {
  try {
    const { findPlaywright } = await import("../index.js");
    const pw = findPlaywright();
    await (await pw.playwright.chromium.launch()).close();
  } catch (e) {
    browserSkip = `Playwright or its Chromium isn't usable here: ${e.message.split("\n")[0]}`;
  }
}

test("real runtime: browser driver gives the same report as headless", { skip: browserSkip, timeout: 120000 }, async () => {
  for (const cart of ["dot-catch", "dot-catch-broken"]) {
    const a = comparable(await playtest(fixture(cart), { ...real, driver: "node" }));
    const b = comparable(await playtest(fixture(cart), { ...real, driver: "browser" }));
    assert.equal(b.driver, "browser");
    assert.equal(b.frameTime.budgetMs, 16.7);
    a.frameTime.budgetMs = b.frameTime.budgetMs;
    delete a.driver;
    delete b.driver;
    assert.deepEqual(b, a, cart);
  }
});

/** A minimal decoder for our own PNGs (filter 0 only). */
function decodeIndexedPng(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let off = 8;
  let width = 0, height = 0, palette = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      assert.equal(data[9], 3);
    } else if (type === "PLTE") palette = [...data];
    else if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (width + 1)], 0);
    pixels.set(raw.subarray(y * (width + 1) + 1, (y + 1) * (width + 1)), y * width);
  }
  return { width, height, palette, pixels };
}
