#!/usr/bin/env node
// @ts-check
// The cabinet's Wi-Fi helper, as root (D410-D416). The logic is in ../src/wifi.js.
//
//   arcade-wifi.js watch     runs for ever: puts back lost networks, brings a lost Wi-Fi back (arcade-wifi-watch.service)
//   arcade-wifi.js serve     one request on stdin, one JSON line out: systemd starts it per connection to
//                            /run/arcade-wifi.sock, which only the cabinet service's user may open
//   arcade-wifi.js adopt     keep the Wi-Fi the card brought as one of ours (provisioning runs it)
//   arcade-wifi.js status    where the Wi-Fi stands, as JSON
//
// A request is one line of JSON: {"op":"status"}, {"op":"scan"}, or {"op":"join","ssid":"...","password":"...",
// "security":"WPA2"}. A password is never logged.
import readline from "node:readline";
import { createWifi, freshWatch, watchRound } from "../src/wifi.js";

const log = (/** @type {string} */ m) => console.error(`arcade-wifi ${m}`);
const wifi = createWifi({ log });
const cmd = process.argv[2];

if (cmd === "watch") {
  const every = Number(process.env.ARCADE_WIFI_EVERY_S ?? 15) * 1000;
  /** @type {Parameters<typeof watchRound>[1]} */
  let state = freshWatch();
  log("watching");
  for (;;) {
    try {
      // ARCADE_WIFI_IGNORE_CABLE is for the rehearsal only, whose VM is always on a cable (D511).
      state = await watchRound(wifi, state, { ignoreCable: process.env.ARCADE_WIFI_IGNORE_CABLE === "1" });
    } catch (e) {
      log(`round failed: ${/** @type {Error} */ (e).message}`);
    }
    await new Promise((r) => setTimeout(r, every));
  }
} else if (cmd === "serve") {
  const rl = readline.createInterface({ input: process.stdin });
  const line = await new Promise((resolve) => {
    rl.once("line", resolve);
    rl.once("close", () => resolve(""));
  });
  /** @type {any} */
  let out;
  try {
    const q = JSON.parse(String(line));
    if (q.op === "status") out = { ok: true, ...(await wifi.status()) };
    else if (q.op === "scan") out = await wifi.scan();
    else if (q.op === "join") out = await wifi.join({ ssid: q.ssid, password: q.password ?? null, security: q.security });
    else out = { ok: false, why: "unknown request" };
  } catch (e) {
    out = { ok: false, why: "The cabinet's Wi-Fi helper hit a problem." };
    log(`request failed: ${/** @type {Error} */ (e).message}`);
  }
  process.stdout.write(`${JSON.stringify(out)}\n`, () => process.exit(0));
} else if (cmd === "adopt") {
  const n = await wifi.adopt();
  await wifi.restore();
  log(n ? `adopted ${n}` : "nothing to adopt");
} else if (cmd === "status") {
  console.log(JSON.stringify({ ...(await wifi.status()), saved: wifi.known().map((k) => k.ssid) }));
} else {
  console.error("usage: arcade-wifi.js watch|serve|adopt|status");
  process.exit(2);
}
