// @ts-check
// The cabinet's Wi-Fi (D410-D416): the helper's networks and watch against a pretend nmcli, and the launcher's
// Wi-Fi screens and keys with no browser.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WATCH, createWifi, idFor, keyfile, parseScan, readKeyfile, securityKind, splitTerse, validPassword, watchRound, watchStep, whyFailed } from "../src/wifi.js";
import { demoWifi } from "../src/wifi-client.js";
import { Painter, draw } from "../launcher/screens.js";
import { check } from "../launcher/text.js";
import "../launcher/boards.js";
import { PAGES, holdOverlay, levelOf } from "../launcher/wifi.js";
import { HOLD_MS, IDLE_MS, WIFI_HINT, createWifiFlow, moveKey } from "../launcher/wifi-flow.js";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

test("nmcli's terse lines split at colons, with its escapes undone", () => {
  assert.deepEqual(splitTerse("*:Home:82:WPA2"), ["*", "Home", "82", "WPA2"]);
  assert.deepEqual(splitTerse(" :A\\:B\\\\C:40:"), [" ", "A:B\\C", "40", ""]);
});

test("a scan becomes the screen's list: one row a name, the one in use first, then by signal; hidden names dropped", () => {
  const nets = parseScan(["*:Home:70:WPA2", " :Home:90:WPA2", " :Guest:80:WPA2 WPA3", " ::60:WPA2", " :Open\\:Cafe:30:", " :Office:99:WPA2 802.1X", ""].join("\n"));
  assert.deepEqual(nets.map((n) => n.ssid), ["Home", "Office", "Guest", "Open:Cafe"]);
  assert.deepEqual(nets[0], { ssid: "Home", signal: 90, secure: true, kind: "psk", inUse: true });
  assert.equal(nets[1].kind, "no");
  assert.equal(nets[3].secure, false);
});

test("how a network is secured decides how it's joined", () => {
  assert.equal(securityKind(""), "open");
  assert.equal(securityKind("--"), "open");
  assert.equal(securityKind("WPA2"), "psk");
  assert.equal(securityKind("WPA1 WPA2"), "psk");
  assert.equal(securityKind("WPA2 WPA3"), "psk"); // a mixed network takes the WPA2 way
  assert.equal(securityKind("WPA3"), "sae");
  assert.equal(securityKind("WPA2 802.1X"), "no");
  assert.equal(securityKind("WEP"), "no");
});

test("a keyfile asks for what D411 wants and survives any name or password", () => {
  const text = keyfile({ ssid: "Café; #1 = home", password: " two  spaces\\and;semi ", kind: "psk", priority: 12, uuid: UUID });
  assert.match(text, /^autoconnect=true$/m);
  assert.match(text, /^autoconnect-retries=0$/m);
  assert.match(text, /^powersave=2$/m);
  assert.match(text, /^autoconnect-priority=12$/m);
  assert.match(text, /^key-mgmt=wpa-psk$/m);
  // Every space written out, so GKeyFile trims none; the backslash and the semicolon escaped.
  assert.match(text, /^psk=\\stwo\\s\\sspaces\\\\and\\;semi\\s$/m);
  assert.deepEqual(readKeyfile(text), { ssid: "Café; #1 = home", priority: 12, uuid: UUID });
  assert.match(keyfile({ ssid: "x", password: "longenough", kind: "sae", priority: 1, uuid: UUID }), /^key-mgmt=sae$/m);
  assert.doesNotMatch(keyfile({ ssid: "x", kind: "open", priority: 1, uuid: UUID }), /wifi-security/);
  assert.throws(() => keyfile({ ssid: "x", password: "short", kind: "psk", priority: 1, uuid: UUID }));
  assert.throws(() => keyfile({ ssid: "x".repeat(33), password: "longenough", kind: "psk", priority: 1, uuid: UUID }));
  assert.equal(validPassword("a".repeat(64)), true); // the 64-hex key the card carries (D251)
  assert.equal(validPassword("g".repeat(64)), false);
  assert.match(idFor("Home"), /^arcade-wifi-[0-9a-f]{12}$/);
});

