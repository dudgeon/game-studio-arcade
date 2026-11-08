# game-studio-arcade

A basement arcade cabinet (Raspberry Pi 5) that builds its own games. **The Studio makes the games; the Arcade plays them.**

Start with the docs:

- [docs/HANDOFF.md](docs/HANDOFF.md): the full brief.
- [docs/decisions.md](docs/decisions.md): the decision log. It wins over the brief.
- [docs/platform-notes.md](docs/platform-notes.md): platform facts checked against live docs.
- [docs/phase-0.md](docs/phase-0.md): the current phase plan.
- [CLAUDE.md](CLAUDE.md): vocabulary, locked decisions and working agreements.

## Layout

- `runtime/`: the house runtime (a small JavaScript fantasy console). See [runtime/README.md](runtime/README.md).
- `studio-kit/*`: the studio kit (spec format, playtest harness, context pack, managed agent, CLI). Each folder is its own npm workspace.
- `scripts/`: setup scripts (API auth, D16).

## Develop

Node 22 only (D9). On the mini, put Homebrew's `node@22` first on `PATH`:

```sh
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
npm install
npm test        # type-check (tsc --checkJs) plus every workspace's node:test suite
npm run build   # type-check plus any workspace build steps; leaves git status clean
```

Unit tests use `node:test`, so nothing extra has to ship into the offline Managed Agents sandbox. Copy `.env.example` to `.env` for local settings; it holds no secrets.
