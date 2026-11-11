// The launcher driven by D82 keys in headless Chromium, against the real service
// process replaying a recorded session (D186). Real makeCart, commit, logs, checks,
// and play. Skips, with the reason, if there's no headless Chromium on this machine.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readLog } from "@game-studio-arcade/studio-cli/src/log.js";
import { openBrowser, parseScript, plantSeed, runSteps, startServiceProcess } from "../scripts/drive.js";
import { writeStressFixture } from "../test-support/stress.js";

const FIXTURE = path.resolve(import.meta.dirname, "../../../studio-kit/cli/fixtures/penguin-catch");
const FLOWS = path.resolve(import.meta.dirname, "../scripts/flows");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "gsa-flow-"));

let skip = "";
try {
  const { chromium } = await import("playwright");
  const b = await chromium.launch({ headless: true }).catch(() => chromium.launch({ headless: true, channel: "chrome" }));
  await b.close();
} catch (e) {
  skip = `no headless Chromium: ${String(/** @type {Error} */ (e).message).split("\n")[0]}`;
}

/** @param {string} replay @param {(c: {service: any, page: any, url: string, data: string, problems: string[], run: (s: string) => Promise<any>, faults: () => Promise<string[]>}) => Promise<void>} body */
async function withCabinet(replay, body, options = {}) {
  const data = tmp();
  // Past the first-ever boot's screens (B2, B3): first-boot.drive covers those.
  plantSeed(data, { state: "seen" });
  const service = /** @type {any} */ (await startServiceProcess({ replay, data, pace: 10, ...options }));
  const { browser, page, problems } = await openBrowser(service.url);
  try {
    await body({
      service,
      page,
      url: service.url,
      data,
      problems,
      run: (script) => runSteps({ page, url: service.url, steps: parseScript(script), timeoutMs: 120_000 }),
      faults: () => page.evaluate(() => /** @type {any} */ (window).launcher.faults()),
    });
  } finally {
    await browser.close();
    service.stop();
  }
}

test("the whole flow: shelf to who to talk to tiles to plan to build to play to you-check", { skip: skip || false, timeout: 300_000 }, async () => {
  await withCabinet(FIXTURE, async ({ run, data, problems, faults }) => {
    const script = fs.readFileSync(path.join(FLOWS, "penguin.drive"), "utf8");
    const { shots } = await run(script);
    assert.deepEqual(await faults(), [], "nothing overran, on any frame");
    assert.deepEqual(problems, []);
    // The one-screen plan shortens rules on purpose; every word is a stick-press away (D201).
    const cuts = shots.filter((/** @type {any} */ s) => s.screen !== "plan").flatMap((/** @type {any} */ s) => s.boxes.filter((/** @type {any} */ b) => b.cut));
    assert.deepEqual(cuts, [], "on this ordinary session, nothing else even needed cutting");

    const logs = path.join(data, "logs");
    const [session, ...more] = readLog(path.join(logs, "studio_session.jsonl"));
    assert.equal(more.length, 0);
    assert.equal(session.maker, "alina");
    assert.equal(session.origin, "cabinet");
    assert.equal(session.outcome, "committed", JSON.stringify(session.playtest));
    assert.match(session.request, /penguin catches fish/);
    assert.deepEqual(session.turns.map((/** @type {any} */ t) => t.choice), ["A", "B", "C"]);
    assert.equal(session.turns[2].said, "slides left and right but really slippery like on ice");
    assert.equal(session.playtest.local.ok, true, "the real playtest ran on the mini");
    assert.deepEqual(session.plan_turns.map((/** @type {any} */ p) => p.choice), ["build"]);

    const cartId = session.cart_id;
    const cart = JSON.parse(fs.readFileSync(path.join(data, "carts", cartId, "cart.json"), "utf8"));
    assert.equal(cart.maker, "alina");
    assert.equal(cart.origin, "cabinet");
    const head = execFileSync("git", ["log", "-1", "--format=%H"], { cwd: path.join(data, "carts"), encoding: "utf8" }).trim();
    assert.equal(head, session.commit);
    assert.equal(readLog(path.join(logs, "cart_version.jsonl"))[0].commit, head);

    const [play] = readLog(path.join(logs, "play.jsonl"));
    assert.equal(play.cart_id, cartId);
    assert.equal(play.origin, "cabinet");
    assert.equal(play.ended, "star");
    assert.ok(play.ticks > 0, "the game really ran");
    assert.deepEqual(play.sides, ["p1"]);
    assert.equal(play.errors, 0);

    const [check] = readLog(path.join(logs, "you_check.jsonl"));
    assert.equal(check.cart_id, cartId);
    assert.equal(check.checker, "alina");
    assert.equal(check.play_id, play.id);
    assert.deepEqual(check.answers.map((/** @type {any} */ a) => a.answer), ["yes", "no"], "two at most, none about sound (D207)");

    const makers = JSON.parse(fs.readFileSync(path.join(data, "makers.json"), "utf8"));
    // Only Alina, added through the new-name slot: the service never adds makers on its own (D236).
    assert.deepEqual(makers.map((/** @type {any} */ m) => [m.id, m.name, m.guest]), [["alina", "Alina", true]]);
  });
});

