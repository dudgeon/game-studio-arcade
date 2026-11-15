import { test } from "node:test";
import assert from "node:assert/strict";
import * as turns from "../turns.js";
import { headless } from "../../src/headless.js";
import { fakeG, asG } from "./fake-g.js";

test("newTurns: defaults, options and bad input", () => {
  assert.deepEqual(turns.newTurns(), { count: 2, up: 1, round: 1, rounds: 0, scores: [0, 0], passing: false, t: 0, pass: "shared" });
  const tu = turns.newTurns(3, { rounds: 2, pass: "always" });
  assert.deepEqual([tu.count, tu.rounds, tu.pass, tu.scores], [3, 2, "always", [0, 0, 0]]);
  assert.throws(() => turns.newTurns(0), /1 to 8/);
  assert.throws(() => turns.newTurns(9), /1 to 8/);
  assert.throws(() => turns.newTurns(2, { rounds: -1 }), /rounds/);
  // @ts-expect-error a bad pass value
  assert.throws(() => turns.newTurns(2, { pass: "sometimes" }), /pass/);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(tu))), JSON.stringify(tu), "plain JSON, so probe() can return it");
});

test("shared and controller follow g.players", () => {
  const tu = turns.newTurns(2);
  const one = asG(fakeG({ players: 1 }));
  const two = asG(fakeG({ players: 2 }));
  assert.equal(turns.shared(one, tu), true);
  assert.equal(turns.shared(two, tu), false);
  tu.up = 2;
  assert.equal(turns.controller(one, tu), 1, "on one controller player 2 plays on controller 1");
  assert.equal(turns.controller(two, tu), 2);
  assert.equal(turns.controller(two, tu, 1), 1);
});

test("next: round order, rounds limit and isOver", () => {
  const g = asG(fakeG({ players: 2 }));
  const tu = turns.newTurns(3, { rounds: 2 });
  const order = [];
  while (!turns.isOver(tu)) order.push([tu.round, turns.next(g, tu)]);
  assert.deepEqual(order, [[1, 2], [1, 3], [1, 1], [2, 2], [2, 3], [2, 1]]);
  assert.equal(tu.round, 3);
  assert.equal(turns.next(g, tu), 1, "after the last round nothing changes");
  assert.equal(tu.round, 3);
  assert.equal(tu.passing, false, "no pass screen once the game is over");
  const endless = turns.newTurns(2);
  for (let i = 0; i < 100; i++) turns.next(g, endless);
  assert.equal(turns.isOver(endless), false);
  assert.equal(endless.round, 51);
});

test("next shows the pass screen only when the controls change hands (pass: shared)", () => {
  const tu = turns.newTurns(2);
  turns.next(asG(fakeG({ players: 1 })), tu);
  assert.equal(tu.passing, true, "one controller: pass it");
  const own = turns.newTurns(2);
  turns.next(asG(fakeG({ players: 2 })), own);
  assert.equal(own.passing, false, "two controllers: no hand-over");
  const always = turns.newTurns(2, { pass: "always" });
  turns.next(asG(fakeG({ players: 2 })), always);
  assert.equal(always.passing, true);
  const never = turns.newTurns(2, { pass: "never" });
  turns.next(asG(fakeG()), never);
  assert.equal(never.passing, false);
  const solo = turns.newTurns(1, { pass: "always" });
  turns.next(asG(fakeG()), solo);
  assert.equal(solo.passing, false, "one player never passes to themself");
  assert.equal(solo.round, 2);
});

test("waiting: lockout, takes the press, and btn/btnp are off while passing", () => {
  const f = fakeG({ players: 1 });
  const g = asG(f);
  const tu = turns.newTurns(2);
  assert.equal(turns.waiting(g, tu), false, "nothing to wait for at the start");
  f.press("a");
  assert.equal(turns.btnp(g, tu, "a"), true, "player 1 plays on controller 1");
  turns.next(g, tu);
  assert.equal(turns.btn(g, tu, "a"), false, "the pass screen blocks input");
  for (let i = 0; i < 30; i++) {
    f.releaseAll();
    f.press("a"); // mashing through the lockout
    assert.equal(turns.waiting(g, tu), true);
  }
  assert.equal(tu.passing, true, "presses in the first 30 frames don't count");
  f.releaseAll();
  assert.equal(turns.waiting(g, tu), true);
  f.press("start");
  assert.equal(turns.waiting(g, tu), true, "the frame that takes over still skips the game's update");
  assert.equal(tu.passing, false);
  assert.equal(tu.t, 0);
  assert.equal(turns.waiting(g, tu), false);
  f.hold();
  f.press("b");
  assert.equal(turns.btnp(g, tu, "b"), true, "player 2 now plays on controller 1");
  assert.equal(turns.waiting(g, tu, {}), false);
});

