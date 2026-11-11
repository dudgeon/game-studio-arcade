// Runs on the virtual cabinet: reads what the kiosk's launcher is showing, through Chromium's
// DevTools port (127.0.0.1 only, virtual profile only, D154). It only reads. Keys go in through uinput.
//
//   node launcher.mjs state                    screen, phase, sel, Studio phase, boxes, faults as JSON
//   node launcher.mjs wait SCREEN [PHASE] [MS] wait for that screen (default 180 s); exit 1 if it never comes
//   node launcher.mjs say [ID]                 feed the speech stub the text on stdin (D184), once for each ID (D195)
//   node launcher.mjs errors                   print page errors as they happen, until killed
import fs from "node:fs";

const DEVTOOLS = "http://127.0.0.1:9222";
const SERVICE = "http://127.0.0.1:8330";

async function connect() {
  const targets = await (await fetch(`${DEVTOOLS}/json`)).json();
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(SERVICE));
  if (!page) throw new Error(`no launcher page among: ${targets.map((t) => t.url).join(", ")}`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("can't open the DevTools socket"));
  });
  let next = 1;
  const waiting = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = next++;
      waiting.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ws, send, listeners };
}

const READ = `(() => {
  const l = window.launcher;
  if (!l) return null;
  return JSON.stringify({ screen: l.screen(), board: l.board ? l.board() : null, phase: l.phase(), sel: l.sel(), studio: l.studio().phase, boxes: l.boxes(), faults: l.faults() });
})()`;

async function read(c) {
  const r = await c.send("Runtime.evaluate", { expression: READ, returnByValue: true });
  const v = r.result?.result?.value;
  return v ? JSON.parse(v) : null;
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "say") {
  const mark = args[0] ? `/tmp/arcade-say-${args[0].replace(/[^A-Za-z0-9]/g, "")}` : null;
  if (mark && fs.existsSync(mark)) process.exit(0);
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  const r = await fetch(`${SERVICE}/api/speech/feed`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text.trim() }) });
  if (!r.ok) {
    console.error(`say: ${await r.text()}`);
    process.exit(1);
  }
  if (mark) fs.writeFileSync(mark, "");
  process.exit(0);
}

const c = await connect();
if (cmd === "state") {
  console.log(JSON.stringify(await read(c)));
  process.exit(0);
}
if (cmd === "wait") {
  const [screen, phase, ms] = args;
  const deadline = Date.now() + Number(ms || 180000);
  let at = null;
  while (Date.now() < deadline) {
    at = await read(c);
    // A screen name or a board id (M3, R6...: D212), as drive.js waits.
    if (at && (at.screen === screen || at.board === screen) && (!phase || phase === "-" || at.phase === phase)) process.exit(0);
    await new Promise((r) => setTimeout(r, 40));
  }
  console.error(`timed out waiting for ${screen} ${phase ?? ""}: on ${at?.screen} ${at?.board ?? ""} ${at?.phase ?? ""} (Studio: ${at?.studio})`);
  process.exit(1);
}
if (cmd === "errors") {
  c.listeners.push((m) => {
    if (m.method === "Runtime.exceptionThrown") console.log(`page error: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") console.log(`console error: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  });
  await c.send("Runtime.enable");
  await new Promise(() => {});
}
console.error("usage: launcher.mjs state | wait SCREEN [PHASE] [MS] | say | errors");
process.exit(2);