test("every long string in a whole session fits, on every frame", { skip: skip || false, timeout: 300_000 }, async () => {
  const fixture = writeStressFixture(FIXTURE, path.join(tmp(), "stress"));
  await withCabinet(fixture, async ({ run, faults, problems, data }) => {
    const { shots } = await run(fs.readFileSync(path.join(FLOWS, "stress.drive"), "utf8"));
    assert.deepEqual(await faults(), []);
    assert.deepEqual(problems, []);
    const q1 = shots.find((/** @type {any} */ s) => s.name.endsWith("q1-everything-long"));
    assert.ok(q1.boxes.filter((/** @type {any} */ b) => b.cut && b.onCut === "reader").length >= 3, "cut, with the reader to go to");
    assert.equal(q1.boxes.find((/** @type {any} */ b) => b.id === "q-d").lines[0].text, "Make it now", "D is still there");
    assert.equal(readLog(path.join(data, "logs", "studio_session.jsonl"))[0].outcome, "committed");
    const shelf = shots.at(-1);
    assert.equal(shelf.screen, "shelf");
    assert.ok(shelf.boxes.some((/** @type {any} */ b) => b.id.startsWith("shelf-title") && b.cut), "the 59-character title is cut on the shelf");
  });
});

test("a button still held from the last screen doesn't open the mic; silence and retry", { skip: skip || false, timeout: 120_000 }, async () => {
  await withCabinet(FIXTURE, async ({ page, run, faults }) => {
    await run(`
      wait shelf
      press a
      wait who
      press a
      wait say typing
      type owen
      press enter
      wait say confirm
      press a
      wait M3
      press coin
      wait say idle
      press esc
      wait M3
      press esc
      wait who
      press a
      wait M3
      down a
      press coin
      wait say idle
      sleep 100
    `);
    assert.equal(await page.evaluate(() => /** @type {any} */ (window).launcher.phase()), "idle", "held since the last screen: nothing");
    await run(`
      up a
      down x
      wait say listening
      up x
      wait say silence
      shot heard-nothing
      say make a game
      hold y 100
      wait say confirm
      press down
      press a
      wait say idle
    `);
    assert.deepEqual(await faults(), []);
  });
});