test("why a join failed, in a grown-up's words", () => {
  assert.equal(whyFailed("Error: Connection activation failed: (7) Secrets were required, but not provided."), "The password didn't work.");
  assert.match(whyFailed("Error: No network with SSID 'x' found."), /out of range/);
  assert.match(whyFailed("Error: Connection activation failed: (5) IP configuration could not be reserved"), /no address/);
});

/** A pretend nmcli: one Wi-Fi device, and a list of what was asked. */
function fakeNm(/** @type {{ connected?: string | null, upFails?: boolean, device?: boolean, radio?: boolean, others?: string, secrets?: string }} */ f = {}) {
  /** @type {string[][]} */
  const calls = [];
  const state = { connected: f.connected ?? null, ...f };
  /** @type {import("../src/wifi.js").Run} */
  const run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const a = args.join(" ");
    const ok = (/** @type {string} */ stdout = "") => ({ code: 0, stdout, stderr: "" });
    if (cmd !== "nmcli") return ok(cmd === "rfkill" && args[0] === "list" ? "0: phy0: Wireless LAN\n\tSoft blocked: no\n" : "");
    if (a.includes("device status")) return ok(f.device === false ? "lo:loopback:connected (externally):lo\n" : `wlan0:wifi:${state.connected ? "connected" : "disconnected"}:${state.connected ?? ""}\nlo:loopback:connected (externally):lo\n`);
    if (a.includes("device wifi list")) return ok(`${state.connected ? "*" : " "}:Home:80:WPA2\n :Guest:60:WPA2\n`);
    if (a.includes("IP4.ADDRESS")) return ok("192.168.86.123/24\n");
    if (a.includes("-f WIFI radio")) return ok(f.radio === false ? "disabled\n" : "enabled\n");
    if (a.includes("connection up")) {
      if (state.upFails && args.includes(idFor("Guest"))) return { code: 4, stdout: "", stderr: "Error: Connection activation failed: (7) Secrets were required, but not provided.\n" };
      state.connected = args[args.indexOf("id") + 1];
      return ok();
    }
    if (a.includes("-f NAME,TYPE connection show")) return ok(f.others ?? "");
    if (a.includes("-s -g")) return ok(f.secrets ?? "");
    return ok();
  };
  return { run, calls, state };
}

function dirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arcade-wifi-"));
  return { store: path.join(root, "store"), live: path.join(root, "live"), statusFile: path.join(root, "run/status.json"), countryFile: path.join(root, "country") };
}

test("joining a new network keeps it in both places, whole; the newest that worked is tried first", async () => {
  const d = dirs();
  const nm = fakeNm();
  const wifi = createWifi({ run: nm.run, ...d });
  const first = await wifi.join({ ssid: "Home", password: "correct horse", security: "WPA2" });
  assert.equal(first.ok, true);
  assert.equal(/** @type {any} */ (first).address, "192.168.86.123");
  const second = await wifi.join({ ssid: "Guest", password: "battery staple", security: "WPA2" });
  assert.equal(second.ok, true);
  const known = wifi.known();
  assert.deepEqual(known.map((k) => k.ssid).sort(), ["Guest", "Home"]);
  assert.ok(/** @type {any} */ (known.find((k) => k.ssid === "Guest")).priority > /** @type {any} */ (known.find((k) => k.ssid === "Home")).priority);
  for (const k of known) {
    assert.equal(fs.readFileSync(path.join(d.live, k.file), "utf8"), k.text);
    assert.equal(fs.statSync(path.join(d.live, k.file)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(d.store, k.file)).mode & 0o777, 0o600);
  }
  // No password ever reaches a command line.
  assert.ok(!nm.calls.flat().some((a) => a.includes("correct horse") || a.includes("battery staple")));
  // A saved network joins again with no password, and keeps its file.
  const again = await wifi.join({ ssid: "Home" });
  assert.equal(again.ok, true);
  assert.equal(wifi.known().length, 2);
});

