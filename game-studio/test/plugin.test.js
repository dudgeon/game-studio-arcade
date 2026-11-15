// The game-studio plugin (D340-D349): its manifest and MCP declaration, the studio tools on real cart folders,
// the asset importer, and the arcade bridge end to end over stdio against a local copy of the cabinet service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { dataPaths } from "@game-studio-arcade/studio-cli/src/config.js";
import { commitNewCart } from "@game-studio-arcade/studio-cli/src/library.js";
import { readLog } from "@game-studio-arcade/studio-cli/src/log.js";
import { encodePng } from "@game-studio-arcade/playtest";
import { makersStore } from "../../cabinet/service/src/makers.js";
import { createArcadeMcp, launchRelay } from "../../cabinet/service/src/arcade-mcp.js";
import { startService } from "../../cabinet/service/src/server.js";
import { stubSpeech } from "../../cabinet/service/src/speech.js";
import { PALETTE } from "../../runtime/src/palette.js";
import { createStudioServer, REPO } from "../src/studio-server.js";
import { createBridge, directLink, bridgeToolDefs, PULLED } from "../src/arcade-bridge.js";
import { decodePng, toSpriteRows, nearestColor, constName } from "../src/asset.js";
import { RGB } from "../../runtime/src/palette.js";

const PLUGIN = path.resolve(import.meta.dirname, "../plugin");
const FIXTURE = path.join(REPO, "studio-kit/cli/fixtures/penguin-catch/cart");
const MODERN = { "io.modelcontextprotocol/protocolVersion": "2026-07-28" };
const TOKEN = "k".repeat(48);
const tmp = (/** @type {string} */ p = "gsa-plugin-") => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** @param {{ handle: (m: any) => Promise<any> }} s */
const caller = (s) => {
  let n = 0;
  return async (/** @type {string} */ name, /** @type {any} */ args = {}) => (await s.handle({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args, _meta: MODERN } })).result;
};

const passing = {
  async validate() {
    return { ok: true, problems: [] };
  },
  async playtest() {
    return { ok: true, failing: [], report: { rules: [], generic: [] }, gate: { ok: true, failing: [], seconds: 1, host: "dev", driver: "browser", waited_s: 0 } };
  },
};

test("the plugin's manifest, MCP servers, skill and marketplace entry", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN, ".claude-plugin/plugin.json"), "utf8"));
  assert.equal(manifest.name, "game-studio");
  const mcp = JSON.parse(fs.readFileSync(path.join(PLUGIN, ".mcp.json"), "utf8")).mcpServers;
  assert.deepEqual(Object.keys(mcp).sort(), ["arcade", "studio"]);
  for (const s of Object.values(mcp)) assert.equal(s.args[0], "${CLAUDE_PLUGIN_ROOT}/bin/run.mjs");
  const skill = fs.readFileSync(path.join(PLUGIN, "skills/build-cart/SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: build-cart\ndescription: .{40,}\n---\n/);
  // Every tool the skill names exists.
  const names = [...bridgeToolDefs().map((t) => t.name), ...createStudioServer().tools().map((t) => t.name)];
  for (const m of skill.matchAll(/`([a-z_]+)`/g)) if (/_/.test(m[1]) && !["g.lib", "you_check", "include_words", "version_name"].includes(m[1]) && !m[1].startsWith("math")) assert.ok(names.includes(m[1]), `the skill names ${m[1]}`);
  const market = JSON.parse(fs.readFileSync(path.join(REPO, ".claude-plugin/marketplace.json"), "utf8"));
  assert.equal(market.plugins[0].name, manifest.name);
  assert.ok(fs.existsSync(path.join(REPO, market.plugins[0].source, ".claude-plugin/plugin.json")));
});

test("studio tools: the four from HANDOFF 9.3, plus read_kit and play", () => {
  assert.deepEqual(
    createStudioServer()
      .tools()
      .map((t) => t.name)
      .sort(),
    ["import_asset", "new_cart", "play", "playtest", "read_kit", "validate_cart"],
  );
});