test("ESC mid-make goes to the shelf, and the tile goes back to the same question, after a reload too", { skip: skip || false, timeout: 120_000 }, async () => {
  await withCabinet(FIXTURE, async ({ page, url, run, faults }) => {
    await run(`
      wait shelf
      press a
      wait who
      press a
      wait say typing
      type alina
      press enter
      wait say confirm
      press a
      wait M3
      press coin
      wait say idle
      press f1
      wait say typing
      type a penguin game
      press enter
      wait say confirm
      press a
      wait question
      press esc
      wait E8
      press down
      press a
      wait shelf
      shot shelf-question-waiting
    `);
    const firstTitle = await page.evaluate(() => /** @type {any} */ (window).launcher.boxes().find((/** @type {any} */ b) => b.id === "shelf-title-0").text);
    assert.equal(firstTitle, "Claude is waiting for Alina", "D201's wording");
    const note = await page.evaluate(() => /** @type {any} */ (window).launcher.boxes().find((/** @type {any} */ b) => b.id === "shelf-by-0").text);
    assert.match(note, /question/);
    await page.goto(url);
    await page.waitForFunction(() => /** @type {any} */ (window).launcher?.screen() === "shelf");
    await run(`
      sleep 100
      press a
      wait question
    `);
    const q = await page.evaluate(() => /** @type {any} */ (window).launcher.boxes().find((/** @type {any} */ b) => b.id === "q-question").text);
    assert.equal(q, "What happens if you catch a boot?");
    assert.deepEqual(await faults(), []);
  });
});

test("an answer's response landing after the next question doesn't lose the question", { skip: skip || false, timeout: 120_000 }, async () => {
  await withCabinet(FIXTURE, async ({ page, run, faults }) => {
    await page.route("**/api/studio/answer", async (/** @type {any} */ route) => {
      const response = await route.fetch();
      await new Promise((r) => setTimeout(r, 500)); // the next question comes in meanwhile
      await route.fulfill({ response });
    });
    await run(`
      wait shelf
      press a
      wait who
      press a
      wait say typing
      type alina
      press enter
      wait say confirm
      press a
      wait M3
      press coin
      wait say idle
      press f1
      wait say typing
      type a penguin game
      press enter
      wait say confirm
      press a
      wait question
      press a
      wait question
      sleep 800
    `);
    const q = await page.evaluate(() => /** @type {any} */ (window).launcher.boxes().find((/** @type {any} */ b) => b.id === "q-question")?.text);
    assert.equal(q, "How should the game get harder?");
    assert.deepEqual(await faults(), []);
  });
});

const TO_FIRST_QUESTION = `
  wait shelf
  press a
  wait who
  press a
  wait say typing
  type alina
  press enter
  wait say confirm
  press a
  wait M3
  press coin
  wait say idle
  press f1
  wait say typing
  type a penguin game
  press enter
  wait say confirm
  press a
  wait question
`;
const boxText = (/** @type {any} */ page, /** @type {string} */ id) => page.evaluate((/** @type {string} */ i) => /** @type {any} */ (window).launcher.boxes().find((/** @type {any} */ b) => b.id === i)?.text, id);

test("walking away: warned, then a message, then the shelf with Make free, and it works again (D188)", { skip: skip || false, timeout: 120_000 }, async () => {
  await withCabinet(
    FIXTURE,
    async ({ page, run, data, faults, problems }) => {
      await run(TO_FIRST_QUESTION);
      await page.waitForFunction(() => /** @type {any} */ (window).launcher.boxes().find((/** @type {any} */ b) => b.id === "hint")?.text.startsWith("Still there"), null, { timeout: 10_000 });
      await run(`
        wait gone
        shot walked-away
      `);
      assert.match(await boxText(page, "gone-0"), /away for a while/);
      await run(`
        press a
        wait shelf
      `);
      assert.equal(await boxText(page, "shelf-title-0"), "Make a new game");
      const [rec] = readLog(path.join(data, "logs", "studio_session.jsonl"));
      assert.equal(rec.outcome, "abandoned");
      assert.equal(rec.ended_by, "timed_out");
      await run(`
        press a
        wait who
        press a
        wait M3
        press coin
        wait say idle
      `);
      assert.deepEqual(await faults(), []);
      assert.deepEqual(problems, []);
    },
    { questionTimeout: 3 },
  );
});

