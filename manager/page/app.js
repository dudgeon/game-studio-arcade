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
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const dollars = (c) => (c == null ? "?" : `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toFixed(2)}`);
const secs = (ms) => (ms < 10000 ? `${(ms / 1000).toFixed(1)} s` : ms < 120000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60000)} min`);

async function api(method, path, body) {
  const r = await fetch(`/api/c/${cabinet}${path}`, { method, headers: { "Content-Type": "application/json", "X-Manager": "1" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), j);
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
  });
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
  $("#drivenote").textContent = off ? "This cabinet has no driver keyboard (D282): watch here and use the cabinet's own controls." : "";
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
    $("#plays").innerHTML = `<tr><th>When</th><th>Game</th><th>Made by</th><th class=n>Seconds</th><th class=n>Score</th><th>Ended</th></tr>` +
      a.plays.slice(0, 100).map((p) => `<tr><td>${when(p.at)}</td><td>${esc(p.game)} <span class=hint>v${esc(p.version)}${p.guest ? " · guest" : ""}</span></td><td>${esc(p.made_by ?? "")}</td><td class=n>${esc(p.seconds)}</td><td class=n>${esc(p.score ?? "")}</td><td>${esc(p.ended ?? "")}${p.errors ? ` <span class=bad>${esc(p.errors)} errors</span>` : ""}</td></tr>`).join("");
  } catch (e) {
    $("#actnote").innerHTML = `<span class=bad>${esc(e.message)}</span>`;
  }
}
function make(m) {
  const ok = m.outcome === "committed";
  const answers = m.answers.map((t) => `<li>${esc(t.question)} <span class=hint>A: ${esc(t.a)} · B: ${esc(t.b)}</span> → <span class=pick>${esc(t.choice)}${t.choice === "A" ? ` (${esc(t.a)})` : t.choice === "B" ? ` (${esc(t.b)})` : t.choice === "D" ? " (Make it now)" : ""}${t.said ? `: “${esc(t.said)}”` : ""}</span></li>`).join("");
  return `<div class="make"><div class="top"><span class="who">${esc(m.who)}${m.with ? ` with ${esc(m.with)}` : ""}</span><span class="tag">${m.kind === "change" ? `change of ${esc(m.parent)}` : "new game"}</span><span class="hint">${when(m.at)}${m.minutes != null ? ` · ${m.minutes} min` : ""}</span><span class="tag ${ok ? "ok" : "no"}">${esc(m.kid_outcome ?? m.outcome)}</span>${m.cart ? `<span class="hint">${esc(m.cart.id)} v${esc(m.cart.version)}</span>` : ""}<span>${m.coins != null ? `${m.coins} coin${m.coins === 1 ? "" : "s"}` : ""} · ${dollars(m.cents)}${m.charged ? "" : " <span class=hint>(not charged)</span>"}</span></div><div class="said">“${esc(m.said)}”</div>${answers ? `<ol>${answers}</ol>` : ""}<div class="hint">Ended by ${esc(m.ended_by ?? "?")}${m.errors ? ` · <span class=bad>${m.errors} errors</span>` : ""}${m.plays ? ` · played ${m.plays}×` : ""}${m.corrections.map((c) => ` · ${esc(c.why)}`).join("")}</div></div>`;
}
$("#reload").addEventListener("click", loadActivity);

// ---- Coins (D284) ----
async function loadPot() {
  $("#pair").hidden = true;
  $("#coinmsg").textContent = "";
  try {
    const v = await api("GET", "/pot");
    const p = v.pot;
    $("#pot").innerHTML = `<div class="card"><div><div class="potbig">${esc(p.coins)} coins</div><div class="hint">${dollars(p.cents)} of ${esc(p.full_coins)} coins · fills back up on ${esc(p.refill_on)} · this month ${dollars(p.spent_cents)} spent${p.added_cents ? `, ${dollars(p.added_cents)} added` : ""}</div>${p.makers.map((m) => `<div>${esc(m.name)}: ${esc(m.coins)} coins, ${esc(m.makes)} make${m.makes === 1 ? "" : "s"}</div>`).join("")}</div></div>`;
    $("#ledger").innerHTML = `<tr><th>When</th><th>Who</th><th>What</th><th class=n>Pot after</th></tr>` +
      v.history.slice(0, 60).map((e) => `<tr><td>${when(e.at)}</td><td>${esc(e.kind === "charge" ? (e.name ?? e.who) : e.kind === "refill" ? "the 1st" : `grown-up${e.by ? ` (${e.by})` : ""}`)}</td><td>${esc(e.kind === "charge" ? `${e.what}, ${e.cost_cents}c, ${e.outcome}` : e.kind === "topup" ? `added ${Math.round(e.cents / 10)} coins: "${e.reason}"` : e.kind === "reset" ? `reset to 100: "${e.reason}"` : "refilled to 100")}</td><td class=n>${Math.round(e.pot_after_cents / 10)}</td></tr>`).join("");
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
    $("#coinmsg").textContent = `Added ${body.coins} coins: “${body.reason}”.`;
    loadPot();
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
    loadPot();
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

// ---- Views and the cabinet picker (D286) ----
function show(v) {
  view = v;
  for (const b of document.querySelectorAll("nav button")) b.classList.toggle("on", b.dataset.view === v);
  for (const s of document.querySelectorAll(".view")) s.classList.toggle("on", s.id === v);
  if (v === "activity") loadActivity();
  if (v === "coins") loadPot();
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
  let saved = "", savedView = "screen";
  try { saved = localStorage.getItem("gsa-cabinet") || ""; savedView = localStorage.getItem("gsa-view") || "screen"; } catch {}
  $("#cabinet").innerHTML = j.cabinets.map((c) => `<option value="${esc(c.name)}">${esc(c.label)}</option>`).join("");
  cabinet = j.cabinets.some((c) => c.name === saved) ? saved : j.cabinets[0].name;
  $("#cabinet").value = cabinet;
  watch();
  show(savedView);
})();
