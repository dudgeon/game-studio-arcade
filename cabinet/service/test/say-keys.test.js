// @ts-check
// The talk screens' stick keyboard (D430, D431): the Wi-Fi screens' grid (D414) with a name's letters, or every
// key for an idea or an answer. Its keys and its drawing, with no browser.
import test from "node:test";
import assert from "node:assert/strict";
import { Painter, draw } from "../launcher/screens.js";
import { check } from "../launcher/text.js";
import "../launcher/boards.js";
import { PAGES } from "../launcher/wifi.js";
import { WIFI_KEYS, keyRows, keyboardKey, moveKey, pressKey } from "../launcher/wifi-flow.js";
import { keysFor, nameKeys, openKeys, sayKey, wordKeys } from "../launcher/say-keys.js";

const key = (/** @type {string} */ code, repeat = false) => ({ code, repeat });
const say = (/** @type {string} */ purpose, max = 16, extra = {}) => openKeys({ screen: "say", purpose, max, ...extra });

test("a name's keyboard is letters only, on one page, with delete and DONE", () => {
  const L = nameKeys(16);
  assert.equal(L.pages.length, 1);
  assert.equal(keyRows(L), 3);
  assert.deepEqual([...L.pages[0].keys.replaceAll(" ", "")].sort().join(""), "ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  assert.deepEqual(L.actions, ["delete", "done"]);
  // An idea's is the Wi-Fi keyboard's pages, so every character is there, with a space.
  const W = wordKeys(300);
  assert.equal(W.pages, PAGES);
  assert.deepEqual(W.actions, ["page", "space", "delete", "done"]);
  for (const k of [L, W, WIFI_KEYS]) {
    assert.equal(k.actionUnder.length, 10);
    assert.equal(k.colOver.length, k.actions.length);
    assert.ok(k.actionUnder.every((a) => a >= 0 && a < k.actions.length));
  }
});

test("the stick on a name's keyboard: three rows, never a blank, down to delete or DONE and back", () => {
  const L = nameKeys(16);
  assert.deepEqual(moveKey({ page: 0, row: 1, col: 0 }, "left", L), { row: 1, col: 8 }); // A wraps to L, not the blank after it
  assert.deepEqual(moveKey({ page: 0, row: 1, col: 8 }, "down", L), { row: 2, col: 6 }); // L down to M, the row's last key
  assert.deepEqual(moveKey({ page: 0, row: 2, col: 1 }, "down", L), { row: 3, col: 0 }); // delete
  assert.deepEqual(moveKey({ page: 0, row: 2, col: 6 }, "down", L), { row: 3, col: 1 }); // DONE
  assert.deepEqual(moveKey({ page: 0, row: 3, col: 1 }, "up", L), { row: 2, col: 6 });
  assert.deepEqual(moveKey({ page: 0, row: 3, col: 1 }, "right", L), { row: 3, col: 0 });
  assert.deepEqual(moveKey({ page: 0, row: 3, col: 0 }, "down", L), { row: 3, col: 0 });
});

test("typing a name with the stick: a capital then small letters, B deletes, it stops at the limit, 1UP is done", () => {
  const v = say("name", 4);
  assert.deepEqual([v.phase, v.row, v.col, v.text], ["keys", 0, 0, ""]); // Q is lit
  assert.equal(sayKey(key("Enter"), v), false, "nothing typed: DONE does nothing");
  sayKey(key("ArrowDown"), v);
  assert.equal(sayKey(key("KeyZ"), v), false); // A
  sayKey(key("ArrowLeft"), v);
  sayKey(key("KeyZ"), v); // L
  sayKey(key("KeyZ"), v);
  sayKey(key("KeyX"), v); // B deletes
  assert.equal(v.text, "Al");
  for (let i = 0; i < 5; i++) sayKey(key("KeyV"), v); // Y types too
  assert.equal(v.text, "Alll", "four letters and no more");
  sayKey(key("KeyC"), v); // X: a name has one page
  assert.equal(v.page, 0);
  assert.equal(sayKey(key("Enter"), v), true);
  assert.equal(sayKey(key("Enter", true), v), false, "a held 1UP isn't a second done");
  // DONE on the action row, with a button.
  Object.assign(v, { row: 3, col: 1 });
  assert.equal(sayKey(key("KeyZ"), v), true);
  Object.assign(v, { row: 3, col: 0 });
  assert.equal(sayKey(key("KeyZ"), v), false);
  assert.equal(v.text, "All", "delete on the action row");
});

test("typing an answer with the stick: pages, a space, and done only with words in it", () => {
  const v = say("answer", 300, { prompt: "How does the penguin move?" });
  assert.deepEqual([v.row, v.col], [1, 0]); // q, past the digits
  const L = keysFor(v);
  sayKey(key("KeyZ"), v);
  pressKey(v, "space", L);
  assert.equal(sayKey(key("Enter"), { ...v, text: "  " }), false, "spaces alone aren't words");
  sayKey(key("KeyC"), v); // X: ABC
  sayKey(key("KeyZ"), v);
  sayKey(key("KeyC"), v); // X: symbols
  sayKey(key("ArrowUp"), v);
  sayKey(key("KeyZ"), v);
  assert.equal(v.text, "q Q!");
  assert.equal(keyboardKey(key("Enter"), v, L), "done");
  // The action row: page, space, delete, DONE.
  Object.assign(v, { row: 4, col: 1 });
  sayKey(key("KeyZ"), v);
  assert.equal(v.text, "q Q! ");
  Object.assign(v, { col: 0 });
  sayKey(key("KeyZ"), v);
  assert.equal(v.page, 0);
  Object.assign(v, { col: 3 });
  assert.equal(sayKey(key("KeyZ"), v), true);
});

test("the Wi-Fi keyboard still hands back its own actions", () => {
  const v = { text: "", page: 0, row: 4, col: 3 };
  assert.equal(pressKey(v, "type"), "show");
  assert.equal(pressKey({ ...v, col: 4 }, "type"), "join");
  assert.equal(keyboardKey(key("Enter"), v), "join");
  assert.equal(pressKey({ ...v, col: 1 }, "type"), null);
});

test("the stick's keyboard fits on every talk screen, with the longest words", () => {
  const p = new Painter();
  const long = "What should happen when the penguin slides all the way off the ice and into the water?";
  const views = [
    say("name"),
    { ...say("name"), text: "Wwwwwwwwwwwwwwww", row: 3, col: 1 },
    { ...say("name"), text: "Al", row: 3, col: 0 },
    ...PAGES.map((_, page) => ({ ...say("request", 300), text: "W".repeat(300), page, row: 4, col: page })),
    { ...say("answer", 300, { prompt: long }), text: "W".repeat(285), row: 4, col: 3 },
    say("change", 300, { prompt: "What should be different?" }),
    say("note", 300),
  ];
  for (const v of views) {
    draw(p, v);
    assert.deepEqual(check(p.boxes), [], `${v.purpose} ${JSON.stringify(v).slice(0, 80)}`);
    assert.ok(p.boxes.some((b) => b.id === "keys-field"), "the field is on it");
  }
  // The plain talk screens name the key that types: F1 on a keyboard, ENT on the Picade.
  for (const phase of ["idle", "silence", "typing"]) {
    for (const typeKey of ["F1", "ENT"]) {
      draw(p, { screen: "say", purpose: "name", phase, typed: "", typeKey });
      assert.deepEqual(check(p.boxes), [], `${phase} ${typeKey}`);
      if (phase !== "typing") assert.match(p.boxes.find((b) => b.id === "hint")?.text ?? "", new RegExp(`${typeKey}: type`));
    }
  }
  for (const confirmTiles of [["Yes, that's me", "Say it again", "Type it"], ["Yes, that's me", "Type it again"]]) {
    draw(p, { screen: "say", purpose: "name", phase: "confirm", transcript: "Wwwwwwwwwwwwwwww", confirmTiles, sel: 2 });
    assert.deepEqual(check(p.boxes), []);
  }
});