test("the way back: ESC on a question asks; keep going returns; stop frees Make with no message (D188)", { skip: skip || false, timeout: 120_000 }, async () => {
  await withCabinet(FIXTURE, async ({ page, run, data, faults }) => {
    await run(TO_FIRST_QUESTION);
    await run(`
      press esc
      wait E8
      shot leave
      press a
      wait question
      press esc
      wait E8
      press esc
      wait question
      press esc
      wait E8
      press down
      press down
      press a
      wait shelf
      sleep 200
    `);
    assert.equal(await boxText(page, "shelf-title-0"), "Make a new game");
    assert.equal(await boxText(page, "shelf-by-0"), "Tell Claude your idea");
    const [rec] = readLog(path.join(data, "logs", "studio_session.jsonl"));
    assert.equal(rec.outcome, "abandoned");
    assert.equal(rec.ended_by, "stopped");
    assert.deepEqual(await faults(), []);
  });
});

test("the service restarts mid-question: a moment's notice, then a message, then the shelf (D189)", { skip: skip || false, timeout: 120_000 }, async () => {
  await withCabinet(FIXTURE, async ({ service, url, page, run, data, faults }) => {
    await run(TO_FIRST_QUESTION);
    service.kill();
    await page.waitForFunction(() => /** @type {any} */ (window).launcher.screen() === "notice", null, { timeout: 15_000 });
    assert.match(await boxText(page, "notice"), /restarting/);
    const again = /** @type {any} */ (await startServiceProcess({ replay: FIXTURE, data, pace: 10, port: Number(new URL(url).port) }));
    try {
      await run(`
        wait E5
        shot after-restart
      `);
      assert.match(await boxText(page, "E5-0"), /restarted/);
      const [rec] = readLog(path.join(data, "logs", "studio_session.jsonl"));
      assert.equal(rec.outcome, "service_restarted");
      assert.equal(rec.session_left_running, true);
      assert.match(rec.id, /^sesn_replay/);
      await run(`
        press a
        wait shelf
        sleep 200
      `);
      assert.equal(await boxText(page, "shelf-title-0"), "Make a new game");
      assert.equal(await boxText(page, "shelf-by-0"), "Tell Claude your idea", "read once, gone");
      // A new make's ids don't collide with those the page has answered.
      await run(`
        press a
        wait who
        press a
        wait M3
        press coin
        wait say idle
        press f1
        wait say typing
        type a penguin game
        press enter
        wait say confirm
        press a
        wait question
      `);
      assert.deepEqual(await faults(), []);
    } finally {
      again.stop();
    }
  });
});

test("a restart with a game being played leaves the game alone; the message waits on the Make tile (D189)", { skip: skip || false, timeout: 120_000 }, async () => {
  await withCabinet(FIXTURE, async ({ service, url, page, run, data, faults }) => {
    const dir = path.join(data, "carts", "hello");
    fs.cpSync(path.resolve(import.meta.dirname, "../../../runtime/examples/hello"), dir, { recursive: true });
    await run(TO_FIRST_QUESTION);
    await run(`
      press esc
      wait E8
      press down
      press a
      wait S2
      press down
      press down
      press a
      wait G0
      press a
      wait play
      sleep 300
    `);
    service.kill();
    await page.waitForTimeout(3500);
    assert.equal(await page.evaluate(() => /** @type {any} */ (window).launcher.screen()), "play", "the game carries on");
    const again = /** @type {any} */ (await startServiceProcess({ replay: FIXTURE, data, pace: 10, port: Number(new URL(url).port) }));
    try {
      await run(`
        sleep 3500
        press esc
        wait G5
        press a
        wait shelf
      `);
      assert.equal(await boxText(page, "shelf-title-0"), "Make a new game");
      assert.equal(await boxText(page, "shelf-by-0"), "Your last game didn't finish");
      assert.deepEqual(await faults(), []);
    } finally {
      again.stop();
    }
  });
});

