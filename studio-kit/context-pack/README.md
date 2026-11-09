# Context pack

What a Studio session can read to build a cart, arranged so it reads little (D160–D165). This file is for people; a session starts from `CATALOG.md`, which `pack-kit.js` puts into the kit's `KIT.md`.

- `CATALOG.md`: always read. One line per module and template, plus the house rules. Budget 2,000 tokens.
- `modules/`: guides read on demand (`cart-api`, `checks`, `sprites`, `spec`). Library modules are beside their code, in `runtime/lib/ref/`.
- `templates/`: `catch`, `dodge`, `maze`, `paddle`, and `blank`. Complete passing carts. None is a falling-blocks game (D12).
- `bin/pack-size.js`: what each file costs, with the ratio measured from real reads (D164). `npm run size -w @game-studio-arcade/context-pack`.

**To add a library module:** see `runtime/lib/REFERENCE.md`. **To add a template:** a folder here with `spec.md`, `cart.json`, `game.js`, `checks.js`, one line in the catalog, and a name in `test/pack.test.js`.
