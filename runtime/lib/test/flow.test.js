import { test } from "node:test";
import assert from "node:assert/strict";
import * as flow from "../flow.js";
import { fakeG, asG } from "./fake-g.js";

test("newFlow, go, tick", () => {
  const fl = flow.newFlow();
  assert.deepEqual({ ...fl }, { mode: "title", t: 0, prev: null });
  flow.tick(fl);
  assert.equal(flow.tick(fl), 2);
  flow.go(fl, "play");
  assert.deepEqual({ ...fl }, { mode: "play", t: 0, prev: "title" });
  flow.go(fl, "play");
  assert.equal(fl.prev, "play", "re-entering restarts the count");
  assert.equal(flow.newFlow("attract").mode, "attract");
});

test("startPressed: lockout, buttons, players", () => {
  const f = fakeG({ players: 2 });
  const g = asG(f);
  const fl = flow.newFlow("over");
  f.press("start");
  assert.equal(flow.startPressed(g, fl), 0, "locked out at t=0");
  fl.t = 30;
  assert.equal(flow.startPressed(g, fl), 1);
  f.releaseAll();
  f.press("a", 2);
  assert.equal(flow.startPressed(g, fl), 2, "either player, A counts");
  assert.equal(flow.startPressed(g, fl, { players: [1] }), 0);
  assert.equal(flow.startPressed(g, fl, { buttons: ["start"] }), 0);
  f.press("start", 1);
  assert.equal(flow.startPressed(g, fl), 1, "player 1 wins a tie");
  f.hold();
  assert.equal(flow.startPressed(g, fl), 0, "held, not pressed");
  fl.t = 0;
  f.press("start");
  assert.equal(flow.startPressed(g, fl, { after: 0 }), 1);
});

test("startPressed listens to every connected controller, and only those", () => {
  const one = fakeG();
  const fl = flow.newFlow("title");
  fl.t = 30;
  one.press("start", 2);
  assert.equal(flow.startPressed(asG(one), fl), 0, "one controller: player 2 isn't asked");
  const four = fakeG({ players: 4 });
  four.press("a", 4);
  assert.equal(flow.startPressed(asG(four), fl), 4);
});

test("a whole title -> play -> over -> title loop", () => {
  const f = fakeG();
  const g = asG(f);
  const fl = flow.newFlow();
  const seen = [];
  for (let frame = 0; frame < 200; frame++) {
    f.releaseAll();
    if (frame % 10 === 0) f.press("start"); // a kid mashing START
    flow.tick(fl);
    if (fl.mode === "title" && flow.startPressed(g, fl)) flow.go(fl, "play");
    else if (fl.mode === "play" && fl.t >= 50) flow.go(fl, "over");
    else if (fl.mode === "over" && flow.startPressed(g, fl)) flow.go(fl, "title");
    if (seen.at(-1) !== fl.mode) seen.push(fl.mode);
  }
  assert.deepEqual(seen.slice(0, 4), ["title", "play", "over", "title"]);
});
