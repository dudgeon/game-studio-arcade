# studio-kit/spec

The cart spec format (D1, D11, D30), the tools that read it, and `validate_cart` (D31).

| File | What it is |
|---|---|
| [template.md](template.md) | The `spec.md` every cart starts from. |
| [writing-rules.md](writing-rules.md) | How to write `(auto)` and `(you check)` rules, with good and bad examples. |
| [checks-format.md](checks-format.md) | The `checks.js` format and what `validate_cart` enforces. |
| `index.js` / `index.d.ts` | The parser, rule coverage and validateCart API. |
| `bin/gsa-spec.js` | A small CLI over the parser and rule coverage. |
| `bin/validate-cart.js` | `validate_cart`: cart.json, rule coverage, the D13 lint and the cart type check. |

## API

```js
import { parseSpec, formatSpec, rulesOf, validateRuleCoverage, validateCart } from '@game-studio-arcade/spec';

const spec = parseSpec(text);       // { title, byline, sections, rules, assumptions, changelog, errors, warnings }; never throws
formatSpec(spec);                   // canonical text; formatSpec(parseSpec(t)) === t for canonical t
rulesOf(text);                      // [{ id: 'R1', kind: 'auto' | 'you-check', text }]
await validateRuleCoverage(cartDir); // { ok, rules, checks, errors, warnings }: the rule-coverage part of validate_cart
await validateCart(cartDir);        // { ok, cart, rules, checks, errors, warnings }: all of validate_cart (D31)
```

`validateCart(dir, { types: false })` skips the tsc pass; by default a missing tsc is an error. Every issue has `file`, `line`, `check` (`coverage`, `cart.json`, `lint`, `types`) and `message`; `formatIssues(report)` gives one line each. The parts are exported too: `checkCartJson(text)`, `lintCartSource(src, {file})`, `typeCheckCart(dir, {files})`.

`checkCoverage(rules, checkIds)` is the pure comparison; `readCheckIds(path)` reads a `checks.js`'s keys in a restricted child process (see D30).

## CLI

```sh
node studio-kit/spec/bin/gsa-spec.js check  path/to/spec.md    # errors and warnings
node studio-kit/spec/bin/gsa-spec.js rules  path/to/spec.md    # rules as JSON
node studio-kit/spec/bin/gsa-spec.js format path/to/spec.md    # canonical form
node studio-kit/spec/bin/gsa-spec.js coverage path/to/cart/    # coverage report as JSON; exit 1 on errors

node studio-kit/spec/bin/validate-cart.js path/to/cart/         # one line per problem; exit 0 valid, 1 not, 2 usage
node studio-kit/spec/bin/validate-cart.js path/to/cart/ --json  # the full report
```

The type check needs `tsc`: the repo's `typescript` devDependency, or a global `tsc` on PATH (the sandbox has one, D18). Nothing is installed.

## Tests

`npm test` here (or at the root) type-checks and runs `node:test` over the template and the fixtures in `test/fixtures/` (`valid-cart/` is the cart that passes all of validate_cart; the tests break copies of it). No dependencies, so the package runs as-is in the offline sandbox.