test("read_kit: the catalog with the mini's paths, and one guide", async () => {
  const call = caller(createStudioServer());
  const cat = (await call("read_kit")).content[0].text;
  assert.match(cat, /Starting points/);
  assert.doesNotMatch(cat, /\/workspace\/kit\//);
  assert.match((await call("read_kit", { module: "sprites" })).content[0].text, /sprite/i);
  assert.match((await call("read_kit", { module: "grid" })).content[0].text, /grid/i);
  assert.equal((await call("read_kit", { module: "../../etc" })).isError, true);
});

test("new_cart from a template, validate_cart and playtest pass on it, play serves it", async () => {
  /** @type {string[]} */
  const opened = [];
  const s = createStudioServer({ open: (u) => opened.push(u) });
  const call = caller(s);
  const dir = path.join(tmp(), "snow-dodge");
  const made = await call("new_cart", { dir, from: "dodge", title: "Snow Dodge", maker: "owen", with: "geoff" });
  assert.equal(made.isError, false, made.content[0].text);
  const cart = JSON.parse(fs.readFileSync(path.join(dir, "cart.json"), "utf8"));
  assert.deepEqual([cart.id, cart.title, cart.maker, cart.with, cart.parent], ["snow-dodge", "Snow Dodge", "owen", "geoff", null]);
  assert.match(fs.readFileSync(path.join(dir, "spec.md"), "utf8"), /^# Snow Dodge$/m);
  assert.equal((await call("new_cart", { dir, from: "dodge" })).isError, true, "not over a cart");
  assert.equal((await call("new_cart", { dir: path.join(tmp(), "x"), from: "tetris" })).isError, true);
  const v = await call("validate_cart", { path: dir });
  assert.equal(v.structuredContent.ok, true, JSON.stringify(v.structuredContent.errors));
  const p = await call("playtest", { path: dir });
  assert.equal(p.structuredContent.ok, true, JSON.stringify(p.structuredContent.failing));
  assert.ok(p.structuredContent.rules.every((/** @type {any} */ r) => r.kind !== "auto" || r.status === "pass"));
  assert.ok(fs.existsSync(path.join(dir, "playtest.json")));
  const one = await call("playtest", { path: dir, rules: ["R1"] });
  assert.equal(one.structuredContent.ok, true);
  const play = await call("play", { path: dir });
  assert.equal(opened.length, 1);
  const url = new URL(play.structuredContent.url);
  assert.equal((await fetch(url)).status, 200);
  const game = await fetch(new URL(url.searchParams.get("cart") ?? "", url));
  assert.equal(game.status, 200);
  assert.match(await game.text(), /export/);
  assert.equal((await call("play", { path: dir, open: false })).structuredContent.opened, false);
  assert.equal(opened.length, 1);
  s.close();
});

test("new_cart from a pulled folder keeps its parent; validate reports a broken cart", async () => {
  const call = caller(createStudioServer());
  const pulled = path.join(tmp(), "pulled");
  fs.cpSync(FIXTURE, pulled, { recursive: true });
  fs.writeFileSync(path.join(pulled, PULLED), JSON.stringify({ id: "penguin-catch", version: 3 }));
  const dir = path.join(tmp(), "mine");
  await call("new_cart", { dir, from: pulled, maker: "owen" });
  const cart = JSON.parse(fs.readFileSync(path.join(dir, "cart.json"), "utf8"));
  assert.equal(cart.parent, "penguin-catch@3");
  assert.equal(cart.title, "Penguin Catch");
  assert.ok(fs.existsSync(path.join(dir, PULLED)));
  fs.writeFileSync(path.join(dir, "game.js"), fs.readFileSync(path.join(dir, "game.js"), "utf8") + "\nfetch('x');\n");
  const v = (await call("validate_cart", { path: dir })).structuredContent;
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((/** @type {any} */ e) => /fetch/.test(e.message)));
  assert.equal((await call("validate_cart", { path: tmp() })).isError, true);
});

/** An RGBA PNG, written here so alpha is tested (encodePng writes palette PNGs). @param {number} w @param {number} h @param {(x: number, y: number) => number[]} px */
function rgbaPng(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) Buffer.from(px(x, y)).copy(raw, y * (w * 4 + 1) + 1 + x * 4);
  const chunk = (/** @type {string} */ t, /** @type {Buffer} */ d) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(t), d])) >>> 0);
    return Buffer.concat([len, Buffer.from(t), d, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("assets: PNGs decode, house colors map to themselves, transparency stays, shape is kept", () => {
  for (let i = 0; i < RGB.length; i++) assert.equal(nearestColor(RGB[i][0], RGB[i][1], RGB[i][2]), i);
  const pal = encodePng({ width: 4, height: 2, pixels: [0, 1, 2, 3, 4, 5, 6, 7] }, PALETTE);
  const img = decodePng(pal);
  assert.deepEqual([img.width, img.height], [4, 2]);
  assert.deepEqual(toSpriteRows(img, 8), ["0123", "4567"]);
  // A 32×16 red disc on transparent: shrunk to fit 8, it's 8×4, red inside and see-through at the corners.
  const red = RGB.findIndex((c, i) => i === nearestColor(255, 0, 0));
  const png = rgbaPng(32, 16, (x, y) => ((x - 16) ** 2 + ((y - 8) * 2) ** 2 < 15 ** 2 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
  const rows = toSpriteRows(decodePng(png), 8);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].length, 8);
  assert.equal(rows[0][0], ".");
  assert.equal(rows[2][4], "0123456789abcdefghijklmnopqrstuv"[red]);
  assert.equal(constName("Cat Face.png"), "CAT_FACE");
  assert.equal(constName("3d.png"), "_3D");
  assert.throws(() => decodePng(Buffer.from("GIF89a")), /not a PNG/);
});

test("import_asset: a picture into a cart's assets, a NOTICE line, and rows to paste", async () => {
  const call = caller(createStudioServer());
  const dir = path.join(tmp(), "cart");
  await call("new_cart", { dir, from: "blank" });
  const pic = path.join(tmp(), "Happy Star.png");
  fs.writeFileSync(pic, rgbaPng(20, 20, (x, y) => (Math.abs(x - 10) + Math.abs(y - 10) < 9 ? [250, 220, 40, 255] : [0, 0, 0, 0])));
  const r = await call("import_asset", { file: pic, cart: dir, size: 10, source: "drawn by Owen" });
  assert.equal(r.isError, false, r.content[0].text);
  const out = r.structuredContent;
  assert.equal(out.name, "HAPPY_STAR");
  assert.deepEqual([out.width, out.height], [10, 10]);
  assert.match(out.code, /const HAPPY_STAR_ROWS = \[/);
  assert.match(fs.readFileSync(path.join(dir, "NOTICE.md"), "utf8"), /assets\/happy-star\.png \(from Happy Star\.png\): drawn by Owen/);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "assets/happy-star.sprite.json"), "utf8"));
  assert.equal(saved.rows.length, 10);
  assert.equal((await call("import_asset", { file: pic, cart: dir, size: 999 })).isError, true);
  assert.equal((await call("import_asset", { file: "/no/such.png", cart: dir, size: 8 })).isError, true);
  // macOS converts what isn't a plain PNG.
  if (process.platform === "darwin") {
    const jpg = path.join(tmp(), "star.jpg");
    const { execFileSync } = await import("node:child_process");
    execFileSync("sips", ["-s", "format", "jpeg", pic, "--out", jpg], { stdio: "ignore" });
    const j = await call("import_asset", { file: jpg, cart: dir, size: 8, source: "test" });
    assert.equal(j.isError, false, j.content[0].text);
  }
  const v = (await call("validate_cart", { path: dir })).structuredContent;
  assert.equal(v.ok, true, "assets and NOTICE.md don't break a cart");
});

