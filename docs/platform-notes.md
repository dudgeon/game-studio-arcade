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

**Checked 2026-11-07 for tasks 7–8** (agent-setup, tools, sessions, events-and-streaming, files, budgets, session-observability, environments, skills, reference; cli/apply; SDK 1.6.0 types). Not yet run live:

- **Where list cost is reported:** the session object's `usage.list_cost` is `{amount: "<whole cents>", currency: "USD"}`, alongside token counts, `cache_creation`, `active_seconds` and `server_tool_use`. A `session.usage` event with the same snapshot arrives right before every idle. Task 1's probe should confirm it.
- **Idle stop reasons** (SDK types): `end_turn`, `requires_action` (with `event_ids`), `budget_reached`, `retries_exhausted`, `refusal`. A `user.custom_tool_result` sent twice is accepted and ignored.
- **Per-session model:** `agent: {type: "agent_with_overrides", id, version?, model: {id}}`. It never versions the agent, and replaces the whole `model` object, so effort falls back to the model's default.
- **`ant apply` (≥ 1.30):**
  - It writes `claude-lock.json` in the current directory.
  - It infers a file's kind from its directory (`agents/`, `environments/`).
  - Under `tools`, a path glob such as `./tools/*.json` inserts tool definitions from files.
  - `--dry-run` shows the plan; `--yes` is needed without a terminal.
  - It can't adopt resources created elsewhere.
- **Confirmed live 2026-11-08 (Studio agent apply, ant 2.7.1):** a `./tools/*.json` glob under `tools` expands into the custom tools; `allowed_hosts: []` with both `allow_*: false` is accepted; a second `ant apply` with no edits reports "Everything is up to date". `ant --profile <name> apply` shows `credentials profile <name>` in the plan.
- **Studio parity session, 2026-11-08** (`sesn_0183yE1n3dd38YdPPA5WBRZU`, Haiku 5.5, 50¢ cap, the applied Studio agent and environment with a harness system prompt). The kit extracted, and `gsa-playtest` passed on `dot-catch` with both drivers (Node 22.22.0; Playwright 1.56.0, Chromium 141.0.7390.37). **`comparable()` matched the mini's run exactly for both `--driver node` and `--driver browser`.**
  - Output listing: bare filenames as written. The inputs appear under their mount basenames (`studio-kit.tgz`, `parity.tgz`) and are filtered out by name.
  - Outputs went on syncing after idle: `DONE.json` and every manifest size matched on the 3rd poll, about 6.9 s after `session.status_idle` (2 s between polls).
  - Cost: `usage.list_cost` read `"0"`. Recomputed from `usage` at list prices it was 0.16¢: tokens 0.086¢ (6 in, 162 out, 5,751 cache writes, 5,578 cache reads) plus 35.5 active seconds of runtime at 0.079¢. That agrees with "0" after rounding to the nearest cent.
  - Sandbox frame time for the trivial `dot-catch`: node driver p95 0.023 ms, browser driver p95 3.5 ms (max 108.7 ms). The browser figure is close to D61's 4 ms default budget.
- **Session outputs:** the Files API lists only a `filename` per output, with no path. Folder structure isn't guaranteed, so we ship one `cart.tgz` (D42).
- **Custom tool names** also can't match a built-in tool name (`bash`, `read`…).
- **Custom skills** attach as `{type: custom, skill_id, version}`, up to 500 per session. They need the `read` tool.

## Guidelines for organizations serving minors

support.claude.com article 9307344 (dated 2026-03-16). It applies to products where minors interact directly with the API. It expects age-appropriate safeguards (content moderation and filtering, monitoring and reporting, a child-safety system prompt), compliance with child-safety and privacy law, and **disclosure that users are talking to an AI**. It requires no notification, approval or parental-consent mechanism. Our plan already covers this: an AI disclosure screen, request screening, a kid brief in the system prompt, and the activity log as monitoring.

## Claude Code plugins

Sources: code.claude.com/docs/en/{plugins-reference, plugins/create, plugins/install, plugins/components, skills, mcp, headless}; modelcontextprotocol.io spec 2025-11-25.

