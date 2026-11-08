# studio-kit/spec

The cart spec format (D1, D11, D30) and the tools that read it.

| File | What it is |
|---|---|
| [template.md](template.md) | The `spec.md` every cart starts from. |
| [writing-rules.md](writing-rules.md) | How to write `(auto)` and `(you check)` rules, with good and bad examples. |
| [checks-format.md](checks-format.md) | The `checks.js` format and what `validate_cart` enforces. |
| `index.js` / `index.d.ts` | The parser and rule-coverage API. |
| `bin/gsa-spec.js` | A small CLI over the same API. |

## API

```js
import { parseSpec, formatSpec, rulesOf, validateRuleCoverage } from '@game-studio-arcade/spec';

const spec = parseSpec(text);       // { title, byline, sections, rules, assumptions, changelog, errors, warnings }; never throws
formatSpec(spec);                   // canonical text; formatSpec(parseSpec(t)) === t for canonical t
rulesOf(text);                      // [{ id: 'R1', kind: 'auto' | 'you-check', text }]
await validateRuleCoverage(cartDir); // { ok, rules, checks, errors, warnings }: the rule-coverage part of validate_cart
```

`checkCoverage(rules, checkIds)` is the pure comparison; `readCheckIds(path)` reads a `checks.js`'s keys in a restricted child process (see D30).

## CLI

```sh
node studio-kit/spec/bin/gsa-spec.js check  path/to/spec.md    # errors and warnings
node studio-kit/spec/bin/gsa-spec.js rules  path/to/spec.md    # rules as JSON
node studio-kit/spec/bin/gsa-spec.js format path/to/spec.md    # canonical form
node studio-kit/spec/bin/gsa-spec.js coverage path/to/cart/    # coverage report as JSON; exit 1 on errors
```

## Tests

`npm test` here (or at the root) type-checks and runs `node:test` over the template and the fixtures in `test/fixtures/`. No dependencies, so the package runs as-is in the offline sandbox.
