// The Cabinet Manager's page (D280-D286). Plain browser JavaScript, no libraries.
const $ = (s) => document.querySelector(s);
const viewer = Math.random().toString(36).slice(2) + Date.now().toString(36);
let cabinet = "";
let controls = [];
let source = null;
let lastFrameAt = 0;
let status = null;
let view = "screen";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let timeZone; // the house's, from the Manager; until it's known, the device's
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const dollars = (c) => (c == null ? "?" : `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toFixed(2)}`);
const secs = (ms) => (ms < 10000 ? `${(ms / 1000).toFixed(1)} s` : ms < 120000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60000)} min`);

async function api(method, path, body) {
  const r = await fetch(`/api/c/${cabinet}${path}`, { method, headers: { "Content-Type": "application/json", "X-Manager": "1" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), j, { status: r.status });
  return j;
}

// ---- Screen (D281) ----
function watch() {
  source?.close();
  lastFrameAt = 0;
  $("#shot").removeAttribute("src");
  $("#noshot").hidden = false;
  $("#noshot").textContent = "Waiting for the first picture…";
  source = new EventSource(`/api/c/${cabinet}/screen?viewer=${viewer}`);
  source.addEventListener("frame", (e) => {
    const f = JSON.parse(e.data);
    $("#shot").src = `data:image/png;base64,${f.png}`;
    $("#noshot").hidden = true;
    lastFrameAt = f.at;
  });
  source.addEventListener("status", (e) => {
    status = JSON.parse(e.data);
    drivable();
    backupLine();
  });
}

/** "Last backup" for the Picade (D353): a warning when the newest copy is over a day old while it's on. */
function backupLine() {
  const el = $("#backup");
  const b = status && status.backup;
  el.hidden = !b;
  if (!b) return;
  el.className = `backup ${b.state}`;
  el.textContent = b.text;
}

function freshness() {
  const el = $("#fresh");
  if (!status) return;
  if (status.problem && (!lastFrameAt || status.stale)) {
    el.className = "fresh down";
    el.textContent = `No live picture: ${status.problem}${lastFrameAt ? ` (last one ${secs(Date.now() - lastFrameAt)} ago)` : ""}`;
    if (!lastFrameAt) $("#noshot").textContent = status.problem;
    return;
  }
  if (status.frame_age_ms == null) return;
  const age = status.frame_age_ms;
  el.className = `fresh${status.stale ? " stale" : ""}`;
  el.textContent = `${status.stale ? "Picture may be old: " : "Live: "}checked ${secs(age)} ago · last changed ${secs(status.changed_ago_ms)} ago · ${status.host}`;
}
setInterval(() => {
  if (status && status.frame_age_ms != null) {
    status.frame_age_ms += 250;
    status.changed_ago_ms += 250;
    status.stale = status.frame_age_ms > 3000;
  }
  freshness();
}, 250);

function drivable() {
  const off = status && status.can_drive === false;
  $("#pad").classList.toggle("off", Boolean(off));
  $("#drivenote").textContent = off ? "This cabinet's driver keyboard is off (D287): watch here and use its own controls, or switch it on from the mini with scripts/cabinet-card/driver-keyboard.sh on." : "";
}

// ---- Keys (D282) ----
const down = new Set();
function send(how, code) {
  if (how === "down") {
    if (down.has(code)) return;
    down.add(code);
  } else {
    if (!down.has(code)) return;
    down.delete(code);
  }
  for (const b of document.querySelectorAll(".pad button")) {
    const c = controls.find((x) => x.id === b.dataset.c);
    if (c && c.code === code) b.classList.toggle("down-now", how === "down");
  }
  api("POST", "/keys", { how, codes: [code], viewer }).catch((e) => {
    $("#drivenote").textContent = e.message;
  });
}
function releaseAll() {
  for (const code of [...down]) send("up", code);
}

const display = $("#display");
display.addEventListener("keydown", (e) => {
  if (e.metaKey) return;
  e.preventDefault();
  if (!e.repeat) send("down", e.code);
});
display.addEventListener("keyup", (e) => {
  e.preventDefault();
  send("up", e.code);
});
display.addEventListener("blur", releaseAll);
window.addEventListener("blur", releaseAll);
display.addEventListener("pointerdown", () => display.focus());

for (const b of document.querySelectorAll(".pad button")) {
  const code = () => controls.find((x) => x.id === b.dataset.c)?.code;
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    if (code()) send("down", code());
  });
  const up = () => code() && send("up", code());
  b.addEventListener("pointerup", up);
  b.addEventListener("pointercancel", up);
  b.addEventListener("contextmenu", (e) => e.preventDefault());
}

// ---- Activity (D283) ----
async function loadActivity() {
  $("#actnote").textContent = "Reading the cabinet's logs…";
  try {
    const a = await api("GET", "/activity");
    $("#actnote").textContent = `Read from the cabinet just now. ${a.makes.length} makes, ${a.plays.length} plays.`;
    const n = a.now;
    $("#now").innerHTML = n && n.phase && n.phase !== "idle"
      ? `<h2>Now</h2><div class="make"><div class="top"><span class="who">${esc(n.maker_name ?? n.maker ?? "")}</span><span class="tag">${n.kind === "change" ? `change of ${esc(n.parent)}` : esc(n.kind ?? n.phase)}</span><span class="tag">${esc(n.phase)}</span>${n.used_cents != null ? `<span>${dollars(n.used_cents)} so far</span>` : ""}</div>${n.pending?.question ? `<div class="said">Waiting on: ${esc(n.pending.question)}</div>` : ""}${(n.lines ?? []).length ? `<div class="hint">${esc(n.lines.at(-1))}</div>` : ""}</div>`
      : "";
    $("#makes").innerHTML = a.makes.length ? a.makes.map(make).join("") : "<p class=hint>No makes yet.</p>";
    $("#screened").innerHTML = a.screened.length
      ? a.screened.map((s) => `<div class="make"><div class="top"><span class="who">${esc(s.who)}</span><span class="hint">${when(s.at)}</span><span class="tag">${esc(s.verdict ?? s.log)}</span></div><div class="said">“${esc(s.said)}”</div>${s.offered ? `<div class="hint">Offered instead: ${esc(s.offered)}</div>` : ""}</div>`).join("")
      : "<p class=hint>None. (Screening's log appears here when the cabinet has one.)</p>";
    $("#gameai").innerHTML = gameAi(a.ai);
    $("#gametalk").innerHTML = gameTalk(a.talk ?? []);
    $("#plays").innerHTML = `<tr><th>When</th><th>Game</th><th>Made by</th><th class=n>Seconds</th><th class=n>Score</th><th>Ended</th></tr>` +
      a.plays.slice(0, 100).map((p) => `<tr><td>${when(p.at)}</td><td>${esc(p.game)} <span class=hint>${versionLabel(p)}${p.guest ? " · guest" : ""}</span></td><td>${esc(p.made_by ?? "")}</td><td class=n>${esc(p.seconds)}</td><td class=n>${esc(p.score ?? "")}</td><td>${esc(p.ended ?? "")}${p.errors ? ` <span class=bad>${esc(p.errors)} errors</span>` : ""}</td></tr>`).join("");
  } catch (e) {
    $("#actnote").innerHTML = `<span class=bad>${esc(e.message)}</span>`;
  }
}
// AI in games (D488): paid outside the coin pot with no cap, so this is where its cost shows. Sums are the cabinet's.
function gameAi(ai) {
  if (!ai) return "<p class=hint>This cabinet's software doesn't have AI in games yet.</p>";
  const usd = (n) => (n > 0 && n < 0.01 ? "under $0.01" : `$${Number(n ?? 0).toFixed(2)}`);
  const head = `<p>${esc(ai.month)}: <b>${usd(ai.month_cost_usd)}</b> for ${esc(ai.month_calls)} calls. All time: ${usd(ai.cost_usd)} for ${esc(ai.calls)} calls. <span class=hint>Outside the coin pot, no cap.${ai.on ? "" : " Switched off, or no key: games use their own lines."}</span></p>`;
  const trips = ai.trips.length ? `<p class=bad>The loop guard stopped a game ${ai.trips.length} time${ai.trips.length === 1 ? "" : "s"}: ${ai.trips.slice(-5).map((t) => `${esc(t.game)} (${when(t.at)})`).join(", ")}</p>` : "";
  if (!ai.games.length) return `${head}<p class=hint>No game has asked yet.</p>`;
  return `${head}${trips}<table><tr><th>Game</th><th class=n>Calls this month</th><th class=n>Cost this month</th><th class=n>Calls ever</th><th class=n>Cost ever</th><th>Last</th><th></th></tr>${ai.games.map((g) => `<tr><td>${esc(g.game)}</td><td class=n>${esc(g.month_calls)}</td><td class=n>${usd(g.month_cost_usd)}</td><td class=n>${esc(g.calls)}</td><td class=n>${usd(g.cost_usd)}</td><td>${when(g.last)}</td><td>${g.errors ? `<span class=hint>${esc(g.errors)} failed</span> ` : ""}${g.dropped ? `<span class=hint>${esc(g.dropped)} lines dropped</span> ` : ""}${g.trips ? `<span class=bad>guard ×${esc(g.trips)}</span>` : ""}</td></tr>`).join("")}</table>`;
}
// What was said into the mic during games (D489): every voice action and chat turn, newest first.
const TALK_OUTCOME = { heard: "", said: "", none: "no action fitted", steered: "off-limits words: nothing sent on", held: "the reply was held back", judge_failed: "the check didn't answer, so the reply was held back", reply_failed: "no reply came", off: "chat is switched off", flagged: "flagged: worth a look" };
function gameTalk(rows) {
  if (!rows.length) return "<p class=hint>Nothing yet. Every voice action and chat turn in a game shows here.</p>";
  return rows.slice(0, 200).map((t) => {
    const how = t.outcome?.startsWith("by_word") ? "matched by word, no model" : t.outcome?.startsWith("no_model") ? "no model to ask: the game's own line" : (TALK_OUTCOME[t.outcome] ?? t.outcome ?? "");
    const loud = t.outcome === "steered" || t.outcome === "held" || t.outcome === "flagged" || t.outcome === "judge_failed";
    return `<div class="make"><div class="top"><span class="who">${esc(t.game)}</span><span class="hint">v${esc(t.version)} · ${when(t.at)}</span><span class="tag">${esc(t.kind)}${t.ask ? `: ${esc(t.ask)}` : ""}</span>${how ? `<span class="${loud ? "bad" : "hint"}">${esc(how)}</span>` : ""}</div><div class="said">“${esc(t.said)}”</div>${t.reply ? `<div class="hint">The character said: ${esc(t.reply)}</div>` : t.kind === "chat" ? `<div class="hint">The character said one of the game's own lines.</div>` : ""}${t.held ? `<div class="bad">Held back, not shown: ${esc(t.held)}${t.why ? ` (${esc(t.why)})` : ""}</div>` : ""}${t.action ? `<div class="hint">The game did: ${esc(t.action)}</div>` : ""}</div>`;
  }).join("");
}
function make(m) {
  const ok = m.outcome === "committed";
  const answers = m.answers.map((t) => `<li>${esc(t.question)} <span class=hint>A: ${esc(t.a)} · B: ${esc(t.b)}</span> → <span class=pick>${esc(t.choice)}${t.choice === "A" ? ` (${esc(t.a)})` : t.choice === "B" ? ` (${esc(t.b)})` : t.choice === "D" ? " (Make it now)" : ""}${t.said ? `: “${esc(t.said)}”` : ""}</span></li>`).join("");
  // A desktop publish (D343, D345): made in Claude Code at the desk, no coins, and its line is Geoff's summary, not a kid's words.
  const desk = m.origin === "desktop";
  return `<div class="make"><div class="top"><span class="who">${esc(m.who)}${m.with ? ` with ${esc(m.with)}` : ""}</span>${desk ? `<span class="tag">made at the desk</span>` : ""}<span class="tag">${m.kind === "change" ? `change of ${esc(m.parent)}` : "new game"}</span><span class="hint">${when(m.at)}${m.minutes != null ? ` · ${m.minutes} min` : ""}</span><span class="tag ${ok ? "ok" : "no"}">${esc(m.kid_outcome ?? m.outcome)}</span>${m.cart ? `<span class="hint">${esc(m.cart.id)} ${versionLabel(m.cart)}</span>` : ""}<span>${desk ? "no coins (Claude Code on the mini)" : `${m.coins != null ? `${m.coins} coin${m.coins === 1 ? "" : "s"}` : ""} · ${dollars(m.cents)}${m.charged ? "" : " <span class=hint>(not charged)</span>"}`}</span></div><div class="said">${desk ? `Summary: ${esc(m.said)}` : `“${esc(m.said)}”`}</div>${answers ? `<ol>${answers}</ol>` : ""}<div class="hint">Ended by ${esc(m.ended_by ?? "?")}${m.errors ? ` · <span class=bad>${m.errors} errors</span>` : ""}${m.plays ? ` · played ${m.plays}×` : ""}${m.restarted ? " · survived a service restart and was collected after it" : ""}${gateLine(m.gate)}${m.corrections.filter((c) => !(m.restarted && /restart/.test(c.why ?? ""))).map((c) => ` · ${esc(c.why)}`).join("")}</div></div>`;
}
$("#reload").addEventListener("click", loadActivity);

// ---- Coins (D284) ----
async function loadPot(keepMessage = false) {
  $("#pair").hidden = true;
  if (!keepMessage) $("#coinmsg").textContent = "";
  try {
    const v = await api("GET", "/pot");
    const p = v.pot;
    $("#pot").innerHTML = `<div class="card"><div><div class="potbig">${esc(p.coins)} coins</div><div class="hint">${dollars(p.cents)} of ${esc(p.full_coins)} coins · fills back up on ${esc(p.refill_on)} · this month ${dollars(p.spent_cents)} spent${p.added_cents ? `, ${dollars(p.added_cents)} added` : ""}</div>${p.makers.map((m) => `<div>${esc(m.name)}: ${esc(m.coins)} coins, ${esc(m.makes)} make${m.makes === 1 ? "" : "s"}</div>`).join("")}</div></div>`;
    $("#ledger").innerHTML = `<tr><th>When</th><th>Who</th><th>What</th><th class=n>Pot after</th></tr>` +
      v.history.slice(0, 60).map((e) => `<tr><td>${when(e.at)}</td><td>${esc(e.kind === "charge" ? (e.name ?? e.who) : e.kind === "refill" ? "the 1st" : `grown-up${e.by ? ` (${e.by})` : ""}`)}</td><td>${esc(e.kind === "charge" ? `${e.what}, ${e.cost_cents}c, ${e.outcome}` : e.kind === "topup" ? `added ${Math.round(e.cents / 10)} coin${Math.round(e.cents / 10) === 1 ? "" : "s"}: "${e.reason}"` : e.kind === "reset" ? `reset to 100: "${e.reason}"` : "refilled to 100")}</td><td class=n>${Math.round(e.pot_after_cents / 10)}</td></tr>`).join("");
  } catch (e) {
    if (e.unpaired) $("#pair").hidden = false;
    $("#pot").innerHTML = `<p class=bad>${esc(e.message)}</p>`;
    $("#ledger").innerHTML = "";
  }
}
let confirmFor = null;
$("#topup").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = { coins: Number(f.get("coins")), reason: String(f.get("reason")) };
  const key = JSON.stringify(body);
  try {
    const r = await api("POST", "/pot/topup", { ...body, confirm: confirmFor === key });
    if (r.needs_confirm) {
      confirmFor = key;
      $("#warn").hidden = false;
      $("#warn").textContent = `${r.warning} Press Add again to add them anyway.`;
      return;
    }
    confirmFor = null;
    $("#warn").hidden = true;
    $("#coinmsg").textContent = `Added ${body.coins} coin${body.coins === 1 ? "" : "s"}: “${body.reason}”.`;
    loadPot(true);
  } catch (err) {
    $("#coinmsg").innerHTML = `<span class=bad>${esc(err.message)}</span>`;
  }
});
$("#topup").addEventListener("input", () => {
  confirmFor = null;
  $("#warn").hidden = true;
});
$("#reset").addEventListener("submit", async (e) => {
  e.preventDefault();
  const reason = String(new FormData(e.target).get("reason"));
  try {
    await api("POST", "/pot/reset", { reason });
    $("#coinmsg").textContent = `Reset to 100 coins: “${reason}”.`;
    loadPot(true);
  } catch (err) {
    $("#coinmsg").innerHTML = `<span class=bad>${esc(err.message)}</span>`;
  }
});
$("#pairbtn").addEventListener("click", async () => {
  try {
    await api("POST", "/pair");
    loadPot();
  } catch (err) {
    $("#coinmsg").innerHTML = `<span class=bad>${esc(err.message)}</span>`;
  }
});

// ---- Software: update the cabinet (D338) ----
let updateTimer = null;
async function loadSoftware() {
  clearTimeout(updateTimer);
  let s;
  try {
    s = await api("GET", "/update");
  } catch (err) {
    $("#versions").innerHTML = `<p class=bad>${esc(err.message)}</p>`;
    $("#update").hidden = true;
    return;
  }
  $("#update").hidden = false;
  const c = s.cabinet ?? {};
  const same = c.commit && s.checkout && c.commit.startsWith(s.checkout);
  $("#versions").innerHTML = `<h2>Versions</h2>
    <div>On the cabinet: <b>${esc(c.version ?? (c.reachable ? "unknown" : "can't reach it"))}</b>${c.commit ? ` <span class=hint>(commit ${esc(c.commit)})</span>` : ""}</div>
    <div>On the mini: <b>commit ${esc(s.checkout)}</b> ${same ? `<span class="tag ok">same</span>` : c.commit ? `<span class=tag>newer or different</span>` : ""}</div>`;
  $("#updatebtn").disabled = s.running;
  $("#updatebtn").textContent = s.running ? "Updating…" : "Update";
  const r = s.result;
  $("#updatemsg").innerHTML = s.running
    ? `Updating since ${esc(when(s.started_at))}${s.os ? ", with OS packages" : ""}. You can leave this page; it carries on.`
    : s.ok === true
      ? `<span class=tag ok>updated</span> ${esc(when(s.ended_at))}${r?.os ? ` · ${esc(r.os.changed)} OS packages` : ""}${r?.restart_wanted ? " · some of it takes effect at the cabinet's next restart" : ""}`
      : s.ok === false
        ? `<span class="tag no">not updated</span> ${esc(when(s.ended_at))}: ${esc(r?.reason ?? s.lines.filter((l) => /Stopped/.test(l)).at(-1) ?? "see below")}${r?.rolled_back ? " It went back to what it had." : ""}`
        : "";
  $("#updatelog").hidden = !s.lines.length;
  $("#updatelog").textContent = s.lines.join("\n");
  if (s.running && view === "software") updateTimer = setTimeout(loadSoftware, 3000);
}
$("#update").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("POST", "/update", { os: e.target.os.checked });
  } catch (err) {
    $("#updatemsg").innerHTML = `<span class=bad>${esc(err.message)}</span>`;
    return;
  }
  loadSoftware();
});

// ---- Games and makers: off the shelf, kept in the records (D360-D364) ----
// A version by its name with its number, or just the number for one with no name (D474): "Faster logs (v3)", "v2".
const versionLabel = (c) => (c.version_name ? `${esc(c.version_name)} (v${esc(c.version)})` : `v${esc(c.version)}`);

let confirmRemove = null;
async function loadGames() {
  $("#gamesnote").textContent = "Reading the cabinet's library…";
  try {
    const [g, m] = await Promise.all([api("GET", "/games"), api("GET", "/makers")]);
    const on = g.games.filter((x) => x.on_shelf).length;
    $("#gamesnote").textContent = `${g.games.length} games: ${on} on the shelf, ${g.games.length - on} off.`;
    $("#gamelist").innerHTML = `<tr><th>Game</th><th>Made by</th><th class=n>Versions</th><th>Last played</th><th>On the shelf</th><th></th></tr>` +
      g.games.map((x) => {
        const from = x.from ? `<div class=hint>a version of ${esc(x.from)}${x.from_off ? " (that one's off the shelf, so this shows as its own game)" : ""}</div>` : "";
        const state = x.on_shelf ? `<span class="tag ok">on</span>` : `<span class="tag no">off</span> <span class=hint>${when(x.off.at)}${x.off.by ? ` by ${esc(x.off.by)}` : ""}${x.off.via && x.off.via !== "manager" ? ` (${esc(x.off.via)})` : ""}${x.off.reason ? `: ${esc(x.off.reason)}` : ""}</span>`;
        const action = x.on_shelf
          ? confirmRemove === x.id
            ? `<button class="danger" data-act="remove" data-id="${esc(x.id)}">Remove ${x.versions > 1 ? `all ${x.versions} versions` : "it"}</button> <button data-act="cancel">Keep</button>`
            : `<button data-act="ask" data-id="${esc(x.id)}">Remove from shelf</button>`
          : `<button data-act="restore" data-id="${esc(x.id)}">Put back</button>`;
        return `<tr><td><b>${esc(x.title)}</b> <span class=hint>${esc(x.id)}</span>${from}</td><td>${esc(x.maker_name ?? "starter")}</td><td class=n>${esc(x.versions)}${x.newest?.version_name ? `<div class=hint>newest: ${versionLabel(x.newest)}</div>` : ""}</td><td>${x.last_played ? `${when(x.last_played)} <span class=hint>(${esc(x.plays)}×)</span>` : "<span class=hint>never</span>"}</td><td>${state}</td><td>${action}</td></tr>`;
      }).join("");
    $("#makerlist").innerHTML = `<tr><th>Name</th><th>On the list</th><th></th></tr>` +
      m.makers.map((x) => {
        const why = x.grown_up ? "grown-up (never on the kids' list)" : x.hidden ? "hidden in makers.json" : "";
        const state = x.off ? `<span class="tag no">hidden</span> <span class=hint>${when(x.off.at)}${x.off.reason ? `: ${esc(x.off.reason)}` : ""}</span>` : why ? `<span class=hint>${esc(why)}</span>` : `<span class="tag ok">on</span>`;
        const action = x.grown_up || x.hidden ? "" : x.off ? `<button data-act="show" data-id="${esc(x.id)}">Put back</button>` : `<button data-act="hide" data-id="${esc(x.id)}">Hide name</button>`;
        return `<tr><td>${esc(x.name)} <span class=hint>${esc(x.id)}</span></td><td>${state}</td><td>${action}</td></tr>`;
      }).join("");
    $("#shelfhistory").innerHTML = g.history.length
      ? `<tr><th>When</th><th>What</th><th>Who</th><th>Why</th></tr>` + g.history.map((h) => `<tr><td>${when(h.at)}</td><td>${esc(h.kind === "game" ? (h.action === "remove" ? "game off the shelf" : "game put back") : h.action === "remove" ? "name hidden" : "name put back")}: ${esc(h.target)}</td><td>${esc(h.by ?? "")}${h.via ? ` <span class=hint>${esc(h.via)}</span>` : ""}</td><td>${esc(h.reason ?? "")}</td></tr>`).join("")
      : `<tr><td class=hint>Nothing has been taken off yet.</td></tr>`;
  } catch (e) {
    $("#gamesnote").innerHTML = `<span class=bad>${esc(e.status === 501 ? "This cabinet's software is older than the Games page: update it from the Software tab." : e.message)}</span>`;
  }
}
$("#games").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const { act, id } = b.dataset;
  if (act === "ask") { confirmRemove = id; return loadGames(); }
  if (act === "cancel") { confirmRemove = null; return loadGames(); }
  const path = { remove: "/games/remove", restore: "/games/restore", hide: "/makers/hide", show: "/makers/show" }[act];
  if (!path) return;
  b.disabled = true;
  try {
    await api("POST", path, { id });
  } catch (err) {
    $("#gamesnote").innerHTML = `<span class=bad>${esc(err.message)}</span>`;
  }
  confirmRemove = null;
  loadGames();
});
$("#gamesreload").addEventListener("click", loadGames);

// ---- Health, the speaker, restart and switch off (D365-D367) ----
const ago = (s) => (s == null ? "?" : s < 3600 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} days`);
async function loadHealth() {
  $("#healthnote").textContent = "Asking the cabinet…";
  try {
    const { health: h, warnings, checked_at } = await api("GET", "/health");
    $("#healthnote").textContent = `Checked ${when(checked_at)}.`;
    $("#healthwarn").innerHTML = warnings.length
      ? warnings.map((w) => `<p class="hw ${w.level}">${esc(w.text)}</p>`).join("")
      : `<p class="hw ok">Nothing to worry about.</p>`;
    const row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
    const disk = (d) => (d ? `${(d.free_mb / 1024).toFixed(1)} GB free of ${(d.total_mb / 1024).toFixed(1)} GB (${d.free_pct}%)` : "—");
    $("#healthcard").innerHTML = `<table class="kv">${[
      row("CPU", h.cpu_temp_c == null ? "<span class=hint>no temperature here (a VM)</span>" : `${h.cpu_temp_c.toFixed(1)} °C`),
      row("Throttling", h.throttled == null ? "<span class=hint>no answer here (a VM)</span>" : h.throttled.now.length ? `<span class=bad>now: ${esc(h.throttled.now.join(", "))}</span>` : h.throttled.since_boot.length ? `since it started: ${esc(h.throttled.since_boot.join(", "))}` : "none"),
      row("Wi-Fi", h.wifi ? `${esc(h.wifi.ssid)}: ${esc(h.wifi.signal)}%${h.wifi.dbm != null ? ` (${esc(h.wifi.dbm)} dBm)` : ""}, ${esc(h.wifi.band ?? "?")}` : "<span class=hint>not on Wi-Fi (the virtual cabinet uses the mini's network)</span>"),
      row("Disk", disk(h.disk?.root)),
      row("Boot partition", disk(h.disk?.boot)),
      row("Up for", ago(h.uptime_s)),
      row("Software", `${esc(h.version ?? "?")}${h.release && h.release !== h.version ? ` <span class=hint>(${esc(h.release)})</span>` : ""}, ${esc(h.profile ?? "?")} profile`),
      row("Services", Object.entries(h.services ?? {}).map(([s, v]) => `${esc(s)}: ${v === "active" ? "running" : `<span class=bad>${esc(v)}</span>`}`).join(" · ")),
    ].join("")}</table>`;
    $("#journal").textContent = h.journal?.length ? h.journal.join("\n") : "None lately.";
  } catch (e) {
    $("#healthnote").innerHTML = `<span class=bad>${esc(e.message)}</span>`;
  }
  try {
    const v = await api("GET", "/volume");
    const s = $("#volume");
    if (!v.speaker) {
      s.disabled = true;
      $("#volumeval").textContent = "no speaker";
      $("#volumenote").textContent = cabinet === "virtual" ? "The virtual cabinet has no sound card." : "No speaker found: is the X HAT's sound card up?";
    } else {
      s.disabled = false;
      s.value = String(v.percent ?? 0);
      volumeShown(v.percent);
    }
  } catch (e) {
    $("#volumenote").innerHTML = `<span class=bad>${esc(e.message)}</span>`;
  }
}
function volumeShown(p) {
  $("#volumeval").textContent = p == null ? "—" : `${p}%`;
  $("#volumenote").innerHTML = p > 80 ? `<span class=warnt>Loud: Pimoroni warns 100% is a bit much for the Picade's speaker.</span> Kept across restarts.` : "Kept across restarts. Pimoroni warns 100% is a bit much.";
}
$("#volume").addEventListener("input", (e) => volumeShown(Number(e.target.value)));
$("#volume").addEventListener("change", async (e) => {
  try {
    const v = await api("POST", "/volume", { percent: Number(e.target.value) });
    volumeShown(v.percent);
  } catch (err) {
    $("#volumenote").innerHTML = `<span class=bad>${esc(err.message)}</span>`;
  }
});
const POWER = {
  "restart-shelf": { ask: "Restart the shelf? The screen goes dark for about 10 seconds.", yes: "Restart the shelf" },
  reboot: { ask: "Restart the cabinet? It's back on the shelf in about a minute.", yes: "Restart the cabinet" },
  poweroff: { ask: "Switch the cabinet off?", yes: "Switch off" },
};
$("#power").addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  const box = $("#powerconfirm");
  if (b.dataset.power) {
    const p = POWER[b.dataset.power];
    const back = b.dataset.power === "poweroff" ? (cabinet === "virtual" ? " It comes back only with scripts/virtual-cabinet/up.sh on the mini." : " It comes back only with its power switch, at the cabinet.") : "";
    box.hidden = false;
    box.innerHTML = `${esc(p.ask + back)} <button class="danger" data-go="${b.dataset.power}">${esc(p.yes)}</button> <button data-go="">Cancel</button>`;
    return;
  }
  if (b.dataset.go === undefined) return;
  box.hidden = true;
  if (!b.dataset.go) return;
  $("#powermsg").textContent = "Asking the cabinet…";
  try {
    await api("POST", "/power", { action: b.dataset.go, confirm: true });
    $("#powermsg").textContent = { "restart-shelf": "The shelf is restarting.", reboot: "The cabinet is restarting.", poweroff: "The cabinet is switching off." }[b.dataset.go];
  } catch (err) {
    $("#powermsg").innerHTML = `<span class=bad>${esc(err.message)}</span>`;
  }
});
$("#healthreload").addEventListener("click", loadHealth);

