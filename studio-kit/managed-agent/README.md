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
ant apply --dry-run .     # look at the plan
ant apply .               # create or update; commit claude-lock.json afterwards
```

Re-running with no changes must show nothing to do (idempotent). A file renamed is a new resource; `--prune` archives the old one.

## Build the kit

```sh
npm run pack-kit -w studio-kit/managed-agent     # or: node studio-kit/cli/bin/studio.js kit
```

The kit includes `runtime/`, `studio-kit/spec`, `studio-kit/tools`, `studio-kit/playtest` and `studio-kit/context-pack`, minus tests and `node_modules`. `KIT.md` lists each part and the commands from its `package.json` `bin`, so **the spec, tools and playtest packages should declare their commands as `bin` entries** for the agent to find them. Parts that don't exist yet are listed under "Not in this kit yet".

The skill experiment: `node scripts/pack-kit.js --skill-dir skills-staged` stages the context pack as a custom skill (`skills-staged/studio-context-pack/SKILL.md`). To try it, add `skills: [../skills-staged/studio-context-pack]` to a copy of the agent file and apply it.

## What's tested offline

`npm test -w studio-kit/managed-agent`: type-check, the agent file's shape (web tools off, custom tool names and schemas, the §9.1 contract, prompt coverage), the environment (limited, no hosts), and the packager (contents, exclusions, stable hash, KIT.md commands).

## Still needs a live session

In order, once the director clears it (after task 1's probe):

1. `ant apply --dry-run .`, then `ant apply .`; commit `claude-lock.json`. Run `ant apply .` again and check it plans no changes.
2. Confirm `ant apply` accepts `./tools/*.json` under `tools`, and `allowed_hosts: []`.
3. `studio kit --upload` once the kit has its parts. Check the Files API accepts the tarball and the cache in `~/game-studio-data/kit-uploads.json` stops a second upload.
4. One capped session (`--budget-cents 50`) that extracts the kit and runs the playtest on a context-pack example cart (task 7's accept).
5. Check what the Files API reports for outputs: is `filename` the bare name (D42 assumes so), and how long do outputs lag behind the final idle?
6. Check `session.usage` arrives before the final idle and that the session object's `usage.list_cost` matches the Console.
7. Try the context pack as a skill instead of a tarball; keep whichever builds better (cost, first-try pass), and record it in `docs/decisions.md`.