test("a wrong password leaves everything as it was, and goes back to the old Wi-Fi", async () => {
  const d = dirs();
  const nm = fakeNm({ upFails: true });
  const wifi = createWifi({ run: nm.run, ...d });
  await wifi.join({ ssid: "Home", password: "correct horse", security: "WPA2" });
  const r = await wifi.join({ ssid: "Guest", password: "wrong wrong", security: "WPA2" });
  assert.equal(r.ok, false);
  assert.equal(r.why, "The password didn't work.");
  assert.equal(/** @type {any} */ (r).back, "Home");
  assert.deepEqual(wifi.known().map((k) => k.ssid), ["Home"]);
  assert.deepEqual(fs.readdirSync(d.live), [`${idFor("Home")}.nmconnection`]);
  assert.ok(nm.calls.some((c) => c.join(" ").includes(`connection up id ${idFor("Home")}`)));
  // Bad input is refused before anything is written.
  assert.equal((await wifi.join({ ssid: "Guest", password: "short", security: "WPA2" })).ok, false);
  assert.equal((await wifi.join({ ssid: "Office", password: "longenough", security: "WPA2 802.1X" })).ok, false);
});

test("a network that goes missing from NetworkManager's folder, or comes back empty, is put back", async () => {
  const d = dirs();
  const nm = fakeNm();
  const wifi = createWifi({ run: nm.run, ...d });
  await wifi.join({ ssid: "Home", password: "correct horse", security: "WPA2" });
  const file = path.join(d.live, `${idFor("Home")}.nmconnection`);
  assert.equal(await wifi.restore(), 0);
  fs.rmSync(file);
  assert.equal(await wifi.restore(), 1);
  fs.writeFileSync(file, ""); // what a power cut can leave
  assert.equal(await wifi.restore(), 1);
  assert.equal(fs.readFileSync(file, "utf8"), wifi.known()[0].text);
  assert.ok(nm.calls.some((c) => c.join(" ") === "nmcli connection reload"));
});

test("the card's network, which came through netplan, is kept as one of ours (D410)", async () => {
  const d = dirs();
  const psk = "ab".repeat(32);
  const nm = fakeNm({ connected: "netplan-wlan0-Home", others: "netplan-wlan0-Home:802-11-wireless\nWired connection 1:802-3-ethernet\nlo:loopback\n", secrets: `Home\nwpa-psk\n${psk}\n` });
  const wifi = createWifi({ run: nm.run, ...d });
  assert.equal(await wifi.adopt(), 1);
  const [k] = wifi.known();
  assert.equal(k.ssid, "Home");
  assert.match(k.text, new RegExp(`^psk=${psk}$`, "m"));
  assert.equal(fs.readFileSync(path.join(d.live, k.file), "utf8"), k.text);
  assert.equal(await wifi.adopt(), 0, "once");
});