test("the service restarts mid-build: told, back at the shelf, and the finished game arrives with a note (D191)", { skip: skip || false, timeout: 240_000 }, async () => {
  await withCabinet(
    FIXTURE,
    async ({ service, url, page, run, data, faults }) => {
      await run(TO_FIRST_QUESTION);
      await run(`
        press a
        wait question
        press a
        wait question
        press a
        wait plan
        press a
        wait progress
      `);
      service.kill();
      await page.waitForFunction(() => /** @type {any} */ (window).launcher.screen() === "notice", null, { timeout: 15_000 });
      const again = /** @type {any} */ (await startServiceProcess({ replay: FIXTURE, data, pace: 1500, port: Number(new URL(url).port) }));
      try {
        await run(`
          wait E6
          shot restarted-while-building
        `);
        assert.match(await boxText(page, "E6-0"), /may still finish/);
        await run(`
          press a
          wait shelf
          sleep 100
        `);
        // Being finished: Make waits, and says why (D199).
        assert.equal(await boxText(page, "shelf-by-0"), "Finishing the last game first");
        await run(`
          press a
          wait busy
          press a
          wait shelf
        `);
        await page.waitForFunction(() => /** @type {any} */ (window).launcher.boxes().some((/** @type {any} */ b) => b.id === "shelf-title-1" && b.text === "New game ready!"), null, { timeout: 120_000 });
        assert.equal(await boxText(page, "shelf-by-0"), "Tell Claude your idea", "and Make is Make again");
        assert.equal(await boxText(page, "shelf-title-0"), "Make a new game");
        assert.equal(await boxText(page, "shelf-by-1"), "by Alina - Penguin Catch");
        await run(`
          press down
          press a
          wait M11
          shot collected-after-restart
        `);
        assert.match(await boxText(page, "M11-note"), /finished while the cabinet was restarting/);
        await run(`
          press a
          wait G0
          press a
          wait play
          sleep 400
          press esc
          wait check
          press up
          press a
          wait G4
          press a
          wait shelf
          sleep 200
        `);
        assert.equal(await boxText(page, "shelf-title-1"), "Penguin Catch", "seen: the entry has gone, the game is there");
        const session = readLog(path.join(data, "logs", "studio_session.jsonl")).find((/** @type {any} */ r) => r.outcome === "committed");
        assert.equal(session.resumed_after_restart, true);
        assert.deepEqual(await faults(), []);
      } finally {
        again.stop();
      }
    },
    { pace: 400 },
  );
});

test("someone else's result is its own entry, and Make stays Make (D192)", { skip: skip || false, timeout: 240_000 }, async () => {
  await withCabinet(FIXTURE, async ({ page, run, faults }) => {
    await run(TO_FIRST_QUESTION);
    await run(`
      press a
      wait question
      press a
      wait question
      press a
      wait plan
      press a
      wait progress
      press esc
      wait S2
    `);
    assert.equal(await boxText(page, "shelf-title-0"), "Making Alina's game", "while it's running");
    await page.waitForFunction(() => /** @type {any} */ (window).launcher.boxes().some((/** @type {any} */ b) => b.id === "shelf-title-1" && b.text === "New game ready!"), null, { timeout: 120_000 });
    await run("shot shelf-with-result");
    assert.equal(await boxText(page, "shelf-title-0"), "Make a new game");
    assert.equal(await boxText(page, "shelf-by-1"), "by Alina - Penguin Catch");
    // The next kid can just make.
    await run(`
      press a
      wait who
      press esc
      wait shelf
      press down
      press a
      wait M11
      press down
      press a
      wait shelf
      sleep 200
    `);
    assert.equal(await boxText(page, "shelf-title-1"), "Penguin Catch");
    assert.deepEqual(await faults(), []);
  });
});