test("waiting listens on the next player's own controller when they have one", () => {
  const f = fakeG({ players: 2 });
  const tu = turns.newTurns(2, { pass: "always" });
  turns.next(asG(f), tu);
  for (let i = 0; i < 31; i++) turns.waiting(asG(f), tu);
  f.press("a", 1);
  turns.waiting(asG(f), tu);
  assert.equal(tu.passing, true, "player 1 can't take player 2's turn");
  f.press("a", 2);
  turns.waiting(asG(f), tu, { after: 0 });
  assert.equal(tu.passing, false);
});

test("addScore and winner", () => {
  const tu = turns.newTurns(3);
  assert.equal(turns.addScore(tu, 5), 5, "default: whoever is up");
  assert.equal(turns.addScore(tu, 7, 3), 7);
  assert.equal(turns.addScore(tu, -100, 2), 0, "never below 0");
  assert.deepEqual(tu.scores, [5, 0, 7]);
  assert.equal(turns.winner(tu), 3);
  turns.addScore(tu, 2, 1);
  assert.equal(turns.winner(tu), 0, "a tie has no winner");
  // player 4 is a valid Arcade.Player but isn't in a 3-player game
  assert.throws(() => turns.addScore(tu, 1, 4), /1 to 3/);
});

test("drawPass draws only while passing, on the real console", async () => {
  /** @type {Arcade.Cart<{ tu: Arcade.Lib.Turns, drew: boolean }>} */
  const cart = {
    init: (g) => ({ tu: g.lib.turns.newTurns(2), drew: false }),
    update(g, s) {
      if (g.lib.turns.waiting(g, s.tu)) return;
      if (g.lib.turns.btnp(g, s.tu, "a")) {
        g.lib.turns.addScore(s.tu, 1);
        g.lib.turns.next(g, s.tu);
      }
    },
    draw(g, s) {
      g.cls(0);
      s.drew = g.lib.turns.drawPass(g, s.tu, { names: ["Ivy", "Milo"] });
    },
    probe: (g, s) => ({ ...s.tu, drew: s.drew, players: g.players }),
  };
  const t = await headless(cart);
  await t.step();
  let p = await t.probe();
  assert.equal(p.players, 1, "headless defaults to one controller, like the cabinet");
  assert.equal(p.drew, false);
  const blank = (await t.frame()).hash;
  await t.input([{ frames: 1, p1: "a" }]);
  await t.step();
  p = await t.probe();
  assert.deepEqual([p.up, p.passing, p.drew, p.scores], [2, true, true, [1, 0]]);
  assert.notEqual((await t.frame()).hash, blank, "the pass screen drew something");
  await t.step(40);
  await t.input([{ frames: 1, p1: "a" }]);
  await t.step();
  p = await t.probe();
  assert.deepEqual([p.up, p.passing, p.scores], [2, false, [1, 0]], "the take-over press doesn't score");
  await t.step(); // release
  await t.input([{ frames: 1, p1: "a" }]);
  await t.step();
  p = await t.probe();
  assert.deepEqual([p.up, p.round, p.scores], [1, 2, [1, 1]], "player 2 scored on controller 1");

  await t.reset({ players: 2 });
  await t.input([{ frames: 1, p1: "a" }, { frames: 1 }, { frames: 1, p2: "a" }]);
  await t.step(3);
  p = await t.probe();
  assert.deepEqual([p.players, p.passing, p.scores, p.round], [2, false, [1, 1], 2], "two controllers: no hand-over, player 2 on pad 2");
});