test("the watch: nothing while it's up; a nudge at 30 s; NetworkManager at 3 min; the driver at 5; then every 10", () => {
  /** @type {Parameters<typeof watchStep>[0]} */
  let st = { downSince: null, lastNudge: 0, lastHeavy: 0, heavy: 0 };
  const obs = { device: true, connected: false, radioOn: true, wired: false, saved: 1 };
  /** @type {Record<number, string[]>} */
  const did = {};
  for (let t = 1000; t <= 1000 + 1500; t += 15) {
    const r = watchStep(st, { ...obs, now: t });
    st = r.state;
    if (r.actions.length) did[t - 1000] = r.actions;
  }
  assert.deepEqual(did[30], ["nudge"]);
  assert.deepEqual(did[90], ["nudge"]);
  assert.deepEqual(did[WATCH.restartAfter], ["restart"]);
  assert.deepEqual(did[WATCH.driverAfter], ["driver"]);
  assert.ok(did[WATCH.driverAfter + WATCH.heavyEvery]?.includes("restart"));
  assert.ok(did[WATCH.driverAfter + 2 * WATCH.heavyEvery]?.includes("driver"));
  // Back up: the count starts over.
  assert.deepEqual(watchStep(st, { ...obs, connected: true, now: 5000 }), { actions: [], state: { downSince: null, lastNudge: 0, lastHeavy: 0, heavy: 0 } });
  // A cable carrying the cabinet: NetworkManager is never restarted under a grown-up's session.
  let wired = { downSince: null, lastNudge: 0, lastHeavy: 0, heavy: 0 };
  const acts = [];
  for (let t = 0; t <= 1500; t += 15) {
    const r = watchStep(/** @type {any} */ (wired), { ...obs, wired: true, now: 10_000 + t });
    wired = /** @type {any} */ (r.state);
    acts.push(...r.actions);
  }
  assert.ok(!acts.includes("restart") && acts.includes("driver"));
  // A cabinet that knows no network isn't broken; a switched-off radio is switched on at once.
  assert.deepEqual(watchStep(st, { ...obs, saved: 0, now: 9000 }).actions, []);
  assert.deepEqual(watchStep({ downSince: null, lastNudge: 0, lastHeavy: 0, heavy: 0 }, { ...obs, radioOn: false, now: 1 }).actions, ["unblock"]);
  // The Wi-Fi chip gone from the bus: the driver side is tried after a minute.
  assert.deepEqual(watchStep({ downSince: 0, lastNudge: 0, lastHeavy: 0, heavy: 0 }, { ...obs, device: false, now: 60 }).actions, ["restart"]);
});

test("a watch round unblocks the radio with the country, and leaves the status for the service", async () => {
  const d = dirs();
  fs.writeFileSync(d.countryFile, "US\n");
  const nm = fakeNm({ radio: false, connected: idFor("Home") });
  const wifi = createWifi({ run: nm.run, ...d });
  const st = await watchRound(wifi, { downSince: null, lastNudge: 0, lastHeavy: 0, heavy: 0 }, { ...d, now: () => 50_000_000 });
  assert.equal(st.downSince, null);
  const said = nm.calls.map((c) => c.join(" "));
  assert.ok(said.includes("rfkill unblock wifi") && said.includes("nmcli radio wifi on") && said.includes("iw reg set US"));
  const status = JSON.parse(fs.readFileSync(d.statusFile, "utf8"));
  assert.deepEqual({ connected: status.connected, ssid: status.ssid, address: status.address }, { connected: true, ssid: "Home", address: "192.168.86.123" });
});

// ---------- the screens ----------

const LONG = "W".repeat(32);

test("every Wi-Fi screen fits with the longest names: nothing spills, nothing that mustn't be cut is", () => {
  const p = new Painter();
  const nets = Array.from({ length: 12 }, (_, i) => ({ ssid: i ? `${LONG.slice(0, 30)}${i}` : LONG, signal: 100 - i * 8, secure: i % 2 === 0, saved: i === 0, kind: "psk" }));
  const views = [
    { screen: "wifi-list", current: LONG, networks: nets, sel: 0 },
    { screen: "wifi-list", current: null, networks: nets, sel: 12 },
    { screen: "wifi-list", current: null, scanning: true, networks: [], sel: 0 },
    ...PAGES.map((_, page) => ({ screen: "wifi-keys", ssid: LONG, text: "W".repeat(63), page, row: 4, col: page, show: page !== 1 })),
    { screen: "wifi-keys", ssid: LONG, text: "", page: 0, row: 0, col: 0 },
    { screen: "wifi-joining", ssid: LONG, tick: 10 },
    { screen: "wifi-result", ok: true, ssid: LONG, signal: 10, address: "192.168.100.200", name: `${"h".repeat(20)}.local`, internet: false, sel: 0 },
    { screen: "wifi-result", ok: true, ssid: LONG, signal: 90, address: null, name: null, internet: null, sel: 0 },
    { screen: "wifi-result", ok: false, ssid: LONG, why: "The network didn't answer in time. The signal may be too weak here.", back: LONG, sel: 2 },
    { screen: "wifi-result", ok: false, ssid: LONG, back: null, sel: 0 },
  ];
  for (const v of views) {
    draw(p, v);
    holdOverlay(p, 0.5);
    assert.deepEqual(check(p.boxes), [], `${v.screen} ${JSON.stringify(v).slice(0, 80)}`);
  }
  assert.ok(WIFI_HINT.length <= 40, "the shelf's hint fits its line");
  assert.deepEqual([0, 20, 40, 60, 90].map(levelOf), [0, 1, 2, 3, 4]);
  // Every character a Wi-Fi password may hold is on a page, or is the space key.
  const all = new Set(PAGES.flatMap((pg) => [...pg.keys]));
  for (let c = 0x21; c <= 0x7e; c++) assert.ok(all.has(String.fromCharCode(c)), `no key for ${String.fromCharCode(c)}`);
});