- **Layout:** the manifest is `.claude-plugin/plugin.json`; only `name` is required. Components sit at the plugin root: `skills/<name>/SKILL.md`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `bin/` (added to PATH), `settings.json`. Check a plugin with `claude plugin validate ./dir`.
- **Plugins can't define tools directly.** Tools come from an MCP server the plugin bundles (stdio in `.mcp.json`). Claude Code names them `mcp__plugin_<plugin>_<server>__<tool>`. **Plan change:** use a server called `studio` with tools `new_cart`, `playtest`, `import_asset`, `validate_cart`, which become `mcp__plugin_game-studio_studio__new_cart` and so on. Don't use dotted names like `studio.new_cart`. Write the full names in permissions and hook matchers.
- **Local development:** `claude --plugin-dir ./studio-kit/plugin` (repeatable), `/reload-plugins` after edits, or a local marketplace. Headless `claude -p` also takes `--plugin-dir`.
- **Remote MCP (cabinet `arcade` server):** `claude mcp add --transport http arcade http://arcade.local:<port>/mcp --header "Authorization: Bearer …"`. In JSON, `"type": "http"` is required, because a bare `url` is silently treated as stdio. **OAuth won't work over plain http on the LAN**, so use a static bearer token (our shared pairing token). `plugin validate` warns about non-loopback http URLs. Environment variables with credential-like names expand to empty in remote headers, so give ours a custom name such as `ARCADE_TOKEN`.

## Playwright

- Latest release: **v1.65.0 (2026-11-05)**. **The Managed Agents sandbox has 1.56.0** (probed 2026-11-07, D18), and the local harness pins to that, not to the latest.
- Linux arm64 on Debian 12/13 is officially supported (it uses Chrome for Testing builds since v1.63). Raspberry Pi isn't mentioned. Pointing `executablePath` at a system Chromium works "at your own risk". Try the bundled build on the Pi first.

## Raspberry Pi OS

- The current release is **trixie (Debian 13)**, released 2026-10-06 with kernel 6.18. It's available as Lite 64-bit and supports the Pi 5. Target trixie, not bookworm.

## Speech

- **Groq `whisper-large-v3-turbo`:** $0.04/hour of audio with a **10-second minimum billed per request**, which is negligible at $0.0001 per clip. Uploads are capped at 25 MB. Inputs and outputs aren't retained by default, but abuse logs are kept for up to 30 days. **Turn on Zero Data Retention** at console.groq.com/settings/data-controls; the transcription endpoints are ZDR-eligible.
- **Moonshine:** github.com/moonshine-ai/moonshine, pip package `moonshine-voice` v0.1.6 (2026-11-06). English streaming models: Tiny (34M), Small (123M) and Medium (245M). Pi 5 is officially supported; the published latencies are Tiny about 240 ms, Small about 530 ms and Medium about 800 ms. MIT licensed.

## Guest players

- **TIC-80** v1.4.1 (2026-10-27) has official linux-arm64 builds. Surf mode exists but is compiled only with `BUILD_SURF`, so check that the arm64 build includes it.
- **PICO-8** v0.2.7 costs $14.99 and has an official Raspberry Pi 64-bit build. It's personally licensed: **the image script must not download or bundle it.** Geoff supplies his copy and the script installs it from a local path. BBS carts belong to their authors.

## Workload Identity Federation

Sources: platform.claude.com/docs/en/manage-claude/{workload-identity-federation, wif-reference, authentication}; /cli-sdks-libraries/cli/authentication. Checked 2026-11-07.

- **Resources:** a service account (`svac_`), a federation issuer (`fdis_`) and a federation rule (`fdrl_`). The Console wizard is at `platform.claude.com/settings/workload-identity-federation` → Connect workload → Custom OIDC. **Requires the admin or owner role.**
- **Inline JWKS** suits issuers that aren't on the public internet. The `issuer_url` is then only string-compared with `iss`, so it may be an internal hostname. There's no automatic key rotation: update the issuer by hand.
- **JWT rules:**
  - asymmetric algorithms only (ES256 and others);
  - a `kid` header that matches a key in the issuer;
  - `sub`, `iat` and `exp` claims are required;
  - `exp − iat` is at most 1 h by default;
  - 30 s of clock-skew leeway;
  - a `jti` makes the token single-use per issuer;
  - at most 16 KiB.
