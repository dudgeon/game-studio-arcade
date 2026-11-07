# Platform notes

Facts checked against live docs on **2026-11-07**. These correct or extend HANDOFF §5. Managed Agents is beta: re-check before relying on anything here, and update this file when something changes.

## Claude Managed Agents

Sources: platform.claude.com/docs/en/managed-agents/{overview, quickstart, agent-setup, tools, events-and-streaming, environments, cloud-sandboxes-reference, files, budgets, sessions, session-operations, reference, skills}; /about-claude/pricing; /build-with-claude/files.

**Confirmed as in the brief:** beta header `managed-agents-2026-04-01` (the SDKs add it); toolset `agent_toolset_20260401` with bash, read, write, edit, glob, grep, web_fetch, web_search; SSE events (`user.message`, `agent.message`, `agent.tool_use`, `session.status_idle`); the custom tool flow (`agent.custom_tool_use` → idle with `stop_reason.type: requires_action` → `user.custom_tool_result` with `custom_tool_use_id`); the sandbox spec (Ubuntu 24.04 x86_64, ≤8 GB RAM, ≤10 GB disk, Node 20/21/22 with 22 the default, Chromium at `/opt/pw-browsers/chromium`, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); `limited` networking with no hosts meaning no outbound traffic; file mounts under `/mnt/session/uploads/`, read-only, at most 500 per session; outputs in `/mnt/session/outputs/`, which can lag after idle; budget shape and `budget_reached`; prices.

**Corrections and additions:**