test("the stick on the keyboard: wraps sideways, stops at the top, and finds the action row and back", () => {
  assert.deepEqual(moveKey({ page: 0, row: 0, col: 0 }, "left"), { row: 0, col: 9 });
  assert.deepEqual(moveKey({ page: 0, row: 0, col: 9 }, "right"), { row: 0, col: 0 });
  assert.deepEqual(moveKey({ page: 0, row: 0, col: 4 }, "up"), { row: 0, col: 4 });
  assert.deepEqual(moveKey({ page: 0, row: 3, col: 9 }, "down"), { row: 4, col: 4 }); // under the last column: JOIN
  assert.deepEqual(moveKey({ page: 0, row: 4, col: 4 }, "up"), { row: 3, col: 9 });
  assert.deepEqual(moveKey({ page: 0, row: 4, col: 0 }, "left"), { row: 4, col: 4 });
  // The symbols page's last row holds two keys: the stick never lands on a blank.
  assert.deepEqual(moveKey({ page: 2, row: 2, col: 7 }, "down"), { row: 3, col: 1 });
  assert.deepEqual(moveKey({ page: 2, row: 3, col: 1 }, "right"), { row: 3, col: 0 });
  assert.deepEqual(moveKey({ page: 2, row: 4, col: 4 }, "up"), { row: 3, col: 1 });
});

/** The flow with a pretend service and clock. */
function flowWith(/** @type {ReturnType<typeof demoWifi>} */ port) {
  /** @type {any} */
  let view = { screen: "shelf" };
  let t = 0;
  let exits = 0;
  const held = new Set();
  const flow = createWifiFlow({
    show: (v) => (view = v),
    view: () => view,
    get: async () => ({}),
    post: async (url, body) => {
      if (url === "/api/wifi/scan") return { ...(await port.scan()), ok: true };
      const r = await port.join(/** @type {any} */ (body));
      return { ...r, joined: !!r.ok, host: "arcade", ok: true };
    },
    exit: () => (exits++, (view = { screen: "shelf" })),
    now: () => t,
  });
  const press = (/** @type {string} */ code) => {
    held.add(code);
    const took = flow.keydown({ code, repeat: false }, held);
    held.delete(code);
    return took;
  };
  const settle = () => new Promise((r) => setTimeout(r, 20));
  return { flow, held, press, settle, view: () => view, at: (/** @type {number} */ ms) => (t = ms), exits: () => exits };
}

