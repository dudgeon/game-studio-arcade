// What in a cabinet's health deserves a warning (D365). Pure: the health JSON in (remote/health.py), warnings out.

export const LIMITS = { hotC: 80, warmC: 70, rootFreeMb: 1024, rootFreePct: 10, bootFreeMb: 30, weakSignal: 40, weakDbm: -70 };

/**
 * @param {any} h
 * @returns {{ level: "bad" | "warn" | "note", text: string }[]}
 */
export function warnings(h) {
  /** @type {{ level: "bad" | "warn" | "note", text: string }[]} */
  const w = [];
  if (h.cpu_temp_c != null && h.cpu_temp_c > LIMITS.hotC) w.push({ level: "bad", text: `Hot: the CPU is at ${h.cpu_temp_c.toFixed(0)} °C (over ${LIMITS.hotC}). Check the cooler and that air can get in.` });
  else if (h.cpu_temp_c != null && h.cpu_temp_c > LIMITS.warmC) w.push({ level: "note", text: `Warm: the CPU is at ${h.cpu_temp_c.toFixed(0)} °C.` });
  if (h.throttled?.now?.length) w.push({ level: "bad", text: `Throttled now: ${h.throttled.now.join(", ")}.${h.throttled.now.includes("under-voltage") ? " The power supply isn't keeping up." : ""}` });
  else if (h.throttled?.since_boot?.length) w.push({ level: "warn", text: `Throttled since it started: ${h.throttled.since_boot.join(", ")}.` });
  const root = h.disk?.root;
  if (root && (root.free_mb < LIMITS.rootFreeMb || root.free_pct < LIMITS.rootFreePct)) w.push({ level: "bad", text: `Low on disk: ${root.free_mb} MB free (${root.free_pct}%).` });
  const boot = h.disk?.boot;
  if (boot && boot.free_mb < LIMITS.bootFreeMb) w.push({ level: "warn", text: `The boot partition has only ${boot.free_mb} MB free.` });
  if (h.wifi && (h.wifi.signal < LIMITS.weakSignal || (h.wifi.dbm != null && h.wifi.dbm < LIMITS.weakDbm))) w.push({ level: "warn", text: `Weak Wi-Fi: ${h.wifi.signal}%${h.wifi.dbm != null ? ` (${h.wifi.dbm} dBm)` : ""} on ${h.wifi.band ?? "?"}. Makes may stall; a mesh point nearer the basement would help.` });
  for (const [s, state] of Object.entries(h.services ?? {})) if (state !== "active") w.push({ level: "bad", text: `${s} is ${state}.` });
  return w;
}
