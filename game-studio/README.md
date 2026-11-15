# game-studio: the desktop flow

The Claude Code plugin for making cabinet games on the Mac mini with a kid (HANDOFF §8.3; D340-D349). Claude Code gets two MCP servers and a skill:

- **`arcade`** is the cabinet. Its tools run on the cabinet itself, in the cabinet service (`cabinet/service/src/arcade-mcp.js`): `list_carts`, `get_cart`, `publish_cart` (through the publish gate), `launch_on_cabinet`, `get_activity`, `cabinet_status`, `remove_from_shelf` and `restore_to_shelf` (a grown-up's "off the shelf", kept in the records, D360). On the mini, `src/arcade-bridge.js` reaches them through the Cabinet Manager's SSH connection and pairing token (D341). It adds `get_cart` `into` a folder, and `publish_cart` from a `dir`.
- **`studio`** runs on the mini, against cart folders: `new_cart`, `validate_cart`, `playtest`, `play` (a browser, keyboard as joystick), `import_asset`, `read_kit`.
- **`build-cart`**, the skill: work spec-first with a kid, then check, play, publish and launch.

```
game-studio/
  plugin/                 the plugin Claude Code loads
    .claude-plugin/plugin.json
    .mcp.json             servers arcade and studio, both bin/run.mjs
    bin/run.mjs           finds the checkout (GSA_REPO, its own, or ~/claude-home/game-studio-arcade) and starts a server
    skills/build-cart/SKILL.md
  src/                    arcade-bridge.js, studio-server.js, asset.js
  test/
```

## Before it works

- **The cabinet is paired with the Manager:** `node scripts/coin.mjs pair` (once per cabinet, D208). The bridge uses that token.
- **The cabinet runs a release with `/mcp`.** A cabinet without one answers "this cabinet's service has no /mcp yet".
- The mini has the cabinet's SSH key, as the Manager does (D286).

## Try it without installing

From any folder you want to work in:

```sh
claude --plugin-dir ~/claude-home/game-studio-arcade/game-studio/plugin
```

Which cabinet (D516): `ARCADE_CABINET` if Claude Code was started with it; else a `.arcade-cabinet` file (one word, such as `real`) in the project folder or above it; else the virtual cabinet. A session started by Duo can't set an environment variable, so put the file in its folder: `echo real > .arcade-cabinet`. In a session, `use_cabinet` switches. Every result names the cabinet that answered.

## Install it (Geoff's call)

The repo is a one-plugin marketplace. To install it for your user:

```sh
claude plugin marketplace add ~/claude-home/game-studio-arcade
claude plugin install game-studio@game-studio-arcade
```

`claude plugin marketplace remove game-studio-arcade` takes it out again. The installed plugin runs the code in `~/claude-home/game-studio-arcade` (main), so pull there to update it.

## Develop against a local copy of the service

```sh
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
node cabinet/service/bin/cabinet-service.js --data /tmp/cab --replay studio-kit/cli/fixtures/penguin-catch \
  --port 18330 --guest-port 18340 --manager-token "$(cat /tmp/token)"
ARCADE_URL=http://127.0.0.1:18330 ARCADE_TOKEN_FILE=/tmp/token claude --plugin-dir game-studio/plugin
```

## Tests

`npm test -w game-studio` type-checks, then runs these:

- The manifest, the MCP declaration, the skill, and the marketplace entry.
- The studio tools on real template carts, including a real playtest and the play server.
- The asset importer: PNG decoding, palette mapping, transparency, and a JPEG through `sips`.
- The bridge against a local service: a pull, a change, and a publish as a change, plus readable refusals.
- Both servers over stdio through `plugin/bin/run.mjs`, as Claude Code starts them.

The cabinet side's tests are `cabinet/service/test/arcade-mcp.test.js`: the protocol, each tool, lineage, the gate's refusals, and `/mcp`'s pairing. `claude plugin validate game-studio/plugin` and `claude plugin validate .` both pass.