test("the way in (D413): ENT and COIN held 3 s on the shelf; let go early and nothing happens; not from a game's screens", async () => {
  const f = flowWith(demoWifi({ paceMs: 1 }));
  assert.equal(f.press("F2"), false, "COIN alone is the pot's");
  f.held.add("F1");
  f.held.add("F2");
  assert.equal(f.flow.keydown({ code: "F2", repeat: false }, f.held), true);
  f.at(HOLD_MS / 2);
  assert.equal(f.flow.frame(f.held), 0.5);
  f.held.delete("F1");
  assert.equal(f.flow.frame(f.held), null);
  f.held.add("F1");
  f.at(10_000);
  f.flow.keydown({ code: "F1", repeat: false }, f.held);
  f.at(10_000 + HOLD_MS - 1);
  assert.ok(/** @type {number} */ (f.flow.frame(f.held)) < 1);
  assert.equal(f.view().screen, "shelf");
  f.at(10_000 + HOLD_MS);
  assert.equal(f.flow.frame(f.held), null);
  assert.equal(f.view().screen, "wifi-list");
  assert.equal(f.view().scanning, true);
  // Not while a question is up.
  const g = flowWith(demoWifi({ paceMs: 1 }));
  g.view().screen = "question";
  g.held.add("F1");
  g.held.add("F2");
  assert.equal(g.flow.keydown({ code: "F2", repeat: false }, g.held), false);
});

test("pick a network, type its password with the stick, join, and see it worked", async () => {
  const f = flowWith(demoWifi({ paceMs: 1 }));
  f.flow.open();
  await f.settle();
  assert.equal(f.view().screen, "wifi-list");
  assert.equal(f.view().networks[0].ssid, "Home Wi-Fi");
  f.press("ArrowDown");
  f.press("KeyZ");
  assert.equal(f.view().screen, "wifi-keys");
  assert.equal(f.view().ssid, "Home Wi-Fi Guest");
  // "q" is lit to start with; type it, move, type more.
  f.press("KeyZ");
  f.press("ArrowRight");
  f.press("KeyZ");
  assert.equal(f.view().text, "qw");
  f.press("KeyX"); // B deletes
  assert.equal(f.view().text, "q");
  f.press("KeyC"); // X: ABC
  f.press("KeyZ");
  assert.equal(f.view().text, "qW");
  f.press("Enter"); // too short: 1UP does nothing yet
  assert.equal(f.view().screen, "wifi-keys");
  for (let i = 0; i < 6; i++) f.press("KeyZ");
  f.press("Enter");
  assert.equal(f.view().screen, "wifi-joining");
  await f.settle();
  assert.equal(f.view().screen, "wifi-result");
  assert.deepEqual({ ok: f.view().ok, ssid: f.view().ssid, name: f.view().name }, { ok: true, ssid: "Home Wi-Fi Guest", name: "arcade.local" });
  f.flow.internet(false);
  assert.equal(f.view().internet, true);
  f.press("KeyZ");
  assert.equal(f.exits(), 1);
});

test("a wrong password says so and offers another try; a saved network joins without typing; left alone, it goes back to the shelf", async () => {
  const f = flowWith(demoWifi({ paceMs: 1 }));
  f.flow.open();
  await f.settle();
  f.press("ArrowDown");
  f.press("KeyZ");
  f.view().text = "wrongwrong";
  f.press("Enter");
  await f.settle();
  assert.deepEqual({ ok: f.view().ok, back: f.view().back, sel: f.view().sel }, { ok: false, back: "Home Wi-Fi", sel: 0 });
  f.press("KeyZ"); // "Try the password again"
  assert.equal(f.view().screen, "wifi-keys");
  assert.equal(f.view().text, "");
  f.press("Escape");
  assert.equal(f.view().screen, "wifi-list");
  f.press("KeyZ"); // the saved one, first in the list
  assert.equal(f.view().screen, "wifi-joining");
  f.press("Escape"); // joining can't be left half way
  assert.equal(f.view().screen, "wifi-joining");
  await f.settle();
  assert.equal(f.view().ok, true);
  f.press("Escape");
  assert.equal(f.view().screen, "wifi-list");
  f.at(IDLE_MS + 60_000);
  f.flow.frame(f.held);
  assert.equal(f.view().screen, "shelf");
});