/** A local cabinet service with the arcade MCP server, on a free port. */
async function localCabinet() {
  const paths = dataPaths(tmp("gsa-cab-"));
  const makers = makersStore({ file: path.join(paths.root, "makers.json") });
  makers.add("Alina");
  makers.add("Owen");
  makers.ensureGrownUp("Geoff");
  commitNewCart({ root: paths.carts, cartDir: FIXTURE, cartJson: { ...JSON.parse(fs.readFileSync(path.join(FIXTURE, "cart.json"), "utf8")), maker: "alina" }, message: "make {id}" });
  const launches = launchRelay();
  const mcp = createArcadeMcp({ paths, makers, checker: passing, launches });
  const studio = { state: () => ({ phase: "idle" }), subscribe: () => () => {} };
  const s = await startService(/** @type {any} */ ({ studio, makers, speech: stubSpeech(), libraryDir: paths.carts, logsDir: paths.logs, managerToken: TOKEN, mcp, launches, port: 0 }));
  const tokenFile = path.join(tmp(), "token");
  fs.writeFileSync(tokenFile, TOKEN, { mode: 0o600 });
  return { paths, s, tokenFile, launches };
}

test("bridge: pull into a folder, change it, publish the folder as a change; refusals come back readable", async () => {
  const { paths, s } = await localCabinet();
  try {
    const call = caller(createBridge(directLink(s.url, TOKEN)));
    const dir = path.join(tmp(), "penguin");
    const got = await call("get_cart", { id: "penguin-catch", into: dir });
    assert.equal(got.isError, false, got.content[0].text);
    assert.ok(fs.existsSync(path.join(dir, "game.js")));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, PULLED), "utf8")).id, "penguin-catch");
    assert.match((await call("get_cart", { id: "penguin-catch", into: dir })).content[0].text, /isn't empty/);
    fs.appendFileSync(path.join(dir, "spec.md"), "\n- v2: the penguin is faster\n");
    fs.writeFileSync(path.join(dir, "README.md"), "not part of a cart");
    const pub = await call("publish_cart", { dir, maker: "alina", with: "geoff", summary: "Alina made the penguin faster with Geoff." });
    assert.equal(pub.isError, false, pub.content[0].text);
    assert.equal(pub.structuredContent.cart_id, "penguin-catch-v2");
    assert.equal(pub.structuredContent.parent_from_folder, true);
    assert.deepEqual(pub.structuredContent.not_sent, ["README.md"]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(paths.carts, "penguin-catch-v2", "cart.json"), "utf8")).origin, "desktop");
    assert.equal(fs.existsSync(path.join(paths.carts, "penguin-catch-v2", PULLED)), false, "the marker stays on the mini");
    assert.match((await call("publish_cart", { dir, maker: "nobody", summary: "x" })).content[0].text, /no maker "nobody"/);
    const bad = await caller(createBridge(directLink(s.url, "wrong")))("list_carts");
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /refused the Manager's token/);
  } finally {
    await s.close();
  }
});

