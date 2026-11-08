// Is the applied Studio agent running the brief in the repo? (D173) The lockfile
// can't say: it only knows what was last applied. So this reads the agent version
// sessions will pin, and compares what matters with agents/studio.md.

/** JSON with sorted keys, so key order never counts as a difference. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

const customTools = (tools) => new Map((tools ?? []).filter((t) => t?.type === "custom").map((t) => [t.name, canonical({ description: t.description, input_schema: t.input_schema })]));

/**
 * What differs between an applied agent and the repo's brief.
 * @param {any} applied the agent, as the API returns it
 * @param {{system: string, tools: any[]}} def readAgentDef()
 * @returns {string[]} empty when they match
 */
export function compareBrief(applied, def) {
  const diffs = [];
  if (String(applied?.system ?? "").trim() !== def.system.trim()) diffs.push("system prompt");
  const a = customTools(applied?.tools);
  const b = customTools(def.tools);
  for (const [name, spec] of b) {
    if (!a.has(name)) diffs.push(`tool ${name} missing`);
    else if (a.get(name) !== spec) diffs.push(`tool ${name}`);
  }
  for (const name of a.keys()) if (!b.has(name)) diffs.push(`tool ${name} not in the repo`);
  // The API fills in defaults on the toolset, so check what it must do, not its exact shape.
  const toolset = (applied?.tools ?? []).find((t) => t?.type === "agent_toolset_20260401");
  if (!toolset) diffs.push("toolset missing");
  else {
    for (const web of ["web_fetch", "web_search"]) {
      if (toolset.configs?.find((c) => c.name === web)?.enabled !== false) diffs.push(`${web} is not disabled`);
    }
    if (toolset.default_config?.permission_policy?.type !== "always_allow") diffs.push("toolset permission policy");
  }
  return diffs;
}

/**
 * @param {{api: import("./api.js").StudioApi, lock: {agentId: string, agentVersion?: number}, def: {system: string, tools: any[]}}} o
 * @returns {Promise<{match: boolean, agent_version: number|null, diffs: string[]}>}
 */
export async function checkAppliedBrief(o) {
  if (!o.api.retrieveAgent) return { match: false, agent_version: o.lock.agentVersion ?? null, diffs: ["this client can't read the agent"] };
  try {
    const applied = await o.api.retrieveAgent(o.lock.agentId, o.lock.agentVersion);
    return { match: compareBrief(applied, o.def).length === 0, agent_version: applied?.version ?? o.lock.agentVersion ?? null, diffs: compareBrief(applied, o.def) };
  } catch (/** @type {any} */ e) {
    return { match: false, agent_version: o.lock.agentVersion ?? null, diffs: [`couldn't read the agent: ${e?.message ?? e}`] };
  }
}

/** What to tell a person whose applied brief is stale. */
export function staleMessage(check) {
  return `The applied Studio agent (v${check.agent_version}) doesn't match agents/studio.md: ${check.diffs.join(", ")}.
Update it: cd studio-kit/managed-agent && ant --profile game-studio-arcade apply
Or run the repo's brief just this once: --brief-from-file. Or run the old one on purpose: --applied-brief.`;
}
