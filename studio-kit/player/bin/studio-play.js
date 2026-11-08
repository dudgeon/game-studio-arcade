#!/usr/bin/env node
// studio-play: the local player (phase-0 task 9, D70). Prints a URL; never opens a window.
//
//   studio-play [--port 8330] [--host 127.0.0.1] [--carts DIR] [--logs DIR] [--examples] [--checker G]
import { startPlayer } from "../src/server.js";

const USAGE = "usage: studio-play [--port 8330] [--host 127.0.0.1] [--carts DIR] [--logs DIR] [--examples] [--checker G]";

const args = process.argv.slice(2);
/** @type {import("../src/server.js").PlayerOptions & { port?: number, host?: string }} */
const opts = { port: Number(process.env.GSA_PLAYER_PORT) || 8330 };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const val = () => {
    const v = args[++i];
    if (v === undefined) {
      console.error(`${a} needs a value\n${USAGE}`);
      process.exit(2);
    }
    return v;
  };
  if (a === "--port") opts.port = Number(val());
  else if (a === "--host") opts.host = val();
  else if (a === "--carts") opts.libraryDir = val();
  else if (a === "--logs") opts.logsDir = val();
  else if (a === "--examples") opts.examples = true;
  else if (a === "--checker") opts.checker = val();
  else if (a === "-h" || a === "--help") {
    console.log(USAGE);
    process.exit(0);
  } else {
    console.error(`unknown argument ${a}\n${USAGE}`);
    process.exit(2);
  }
}

const s = await startPlayer(opts);
console.log(`player at ${s.url}/`);