// ---- Views and the cabinet picker (D286) ----
function show(v) {
  view = v;
  for (const b of document.querySelectorAll("nav button")) b.classList.toggle("on", b.dataset.view === v);
  for (const s of document.querySelectorAll(".view")) s.classList.toggle("on", s.id === v);
  if (v === "activity") loadActivity();
  if (v === "coins") loadPot();
  if (v === "software") loadSoftware();
  if (v === "games") loadGames();
  if (v === "health") { $("#powerconfirm").hidden = true; $("#powermsg").textContent = ""; loadHealth(); }
  try { localStorage.setItem("gsa-view", v); } catch {}
}
for (const b of document.querySelectorAll("nav button")) b.addEventListener("click", () => show(b.dataset.view));
$("#cabinet").addEventListener("change", (e) => {
  releaseAll();
  cabinet = e.target.value;
  status = null;
  try { localStorage.setItem("gsa-cabinet", cabinet); } catch {}
  watch();
  show(view);
});

(async () => {
  const r = await fetch("/api/cabinets");
  const j = await r.json();
  controls = j.controls;
  timeZone = j.time_zone || undefined;
  let saved = "", savedView = "screen";
  try { saved = localStorage.getItem("gsa-cabinet") || ""; savedView = localStorage.getItem("gsa-view") || "screen"; } catch {}
  $("#cabinet").innerHTML = j.cabinets.map((c) => `<option value="${esc(c.name)}">${esc(c.label)}</option>`).join("");
  cabinet = j.cabinets.some((c) => c.name === saved) ? saved : j.cabinets[0].name;
  $("#cabinet").value = cabinet;
  watch();
  show(savedView);
})();

/** The publish gate's run on a make (D310): passed, or why the game was kept off the shelf. */
function gateLine(g) {
  if (!g) return "";
  const where = `${esc(g.host ?? "?")}${g.driver === "node" ? ", node driver (no Chromium)" : ""}`;
  const waited = g.waited_s ? `, after ${g.waited_s} s waiting for a game to end` : "";
  const slow = (g.advisory ?? []).map((a) => (a.id === "glide" ? `; warning, not blocking: ${esc(a.reason ?? "")}` : `; frame time over the uncalibrated budget, not blocking: ${esc(a.reason ?? "")}`)).join("");
  if (g.ok) return ` · cabinet re-test passed in ${esc(g.seconds)} s (${where}${waited}${slow})`;
  return ` · <span class=bad>cabinet re-test kept it off the shelf</span> (${where}): ${g.failing.map((f) => `${esc(f.id)}: ${esc(f.reason ?? "")}`).join("; ")}`;
}