test("a starter game has no label and asks nothing after a play; a made game has both (D193)", { skip: skip || false, timeout: 120_000 }, async () => {
  await withCabinet(FIXTURE, async ({ page, run, data, faults, problems }) => {
    const carts = path.join(data, "carts");
    fs.cpSync(path.resolve(import.meta.dirname, "../../../studio-kit/context-pack/templates/catch"), path.join(carts, "apple-catch"), { recursive: true });
    fs.cpSync(path.join(FIXTURE, "cart"), path.join(carts, "penguin-catch"), { recursive: true });
    await page.reload();
    await page.waitForFunction(() => /** @type {any} */ (window).launcher?.screen() === "shelf");
    await run("sleep 100");
    // The made game sorts first: it has a created date, and the starter doesn't.
    assert.equal(await boxText(page, "shelf-title-1"), "Penguin Catch");
    assert.equal(await boxText(page, "shelf-by-1"), "by A");
    assert.equal(await boxText(page, "shelf-tag-1-0"), "NEW", "made and not played yet");
    assert.equal(await boxText(page, "shelf-title-2"), "Apple Catch");
    assert.equal(await boxText(page, "shelf-by-2"), "starter game");
    assert.equal(await boxText(page, "shelf-tag-2-0"), "starter", "no checks label (D193)");
    await run(`
      shot shelf-starter-and-made
      press down
      press down
      press a
      wait G0
      press a
      wait play
      sleep 400
      press esc
      wait G5
      press a
      wait shelf
      sleep 200
    `);
    assert.equal(readLog(path.join(data, "logs", "play.jsonl"))[0].cart_id, "apple-catch");
    await run(`
      press up
      press a
      wait G0
      press a
      wait play
      sleep 400
      press esc
      wait check
      press a
      press a
      wait G4
      press up
      press up
      press up
      press a
      wait play
      sleep 400
      press esc
      wait G4
    `);
    // Play again after answering: the answered checks aren't asked again (the live run, D215).
    assert.equal(readLog(path.join(data, "logs", "you_check.jsonl")).length, 1);
    assert.deepEqual(await faults(), []);
    assert.deepEqual(problems, []);
  });
});

test("back from a game, the shelf stays on it; a game that's gone falls back to Make (D194)", { skip: skip || false, timeout: 120_000 }, async () => {
  await withCabinet(FIXTURE, async ({ page, run, data, faults, problems }) => {
    const carts = path.join(data, "carts");
    fs.cpSync(path.resolve(import.meta.dirname, "../../../studio-kit/context-pack/templates/catch"), path.join(carts, "apple-catch"), { recursive: true });
    fs.cpSync(path.resolve(import.meta.dirname, "../../../studio-kit/context-pack/templates/dodge"), path.join(carts, "comet-dodge"), { recursive: true });
    fs.cpSync(path.join(FIXTURE, "cart"), path.join(carts, "penguin-catch"), { recursive: true });
    await page.reload();
    await page.waitForFunction(() => /** @type {any} */ (window).launcher?.screen() === "shelf");
    const sel = () => page.evaluate(() => /** @type {any} */ (window).launcher.sel());
    const litTitle = async () => boxText(page, `shelf-title-${await sel()}`);
    const toShelf = "wait shelf\nsleep 200";

    // ESC, from a starter: no you-check on the way. Items: Make, Penguin, Apple, Comet.
    await run("sleep 100\npress down\npress down\npress a\nwait G0\npress a\nwait play\nsleep 300\npress esc\nwait G5\npress a");
    await run(toShelf);
    assert.equal(await litTitle(), "Apple Catch");

    // Playing it again is one press.
    await run("press a\nwait G0\npress a\nwait play\nsleep 300\npress esc\nwait G5\npress a");
    await run(toShelf);
    assert.equal(await litTitle(), "Apple Catch");

    // Through every you-check question, answered.
    await run("press up\npress a\nwait G0\npress a\nwait play\nsleep 300\npress esc\nwait check\npress a\npress a\nwait G4\npress a");
    await run(toShelf);
    assert.equal(await litTitle(), "Penguin Catch");

    // It stays while the shelf refreshes, and moving on works from there.
    await run("press down\npress a\nwait G0\npress a\nwait play\nsleep 300\npress esc\nwait G5\npress a");
    await run(toShelf);
    assert.equal(await litTitle(), "Apple Catch");

    // Only coming back from a game: from any other screen, it's Make.
    await run("press up\npress up\npress a\nwait who\npress esc");
    await run(toShelf);
    assert.equal(await sel(), 0);
    assert.equal(await litTitle(), "Make a new game");

    assert.deepEqual(problems, []);

    // The game goes away while it's being played. (Its play can't be logged: a 404 here, expected.)
    await run("press down\npress down\npress down\npress a\nwait G0\npress a\nwait play\nsleep 300");
    fs.rmSync(path.join(carts, "comet-dodge"), { recursive: true });
    await run("press esc\nwait G5\npress a");
    await run(toShelf);
    assert.equal(await sel(), 0);
    assert.equal(await litTitle(), "Make a new game");

    assert.deepEqual(await faults(), []);
  });
});

