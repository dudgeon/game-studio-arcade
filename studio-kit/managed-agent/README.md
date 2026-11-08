# Studio agent (Claude Managed Agents)

The agent and environment that every Studio session runs, as an `ant apply` project (D40), plus the studio kit packager (D42).

```
agents/studio.md          the agent: frontmatter = config, body = the kid brief and workflow (system prompt)
agents/tools/*.json       custom tools ask_player, show_plan, tell_player (D41), inserted by glob
environments/studio.yaml  cloud sandbox, limited networking, no hosts
scripts/pack-kit.js       builds dist/studio-kit.tgz (+ KIT.md) from runtime/ and studio-kit/*
claude-lock.json          written by the first `ant apply`; commit it
```

## Apply

Run from **this directory**, so the lockfile lands here:

```sh
cd studio-kit/managed-agent
ant --profile game-studio-arcade apply --dry-run .   # look at the plan
ant --profile game-studio-arcade apply .             # create or update; commit claude-lock.json afterwards
```

Re-running with no changes must show nothing to do (idempotent). A file renamed is a new resource; `--prune` archives the old one.

## Build the kit

```sh
npm run pack-kit -w studio-kit/managed-agent     # or: node studio-kit/cli/bin/studio.js kit
```

The kit includes `runtime/`, `studio-kit/spec`, `studio-kit/tools`, `studio-kit/playtest` and `studio-kit/context-pack`, minus tests and `node_modules`. `KIT.md` lists each part and the commands from its `package.json` `bin`, so **the spec, tools and playtest packages should declare their commands as `bin` entries** for the agent to find them. Parts that don't exist yet are listed under "Not in this kit yet".

The skill experiment (D45; tarball won): `studio skill --upload` stages the context pack as a custom skill and creates it through the API, once, with its id in `claude-lock.skill.json`. `studio make --context-pack skill` attaches it and leaves the pack out of that session's kit.

## What's tested offline

`npm test -w studio-kit/managed-agent`: type-check, the agent file's shape (web tools off, custom tool names and schemas, the §9.1 contract, prompt coverage), the environment (limited, no hosts), and the packager (contents, exclusions, stable hash, KIT.md commands).

## Still needs a live session

In order, once the director clears it (after task 1's probe):

1. ~~`ant apply --dry-run .`, then `ant apply .`; commit `claude-lock.json`; re-apply plans no changes.~~ Done 2026-11-08: agent `agent_01GCfhH2MUfkwgaEJTbyGZQM` v1, environment `env_01GaCpCjFgzRACKrBmGRjVHv`. The re-apply reported "Everything is up to date, 2 unchanged".
2. ~~Confirm `ant apply` accepts `./tools/*.json` under `tools`, and `allowed_hosts: []`.~~ Done: the plan expanded all three tools, and the environment config went in as written.
3. ~~Kit upload.~~ Done 2026-11-08: kit `473db290a604` (57 files, without tools and the context pack, which don't exist yet) is `file_0138b8QAHdkVY5er1c44S3ss`, cached in `~/game-studio-data/kit-uploads.json`.
4. ~~One capped session that extracts the kit and playtests a cart.~~ Done with `parity/run-parity.js` on the playtest's `dot-catch` fixture (`sesn_0183yE1n3dd38YdPPA5WBRZU`, Haiku 5.5, 50¢ cap, 36 s). Both drivers passed and `comparable()` matched the mini exactly. Re-run it on a context-pack example once task 6 lands.
5. ~~Output filenames and lag.~~ Done: bare names; `DONE.json` complete about 7 s after idle. See platform-notes.
6. ~~Cost.~~ Done: `usage.list_cost` "0" against a recomputed 0.16¢. Comparing against the Console is still open.
7. ~~Try the context pack as a skill instead of a tarball.~~ Done 2026-11-08: tarball stays the default (D45).
8. `ant --profile game-studio-arcade apply .` from this directory, to make the D44 brief agent v2, and commit `claude-lock.json`. Waiting on the `ant` startup hang. Until then, run `studio make --brief-from-file`, or sessions get the old v1 brief.