- **Rules** match on `subject_prefix` (exact match, or a trailing `*` for a prefix) plus optional `audience`, `claims` or a CEL `condition`. `oauth_scope` `workspace:developer` covers Messages, Models, **Managed Agents**, Files and Skills. `token_lifetime_seconds` is 60–86,400; the wizard defaults to 600.
- **Minted token lifetime** is min(rule lifetime, 2 × the JWT's remaining life). The SDK refreshes 120 s before expiry and re-reads `ANTHROPIC_IDENTITY_TOKEN_FILE` on every exchange.
- **SDK and CLI environment variables:** `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_SERVICE_ACCOUNT_ID`, `ANTHROPIC_IDENTITY_TOKEN_FILE` or `ANTHROPIC_IDENTITY_TOKEN`, and `ANTHROPIC_WORKSPACE_ID`. **`ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` override federation**, and so does an empty-but-set variable. `ant auth status` shows which source won.
- **Profiles:** `~/.config/anthropic/configs/<name>.json` with `authentication.type: oidc_federation`. Claude Code and the Agent SDK honor the same profiles.
- **Debugging:** a denied exchange always returns an opaque 401 "Authentication failed". The reason is in the Console's authentication history: `…/settings/workload-identity-federation?tab=history`.
- **Interactive alternative for dev machines:** `ant auth login` (browser OAuth, workspace-scoped, stored in `~/.config/anthropic/credentials/`).

**Account limit (verified 2026-11-07):** WIF and the Admin API are unavailable to *Individual* Console accounts. With an `org:admin` OAuth token, `/v1/organizations/service_accounts` and `/federation_issuers` returned 404, and `/workspaces` and `/me` returned 403. Converting the account to an organization (`platform.claude.com/settings/organization`) is the documented path. Its side effects are unverified.

## CLI browser login (what the mini uses)

- `ant auth login --profile <name>` opens a browser. After approval, the page shows a code to paste into the terminal (the `platform.claude.com/oauth/code/callback` redirect). A workspace picker binds the token to one workspace; `--workspace-id` skips the picker.
- **Default scope:** `user:profile user:inference user:developer`. The token lasts 8 h, refreshes itself, and is stored in `~/.config/anthropic/credentials/<profile>.json` (0600). The first login for a profile makes it the active profile.
- **Works with Managed Agents:** `ant beta:agents list` and `ant beta:environments list` succeed (checked 2026-11-07).
- `ant auth status` shows the winning credential source and workspace. The docs say the SDKs, Claude Code and the Agent SDK use the same profile resolution; the TypeScript SDK is still to be verified in Phase 0.

## Managed Agents sandbox, as probed (2026-11-07)

Session `sesn_01Qbgy4bgLKvukuMevfJDiU5`: environment `gsa-probe-offline` (limited networking, no hosts), agent `gsa-probe` (Haiku 5.5). Raw results are in `studio-kit/probe/results/`. Decisions taken from this: D18, D19.

- **Machine:** Ubuntu 24.04.5 LTS, x86_64, kernel 6.18, **4 vCPU, 16 GB RAM** (the docs say "up to 8 GB"), about 30 GB free disk. It runs as root, and the session mounts are owned by user `claude`.
- **Node:** `/opt/node22/bin/node` v22.22.0, npm 10.9.4. Global npm root is `/home/claude/.npm-global/lib/node_modules`, with links into `/opt/npm-tools`. Preinstalled globally: typescript 6.0.3, tsx 4.23.12, ts-node, sharp, react 19, marked, pdf-lib and others. Python 3.11.17, git 2.43, GNU tar 1.35, jq 1.7 and ffmpeg 6.1.1 are present too.
- **Playwright:** 1.56.0 (Node and Python). Browsers are at `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`: `chromium-1194`, `chromium_headless_shell-1194` and `ffmpeg-1011`. A stray 1.56.1 sits in `/opt/node-tools`. `require("playwright")` works with `NODE_PATH="$(npm root -g)"`.
- **Headless Chromium 141.0.7390.37:**
  - launches offline in about 5.1 s
  - a 320×256 canvas scaled to 1280×1024 renders with pixelated scaling (screenshot checked) (the Max's size at the time; D81 now targets 256×192 at 4× = 1024×768)
  - `requestAnimationFrame` ran 63 frames in 1 s
  - `page.keyboard.press` reached `keydown` (`ArrowLeft`, `KeyZ`)
  - `AudioContext`, `OfflineAudioContext`, `navigator.getGamepads`, `OffscreenCanvas` and WebGL all exist
  - no page errors
- **Network is fully blocked:** DNS fails (`getent`, curl "Could not resolve host"), the npm registry is unreachable (ENOTFOUND), and Chromium `page.goto` fails with `net::ERR_NAME_NOT_RESOLVED`.
- **Files:** a mounted file appears at its absolute `mount_path` under `/mnt/session/uploads/`, read-only. Outputs go in `/mnt/session/outputs/`. Outputs can still be syncing seconds after idle, and the session's file listing includes the uploaded inputs (D19).
- **Cost and timing:** 80 s wall time, 79.5 s active. Tokens: 6 input, 5,345 cache-write, 4,545 cache-read, 310 output. Reported `list_cost` is `"0"` (rounded to cents); the computed cost is about $0.003. `session.usage` arrived at the end of the turn.

## Picade, 10-inch (2025 edition)

Checked 2026-11-07. Sources: pishop.us/product/picade-with-10-inch-display (also served at /product/picade/), shop.pimoroni.com/products/picade (product JSON), shop.pimoroni.com/products/picade-x-hat-usb-c, learn.pimoroni.com/article/assembling-your-picade and /setting-up-picade, github.com/pimoroni/picade-hat (`picade.dts`, `picade.txt`, issue #45, PR #49), pishop.us product pages for the Pi 5 8 GB, the Active Cooler and the 27 W supply. Decisions taken from this: D80–D84.

**Buying (what Geoff ordered, 2026-11-07):** Picade with 10" display, Pimoroni PIM469, PiShop SKU 2009, **$349.95**, in stock. Raspberry Pi 5 8 GB, PiShop SKU 8GB-9028, **$175.00**, in stock. Not included in the kit: the Pi, a USB-C supply, a microSD card. Pimoroni also recommends an Active Cooler for the Pi 5. PiShop prices: Active Cooler (SC1148) $12.95; official 27 W USB-C supply (SC1158, 5.1 V/5 A) $12.95; both in stock. PiShop lists the 10-button illuminated "Picade Plasma Kit" ($64.95) as an extra; it isn't in the kit.

**Edition check on arrival.** Pimoroni's page describes the 2025 edition, "Designed for Raspberry Pi 5". PiShop's page, same SKU, still carries older copy (recommends a Pi 4, and notes that a 2020 edition has a square PICO-8 sticker and a different assembly tutorial). Check which edition arrives before assembly; Pi 5 fit and cooling are only promised for the 2025 edition.

**Display:** 10" IPS, **1024×768, 4:3**, wide viewing angles. Pimoroni's HDMI driver board with an on-screen-display keypad (mounted inside on the left of the side panel). Video comes from the Pi's micro-HDMI port 0 (HDMI-0; the guide warns to use that one) with the included micro-HDMI cable. The board is powered by a micro-USB cable from one of the Pi's USB ports. Check on arrival that the Pi picks 1024×768 from EDID.

**Controls:** one 4-way digital joystick (black ball top), **six player buttons**, **four utility buttons** (two on the front, two on the sides; wired to the HAT's ENT, ESC, 1UP and COIN headers), and an illuminated power button. **One player.** Everything connects to the Picade X HAT with Dupont connectors.

**How the Pi reads them:** the X HAT is GPIO, not USB. The `picade` device-tree overlay binds the 14 inputs to a virtual keyboard (Pimoroni: "emulated keyboard presses", so emulators report "No gamepad detected"). Default keycodes in `picade.dts`: arrows for the joystick; buttons 1–6 = Left Ctrl, Left Alt, Space, Left Shift, Z, X; Enter, Escape, I (coin), O (start); power = KEY_POWER. Every key can be changed with `dtparam=<input>=<keycode>` (`dtoverlay` lines are limited to 80 characters). D82 sets them to the runtime's P1 keys. The X HAT also has breakout pins for two more buttons and a plasma-button connector.

**Pi 5:** the cabinet fits a Pi 5 with Active Cooler, plus a single NVMe Base (7 mm standoffs) but not the NVMe Base Duo. The X HAT sits on a booster header and 17 mm standoffs. Pi 5 support in the overlay was merged on 2025-07-17 (PR #49). Issue #45 (open) records: controls and audio work with the Pi 5 overlay; the screen flashed until `usb_max_current_enable=1`; the power button powers off but power-on was unreliable for one user; one user saw about 85 °C under the HAT. Install: build `picade.dtbo` from the repo (`make`, `sudo make install`, needs `device-tree-compiler`) and add `dtoverlay=picade` to `/boot/firmware/config.txt`. Pimoroni's guide targets Raspberry Pi OS Lite 64-bit but doesn't name a Debian release, so check on trixie.

**Power:** USB-C into the X HAT, which back-powers the Pi through the GPIO header ("no need for a separate power supply"). Tap the power button (or the HAT's "switch" button) to start; hold 3 s to shut down safely and cut power. Because the Pi can't see the supply, add `usb_max_current_enable=1`.

**Audio:** a 3" speaker (5 W, 4 Ω) on the X HAT's I2S DAC with a 3 W mono amplifier (both channels mixed to mono). Default volume is 100%, "a bit much". If sound fails: `dtparam=audio=off` and `dtoverlay=vc4-kms-v3d,noaudio`. One Bookworm user needed PulseAudio for I2S.

**Ports and the mic:** no external ports are documented; the back panel is removable for access, and the USB-C power cable reaches the HAT inside. The Pi 5 has four USB ports; the display's power takes one, leaving three inside the case for a mic, a gamepad or storage. The HAT uses the I2S pins (18, 19, 21) for its DAC, so a USB mic is the path, not I2S.

**Cabinet and assembly:** powder-coated MDF, acrylic screen cover, marquee and console; 310 × 260 × 250 mm (H × W × D) assembled. About 2–3 hours with a cross-head and a small flat-blade screwdriver. Guide warnings: make sure screw terminals grip the bare wire; seat the ribbon cable under its grey clip, not on top ("it _won't_ work"); if only one joystick direction works when mapping, recheck the joystick wiring. Includes a PICO-8 licence (Geoff's copy for the guest player, see Guest players).