test("score and best: a game's reported score shows after the play, and the best stays (D215)", { skip: skip || false, timeout: 120_000 }, async () => {
  await withCabinet(FIXTURE, async ({ page, run, data, faults }) => {
    // A starter that ends a round on A with 42 points the first play, then 7.
    const dir = path.join(data, "carts", "scorer");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "game.js"), `export default {
  init: (g) => ({ round: (g.load() ?? { plays: 0 }).plays, done: false }),
  update(g, s) { if (!s.done && g.btnp("a")) { s.done = true; g.score(s.round === 0 ? 42 : 7); g.save({ plays: s.round + 1 }); } },
  draw(g, s) { g.cls(1); g.text(s.done ? "OVER" : "PRESS A", 10, 10, 7); },
};
`);
    fs.writeFileSync(path.join(dir, "cart.json"), JSON.stringify({ title: "Scorer" }));
    await page.reload();
    await page.waitForFunction(() => /** @type {any} */ (window).launcher?.screen() === "shelf");
    const words = () => page.evaluate(() => /** @type {any} */ (window).launcher.boxes().flatMap((/** @type {any} */ b) => b.lines.map((/** @type {any} */ l) => l.text)).join(" | "));
    await run(`
      sleep 100
      press down
      press a
      wait G0
      press a
      wait play
      sleep 500
      press a
      sleep 300
      press esc
      wait G5
      shot first-score
    `);
    assert.match(await words(), /Score: 42\. A new best!/);
    await run(`
      press up
      press a
      wait play
      sleep 500
      press a
      sleep 300
      press esc
      wait G5
    `);
    assert.match(await words(), /Score: 7\. Best: 42\./);
    const plays = readLog(path.join(data, "logs", "play.jsonl"));
    assert.deepEqual(plays.map((/** @type {any} */ p) => p.score), [42, 7], "each play's score is in the play log");
    assert.deepEqual(plays[0].scores, [42]);
    assert.deepEqual(await faults(), []);
  });
});

test("a game that won't start says so, and doesn't strand the kid", { skip: skip || false, timeout: 120_000 }, async () => {
  await withCabinet(FIXTURE, async ({ page, run, data, faults }) => {
    const dir = path.join(data, "carts", "broken");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "game.js"), "export default { nope: 1 };\n");
    fs.writeFileSync(path.join(dir, "cart.json"), JSON.stringify({ title: "Broken" }));
    await page.reload();
    await page.waitForFunction(() => /** @type {any} */ (window).launcher?.screen() === "shelf");
    await run(`
      sleep 100
      press down
      press a
      wait G0
      press a
      wait wont-start
      shot wont-start
      press a
      wait shelf
    `);
    assert.deepEqual(await faults(), []);
    const [play] = readLog(path.join(data, "logs", "play.jsonl"));
    assert.equal(play.cart_id, "broken");
  });
});
