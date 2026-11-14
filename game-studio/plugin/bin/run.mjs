#!/usr/bin/env node
// Starts one of the game-studio plugin's MCP servers (D347): `arcade` (the bridge to a cabinet) or `studio`.
// The plugin is only this folder, and Claude Code may run it from its own copy, so the code is found in the
// game-studio-arcade checkout: GSA_REPO, else the checkout this folder sits in, else ~/claude-home/game-studio-arcade.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const which = process.argv[2];
const entry = { arcade: "game-studio/src/arcade-bridge.js", studio: "game-studio/src/studio-server.js" }[which ?? ""];
if (!entry) {
  console.error("usage: run.mjs arcade|studio");
  process.exit(2);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = /** @type {string[]} */ ([process.env.GSA_REPO, path.resolve(here, "../../.."), path.join(os.homedir(), "claude-home/game-studio-arcade")].filter((d) => typeof d === "string" && d));
const repo = candidates.find((d) => fs.existsSync(path.join(d, entry)));
if (!repo) {
  console.error(`game-studio: can't find the game-studio-arcade checkout (looked in ${candidates.join(", ")}); set GSA_REPO`);
  process.exit(1);
}
const mod = await import(pathToFileURL(path.join(repo, entry)).href);
await mod.main();