- **Agent file:** the system prompt is the Markdown **body**, not a frontmatter field. Frontmatter holds `name`, `model`, `tools`, `skills`, `mcp_servers`, `metadata`, `multiagent`.
- **Agents are versioned** (environments aren't). Each real change bumps `version`, and a session can pin `{type: agent, id, version}`. Commit `claude-lock.json`, or `ant apply` creates duplicates.
- **`ant` CLI:** `brew install anthropics/tap/ant` (v2.7.1 at time of writing). Auth with `ant auth login` or `ANTHROPIC_API_KEY`.
- **Disabling tools:** `configs: [{name: web_fetch, enabled: false}]`, or an allowlist (`default_config: {enabled: false}` plus per-tool `enabled: true`). The default permission policy is `always_allow`.
- **Networking default is `unrestricted`** when `networking` is omitted, so always set `type: limited` explicitly.
- **Playwright version in the sandbox is not published.** Read it from a probe session. Don't install another Playwright, because it would look for a browser build that isn't present. Only Chromium is installed (no Firefox or WebKit).
- **Streaming:** open the SSE stream *before* sending, because it only delivers events emitted after it opens. A custom tool result can be sent as soon as `agent.custom_tool_use` arrives. A `user.message` sent while the agent is running is queued. `user.interrupt` stops it.
- **Waiting is free:** runtime is billed only while the status is `running`. No timeout is documented for a pending custom tool result or for an idle session.
- **Sandbox state lasts 30 days** from creation, and activity doesn't extend it. Never plan on resuming an old session: forks start new sessions from our stored artifacts.
- **Budgets** can be set only at session creation. Removing one is irreversible. A session can overshoot by one model request. List cost covers tokens, web search and runtime. Raising the cap resumes the session. There are no token or turn caps.
- **Skills and MCP servers attach at the agent level** (custom skills uploaded with `ant apply skills/<dir>`). **Files are session-level only** (`resources`) and can be added or removed on a running session. Max file size is 500 MB.
- **Only `tools` and `mcp_servers` can change mid-session** (while idle). Model, system prompt and skills can be overridden only at creation. `system.message` can add guidance mid-session.
- **Deleting a session deletes its outputs.** Download first. Transcripts persist at Anthropic until deleted. **Not eligible for ZDR.**
- Tool output over 100k characters is spilled to a file. Custom tool names can't start with `mcp__` or `ant__`.
- **Rate limits:** 300 creates/min and 1,200 reads/min per org; Files API about 500/min. No session concurrency limit is documented.
- **Branding:** don't present the product as "Claude Code". "Powered by Claude" is fine.
- **Cache-write pricing** (not in the brief): Sonnet 5.5 $2.50 (5 min) / $4 (1 h); Opus 5.5 $5 / $8. `inference_geo: "us"` costs 1.1×.

## Guidelines for organizations serving minors

support.claude.com article 9307344 (dated 2026-03-16). It applies to products where minors interact directly with the API. It expects age-appropriate safeguards (content moderation and filtering, monitoring and reporting, a child-safety system prompt), compliance with child-safety and privacy law, and **disclosure that users are talking to an AI**. It requires no notification, approval or parental-consent mechanism. Our plan already covers this: an AI disclosure screen, request screening, a kid brief in the system prompt, and the activity log as monitoring.

## Claude Code plugins

Sources: code.claude.com/docs/en/{plugins-reference, plugins/create, plugins/install, plugins/components, skills, mcp, headless}; modelcontextprotocol.io spec 2025-11-25.

- **Layout:** the manifest is `.claude-plugin/plugin.json`; only `name` is required. Components sit at the plugin root: `skills/<name>/SKILL.md`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `bin/` (added to PATH), `settings.json`. Check a plugin with `claude plugin validate ./dir`.
- **Plugins can't define tools directly.** Tools come from an MCP server the plugin bundles (stdio in `.mcp.json`). Claude Code names them `mcp__plugin_<plugin>_<server>__<tool>`. **Plan change:** use a server called `studio` with tools `new_cart`, `playtest`, `import_asset`, `validate_cart`, which become `mcp__plugin_game-studio_studio__new_cart` and so on. Don't use dotted names like `studio.new_cart`. Write the full names in permissions and hook matchers.
- **Local development:** `claude --plugin-dir ./studio-kit/plugin` (repeatable), `/reload-plugins` after edits, or a local marketplace. Headless `claude -p` also takes `--plugin-dir`.
- **Remote MCP (cabinet `arcade` server):** `claude mcp add --transport http arcade http://arcade.local:<port>/mcp --header "Authorization: Bearer …"`. In JSON, `"type": "http"` is required, because a bare `url` is silently treated as stdio. **OAuth won't work over plain http on the LAN**, so use a static bearer token (our shared pairing token). `plugin validate` warns about non-loopback http URLs. Environment variables with credential-like names expand to empty in remote headers, so give ours a custom name such as `ARCADE_TOKEN`.

## Playwright

- Latest release: **v1.65.0 (2026-11-05)**. The **sandbox version is unknown** until a probe session reads it, and the local harness must be pinned to that version, not to the latest.
- Linux arm64 on Debian 12/13 is officially supported (it uses Chrome for Testing builds since v1.63). Raspberry Pi isn't mentioned. Pointing `executablePath` at a system Chromium works "at your own risk". Try the bundled build on the Pi first.

## Raspberry Pi OS

- The current release is **trixie (Debian 13)**, released 2026-10-06 with kernel 6.18. It's available as Lite 64-bit and supports the Pi 5. Target trixie, not bookworm.

## Speech

- **Groq `whisper-large-v3-turbo`:** $0.04/hour of audio with a **10-second minimum billed per request**, which is negligible at $0.0001 per clip. Uploads are capped at 25 MB. Inputs and outputs aren't retained by default, but abuse logs are kept for up to 30 days. **Turn on Zero Data Retention** at console.groq.com/settings/data-controls; the transcription endpoints are ZDR-eligible.
- **Moonshine:** github.com/moonshine-ai/moonshine, pip package `moonshine-voice` v0.1.6 (2026-11-06). English streaming models: Tiny (34M), Small (123M) and Medium (245M). Pi 5 is officially supported; the published latencies are Tiny about 240 ms, Small about 530 ms and Medium about 800 ms. MIT licensed.

## Guest players

- **TIC-80** v1.4.1 (2026-10-27) has official linux-arm64 builds. Surf mode exists but is compiled only with `BUILD_SURF`, so check that the arm64 build includes it.
- **PICO-8** v0.2.7 costs $14.99 and has an official Raspberry Pi 64-bit build. It's personally licensed: **the image script must not download or bundle it.** Geoff supplies his copy and the script installs it from a local path. BBS carts belong to their authors.