test("end to end over stdio: Claude Code's way in, through plugin/bin/run.mjs arcade", async () => {
  const { s, tokenFile } = await localCabinet();
  const child = spawn(process.execPath, [path.join(PLUGIN, "bin/run.mjs"), "arcade"], { env: { ...process.env, ARCADE_URL: s.url, ARCADE_TOKEN_FILE: tokenFile }, stdio: ["pipe", "pipe", "pipe"] });
  try {
    let buf = "";
    /** @type {Map<any, (m: any) => void>} */
    const waiting = new Map();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const m = JSON.parse(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        waiting.get(m.id)?.(m);
      }
    });
    let n = 0;
    const rpc = (/** @type {string} */ method, /** @type {any} */ params = {}) =>
      new Promise((resolve) => {
        const id = ++n;
        waiting.set(id, resolve);
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    // A modern client probes first; a legacy one says initialize.
    const d = /** @type {any} */ (await rpc("server/discover", { _meta: MODERN }));
    assert.deepEqual(d.result.supportedVersions, ["2026-07-28"]);
    const init = /** @type {any} */ (await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } }));
    assert.equal(init.result.serverInfo.name, "arcade");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const list = /** @type {any} */ (await rpc("tools/list"));
    assert.equal(list.result.tools.length, 8);
    assert.ok(list.result.tools.find((/** @type {any} */ t) => t.name === "publish_cart").inputSchema.properties.dir);
    const carts = /** @type {any} */ (await rpc("tools/call", { name: "list_carts", arguments: {} }));
    assert.equal(carts.result.structuredContent.carts[0].id, "penguin-catch");
    const status = /** @type {any} */ (await rpc("tools/call", { name: "cabinet_status", arguments: {} }));
    assert.equal(status.result.isError, false);
    const launch = /** @type {any} */ (await rpc("tools/call", { name: "launch_on_cabinet", arguments: { id: "penguin-catch" } }));
    assert.match(launch.result.content[0].text, /isn't listening/);
  } finally {
    child.stdin.end();
    await new Promise((r) => child.on("exit", r));
    await s.close();
  }
});

test("the studio server starts over stdio too", async () => {
  const child = spawn(process.execPath, [path.join(PLUGIN, "bin/run.mjs"), "studio"], { stdio: ["pipe", "pipe", "pipe"] });
  const line = new Promise((resolve) => child.stdout.once("data", (d) => resolve(JSON.parse(String(d).split("\n")[0]))));
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: MODERN } }) + "\n");
  const r = /** @type {any} */ (await line);
  assert.equal(r.result.tools.length, 6);
  child.stdin.end();
  await new Promise((res) => child.on("exit", res));
});
