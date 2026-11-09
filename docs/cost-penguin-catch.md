# What Penguin Catch cost, step by step

The first live Studio build (`sesn_01UBPbematoWWGK1foPSzfo2`, 2026-11-08) cost 68¢ on Sonnet 5.5. This breaks that bill down from its recorded event stream and ranks the ways to lower it. No API calls were made. The redesign itself is not decided here.

## The answer

**What model?** Sonnet 5.5. The agent file sets no effort level, so it ran at the default.

**Is jamming context in at the start the most token-efficient approach?** No, and it's much more than "several thousand" tokens. The agent read 33,255 tokens of kit on top of a 7,461-token fixed start, so about 41k tokens sat in front of the work. That context cost **27¢, or 40% of the bill**, and 9¢ of that came from one cache expiry.

**But context is only part of it.** Writing cost more: **31¢ (45%)**. `checks.js` alone cost 14.6¢, more than twice `game.js` at 6.7¢.

**The biggest lever is the model, not the context.** The same tokens on Haiku 5.5 would cost about 4.5¢, against 68¢. Every token-saving change combined gets Sonnet to about 35–44¢. Haiku has never built a game here, so its quality is unknown, and that's what to test next.

| Where the 68¢ went | ¢ | Share |
|---|---:|---:|
| Context read in (fixed start, kit docs) | 18.4 | 27% |
| Cache expiry at the 10-minute wait | 8.9 | 13% |
| Writing (questions, thinking at req 8, spec, plan, game, checks) | 30.5 | 45% |
| Rework (sprite redraws 4.2, fix rounds 3.2) | 7.4 | 11% |
| Checking and packing up | 2.2 | 3% |
| Sandbox runtime | 0.6 | 1% |
| **Total** | **68.0** | |

## Prices and reconciliation

Prices were checked live on 2026-11-08 at <https://platform.claude.com/docs/en/about-claude/pricing> and <https://claude.com/pricing>, and the two pages agree. These are list prices per million tokens:

| Model | Input | 5-min cache write | 1-hour cache write | Cache read | Output |
|---|---:|---:|---:|---:|---:|
| Sonnet 5.5 | $2 | $2.50 | $4 | $0.10 | $10 |
| Haiku 5.5, prompts up to 100k | $0.10 | $0.125 | $0.20 | $0.01 | $0.50 |
| Haiku 5.5, prompts over 100k | $0.50 | $0.625 | $1 | $0.05 | $2.50 |
| Opus 5.5 | $4 | $5 | $8 | $0.20 | $20 |

Managed Agents adds $0.08 per session-hour while running, and no token surcharge.

The recomputed bill matches the logged `list_cost` of 68¢:

| Billing line | Tokens | ¢ |
|---|---:|---:|
| Output | 30,313 | 30.31 |
| Cache writes (5-min) | 110,101 | 27.53 |
| Cache reads | 955,184 | 9.55 |
| Uncached input | 46 | 0.01 |
| Runtime, 271.6 s | | 0.60 |
| **Total** | | **68.00** |

## How the numbers were measured

**Measured:** every `span.model_request_end` event carries that request's usage, so these figures are exact per request. They sum to the session totals, and each request's cache read equals the previous request's read plus its write.

**Derived exactly:** each request's write equals the previous request's output plus the tool results returned to it. That gives the exact token count of every tool result and shows that thinking stays in the cached prefix (request 6 wrote 231 = 217 output + 14 for the answer).

**Estimated:**
- **Thinking versus visible output.** Events hide thinking content, so visible tokens are estimated from the tool input size at 2.3–2.6 characters per token. Requests without thinking calibrate this: request 10 was 1,753 characters and 726 tokens.
- **Per-file tokens.** Each read's measured total is split across its files by character count, so a single file's figure could be off by about 15%.
- **All savings.** They are what-if recalculations on this one session.

This is one build of a simple game, so treat the shares as a first reading rather than an average.

**To re-run it:** `studio-kit/cli/scripts/cost-attribution.js` works on any recorded session and makes no API calls. It prints the per-request table, the billing lines and the total. `studio-kit/cli/test/cost-attribution.test.js` runs it on this fixture and checks the 68.00¢ total and the main figures here.

```sh
node studio-kit/cli/scripts/cost-attribution.js studio-kit/cli/fixtures/penguin-catch/events.jsonl
# A session that ran on another model, priced as recorded
node studio-kit/cli/scripts/cost-attribution.js <events.jsonl> --model haiku
# What-ifs: same tokens on another model, without the cache expiry, without given requests
node studio-kit/cli/scripts/cost-attribution.js <events.jsonl> --what-if --model haiku
node studio-kit/cli/scripts/cost-attribution.js <events.jsonl> --no-expiry --drop 16,17,18
```

Prices live in a table at the top of the script, so check them again before relying on a new run. Grouping requests into steps, per-file splits and the kit-size what-ifs were done by hand from its output.

## Every request

*Prefix* is everything sent on that request. *Written* and *re-read* are the cache lines. *Returned* is the tool output that came back afterwards. Times are UTC.

| # | Start | Step | Prefix | Written | Re-read | Output | Returned | ¢ |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | 02:52:19 | Unpack kit, read KIT.md | 7,461 | 7,461 | 0 | 203 | 965 | 2.07 |
| 2 | 02:52:22 | Read 4 READMEs | 8,629 | 1,168 | 7,461 | 117 | 7,944 | 0.48 |
| 3 | 02:52:23 | Read REFERENCE, recipes, spec guides (cut off) | 16,690 | 8,061 | 8,629 | 174 | 11,694 | 2.28 |
| 4 | 02:52:25 | Read the rest: checks format, dodge cart, test hook | 28,558 | 11,868 | 16,690 | 156 | 7,842 | 3.29 |
| 5 | 02:52:26 | Question 1 | 36,556 | 7,998 | 28,558 | 182 | 14 | 2.47 |
| 6 | 02:52:36 | Question 2 | 36,752 | 196 | 36,556 | 217 | 14 | 0.63 |
| 7 | 02:52:49 | Question 3 | 36,983 | 231 | 36,752 | 114 | 32 | 0.54 |
| 8 | **03:03:09** | **Cache gone.** Read cart.d.ts, palette | 37,129 | **37,129** | **0** | 1,409 | 4,810 | **10.69** |
| 9 | 03:03:23 | Write spec.md | 43,348 | 6,219 | 37,129 | 4,056 | 9 | 5.98 |
| 10 | 03:03:56 | show_plan | 47,413 | 4,065 | 43,348 | 726 | 40 | 2.18 |
| 11 | 03:04:16 | Write game.js, cart.json | 48,179 | 766 | 47,413 | 4,954 | 9 | 5.62 |
| 12 | 03:04:42 | Redo sprites | 53,142 | 4,963 | 48,179 | 1,745 | 351 | 3.47 |
| 13 | 03:04:55 | Redo sprites again | 55,238 | 2,096 | 53,142 | 758 | 239 | 1.81 |
| 14 | 03:05:00 | Redo penguin, validate | 56,235 | 997 | 55,238 | 486 | 88 | 1.29 |
| 15 | 03:05:06 | Write checks.js, first playtest | 56,809 | 574 | 56,235 | 11,046 | 408 | 11.75 |
| 16 | 03:06:21 | Fix round 1 | 68,263 | 11,454 | 56,809 | 1,250 | 69 | 4.68 |
| 17 | 03:06:31 | Fix round 2 | 69,582 | 1,319 | 68,263 | 623 | 229 | 1.64 |
| 18 | 03:06:36 | Fix round 3, all pass | 70,434 | 852 | 69,582 | 493 | 72 | 1.40 |
| 19 | 03:06:41 | Browser driver run, ls | 70,999 | 565 | 70,434 | 283 | 430 | 1.13 |
| 20 | 03:07:30 | Look at 2 screenshots | 71,712 | 713 | 70,999 | 139 | 204 | 1.03 |
| 21 | 03:07:32 | Pack up, report | 72,055 | 343 | 71,712 | 556 | 507 | 1.36 |
| 22 | 03:07:36 | Final message | 73,118 | 1,063 | 72,055 | 626 | | 1.61 |
| | | **Total** | | **110,101** | **955,184** | **30,313** | **35,970** | **67.40** |

Each request also has about 2 uncached input tokens, and the table's cost column includes them.

The final prefix of 73,118 tokens is 7,461 fixed start (10%), 35,970 tool output (49%) and 29,687 of the model's own output including thinking (41%).

## What a token costs

The price of a token depends on when it enters the prefix, because it's written once and then re-read on every later request. Early tokens are therefore re-read more often, but output is by far the most expensive.

| A token that is… | ¢ per 1,000 |
|---|---:|
| Read in at request 2 | 0.45 |
| Read in at request 2, when the cache later expires | 0.69 |
| Read back at request 20 | 0.27 |
| Written by the model at request 9 (output + carrying it) | 1.37 |
| Written by the model at request 15 | 1.31 |

Re-reading looks like the alarming number at 955k tokens, but it's only 9.6¢. By the end, each extra request costs 0.72¢ just to re-read the prefix.

## Attribution by step

This view charges each token its own output, write and re-read costs. It adds up to the bill, with the cache expiry as its own line.

| Step | Output | Tool output | Output ¢ | Carrying ¢ | Total ¢ |
|---|---:|---:|---:|---:|---:|
| Fixed start | | 7,461 | | 3.43 | 3.43 |
| Reading the kit, reqs 1–4 | 650 | 28,445 | 0.65 | 12.53 | 13.18 |
| 3 questions | 513 | 60 | 0.51 | 0.23 | 0.74 |
| Req 8: reading cart.d.ts, palette | | 4,810 | | 1.83 | 1.83 |
| Req 8: thinking | 1,409 | | 1.41 | 0.53 | 1.94 |
| Writing spec.md | 4,056 | 9 | 4.06 | 1.50 | 5.56 |
| show_plan | 726 | 40 | 0.73 | 0.28 | 1.00 |
| Writing game.js, cart.json | 4,954 | 9 | 4.95 | 1.74 | 6.69 |
| Sprite redraws, 3 requests | 2,989 | 678 | 2.99 | 1.23 | 4.21 |
| **Writing checks.js**, first playtest | 11,046 | 408 | 11.05 | 3.55 | **14.60** |
| Fix round 1 | 1,250 | 69 | 1.25 | 0.40 | 1.65 |
| Fix round 2 | 623 | 229 | 0.62 | 0.25 | 0.87 |
| Fix round 3 | 493 | 72 | 0.49 | 0.16 | 0.65 |
| Browser run | 283 | 430 | 0.28 | 0.19 | 0.48 |
| Screenshots | 139 | 204 | 0.14 | 0.09 | 0.23 |
| Pack up | 556 | 507 | 0.56 | 0.27 | 0.82 |
| Final message | 626 | | 0.63 | | 0.63 |
| Cache expiry at req 8 | | | | 8.88 | 8.88 |
| Uncached input | | | | | 0.01 |
| Runtime | | | | | 0.60 |
| **Total** | **30,313** | **43,431** | | | **68.00** |

Removing a step saves more than its line here, because the requests themselves also disappear. Removing the three fix rounds saves 5.2¢ rather than 3.2¢, since those three requests no longer re-read the prefix.

### Up-front context

The fixed start of 7,461 tokens splits roughly as below. The split is inferred from two earlier sessions that started with smaller prompts: the probe at 4,545 and the parity session at 5,578.

| Part | Tokens (approx.) |
|---|---:|
| Built-in tools and platform wrapper | up to 4,500 |
| The 3 custom tools | 1,000 |
| Studio brief (`agents/studio.md`) and the request | 2,000 |

The agent used only `bash` and `read` from the built-in tools. It made every file edit through bash and Python, and never called `write`, `edit`, `glob` or `grep`.

What it read from the kit:

| File | Req | Tokens | ¢ | ¢ with cache expiry share |
|---|---:|---:|---:|---:|
| `runtime/lib/REFERENCE.md` | 3 | 8,540 | 3.67 | 5.72 |
| `runtime/cart.d.ts` + `src/palette.js` | 8 | 4,810 | 1.83 | 1.83 |
| `runtime/README.md` | 2 | 3,834 | 1.69 | 2.61 |
| Dodge cart (`game.js`, `checks.js`, `spec.md`, `cart.json`) | 4 | 3,896 | 1.64 | 2.57 |
| `runtime/test-hook.d.ts` | 4 | 2,053 | 0.86 | 1.35 |
| `spec/checks-format.md` | 4 | 1,903 | 0.80 | 1.26 |
| `playtest/README.md` | 2 | 1,533 | 0.67 | 1.04 |
| `context-pack/RECIPES.md` | 3 | 1,402 | 0.60 | 0.94 |
| `spec/writing-rules.md` | 3 | 1,309 | 0.56 | 0.87 |
| `spec/README.md` | 2 | 1,248 | 0.55 | 0.85 |
| `KIT.md` and a listing | 1 | 965 | 0.43 | 0.66 |
| `context-pack/README.md` | 2 | 959 | 0.42 | 0.65 |
| `spec/template.md` | 3 | 393 | 0.17 | 0.26 |
| Listing of `studio-kit` | 2 | 370 | 0.16 | 0.25 |
| **All kit reads** (measured) | | **33,255** | **14.1** | **20.9** |

The file rows are apportioned and total 33,215. The small remainder is the truncation notice and rounding.

Three things stand out:
- **Most of REFERENCE.md wasn't needed.** This game used `collide`, `flow` and `score`. The `grid`, `timers` and `turns` sections, 63% of the file, weren't used, which is about 5,400 tokens and 2.3–3.6¢.
- **The agent read everything because we told it to.** `studio.md` says to read the context pack before designing, and `KIT.md` lists what to read first. So the agent was following instructions, not being careless.
- **D102's token estimate is low.** Real text ran at 2.0–2.6 characters per token, against D102's assumption of 4 for Markdown and 3.2 for code. Measured reads were 1.24–1.99× D102's formula. Its 15.0k pack estimate is probably about 22k real tokens (inferred, not measured directly).

Request 3 hit a limit of about 30,000 characters on bash output (`[294 lines truncated]`). This wasted little: request 4 read only what had been cut off, so nothing was read twice, and the cost was one extra request.

### The cache expiry

The 5-minute cache expired during a 10m19s wait for the third answer, so request 8 rewrote the whole 36,983-token prefix. It paid $2.50 per million instead of $0.10, which is **8.88¢**.

The first two answers took 8–10 seconds each. The third was the typed C answer, and the same gap also contains the dropped stream the driver recorded as `reconnected`. The event stream can't separate how much of the wait was each; `studio-kit/cli/README.md` attributes most of the wall time to the person answering. A kid thinking or fetching a sibling for 5 minutes would trigger the same thing, so the fix should assume it can happen.

The same wait at the plan screen would be worse. The prefix there is 48k, so an expiry costs 11.6¢.

A 1-hour cache isn't the answer, even if we could choose it. Writing all 73k tokens at $4 instead of $2.50 costs 11.0¢ more, which is more than the 8.9¢ it would save. I found no TTL setting on the pricing, agent-setup or skills pages.

### Tool output read back

| Output | Tokens | ¢ (carrying only) |
|---|---:|---:|
| Kit reads | 33,255 | 14.1 (+6.8 from the expiry) |
| Validate and playtest results | 1,227 | 0.36 |
| Sprite printouts | 590 | 0.20 |
| Printing the report before packing | 507 | 0.13 |
| Screenshots (2 images) | 204 | 0.05 |
| Player answers and plan response | 100 | 0.04 |
| Debug script | 69 | 0.02 |
| Empty results from file writes | 18 | 0.01 |

**92% of tool output is kit reads.** The playtest output is already quiet and costs almost nothing.

### Output written

| Written | Output tokens | Visible (est.) | Thinking (est.) |
|---|---:|---:|---:|
| `checks.js` (15,260 chars, 317 lines) | 11,046 | 6,300–7,100 | 3,900–4,700 |
| `game.js` (9,080 chars, 267 lines) | 4,954 | 3,800–4,300 | 700–1,200 |
| `spec.md` (3,814 chars) | 4,056 | 1,600–1,800 | 2,300–2,500 |
| Sprite redraws | 2,989 | 1,700–1,900 | 1,100–1,300 |
| Fix rounds | 2,366 | 900–1,000 | 1,300–1,400 |
| Thinking at req 8 | 1,409 | under 100 | about 1,300 |
| show_plan | 726 | 726 | none |
| Commands to read the kit | 650 | 650 | none |
| Questions | 513 | 300 | about 200 |
| Prose and pack-up, reqs 19–22 | 1,604 | 1,300–1,400 | about 300 |
| **Total** | **30,313** | **17,400–19,300** | **11,000–12,900** |

Thinking is about 36–43% of output and, with its carrying cost, about 16¢ of the bill. The test code is 1.7× the size of the game it tests. Prose is small: the final message was 626 tokens, and `studio.md` says the player never sees it.

### The fix rounds

The first playtest failed 5 of 11 auto rules. **All five were bugs in the agent's own `checks.js`.** The game's logic was never changed after the first playtest.

| Rule | The failure | The cause | Fixed in |
|---|---|---|---|
| R8 | Expected boot chance 0.35 at 3,000 frames, game said 0.4 | Check's arithmetic. The spec gives 15 + 5×5 = 40%, so the game was right | Round 1 |
| R9 | Expected a thing every 50 frames, game said 45 | Check's arithmetic. The spec gives 70 − 5×5 = 45, so the game was right | Round 1 |
| R7 | Expected 1.2 pixels per frame, measured 1.4 | A leftover `&& false` stopped the bot's stop condition from firing, so it played past the next level | Round 1 |
| R1 | Holding left gave speed 0 | The check's setup, a 300-frame hold to the right. Round 1's debug script showed the game responding correctly (speed −2.5), and shortening the hold to 90 frames fixed the check. The exact reason isn't recorded | Round 2 |
| R4 | Couldn't catch a boot | The bot chased boots and let fish land, so it ran out of lives | Round 3 |

The sprite redraws (requests 12–14) were a fourth round of rework that `fix_rounds` doesn't count. No test failure triggered them. The reasoning is hidden in thinking, but the code suggests trouble keeping rows the same width (`".0000055550000..".slice(0, 16)`).

## Savings, ranked

Savings are against the 68¢ actual, shown as with and without the cache expiry where that changes the figure. **They overlap, so they don't add up.** The combined line below is calculated together.

| # | Change | Saves (¢) | Confidence and risk |
|---:|---|---:|---|
| 1 | **Haiku 5.5 instead of Sonnet 5.5** | **~64** (same tokens: 4.5¢ total) | Price is certain; **quality is unknown**. No Haiku build exists. It could use 3× the tokens and still cost about 13¢, and prompts over 100k cost 5× more but remain cheaper than Sonnet. The risk is a worse game, not a bigger bill. |
| 2 | **Read less kit**: 33k down to 16k (24k: 4–6; 10k: 10–15) | 7–11 | Token maths is solid. Less guidance could mean more fix rounds, which could give some back. Needs real editing: see below. |
| 3 | **Ask questions before reading the kit** | 7.5 with an expiry, 0.8 without | Solid. Leaves only about 8.6k in the prefix during questions. The agent could ask weaker questions without knowing the kit, so it might need a line or two about what the runtime can do. |
| 4 | **Lower effort** (thinking down 25–50%) | 4–8 | Uncertain: how much thinking falls isn't known, and it might raise fix rounds. Settable per agent or session with `model.effort`. |
| 5 | **Fewer sprite redraws** (a row-width checker or sprite guide) | 3–6 | Moderate. This was one session's pattern, and all three redraws would need to go for the full 5.8. |
| 6 | **First-try pass on checks** | 5.2 | Moderate. It needs checks that are right the first time, and D44 doesn't remove the need for fix rounds. See the frozen-checks section. |
| 7 | **Smaller `checks.js`** (tested bot helpers, table-driven number checks) | 2.6–4.6 | Moderate. Assumes 2,000–3,500 fewer output tokens. Would probably also help #6. |
| 8 | **Tidier ending** (a pack script, a one-line finish, no screenshots) | 2.1 | Solid, though the screenshots may be worth keeping for about 1¢ (that request's cost, mostly re-reading the prefix). |
| 9 | **`game.js` template** | ~1.4 per 1,000 tokens saved | Moderate. `flow`, `score` and `collide` already reduce this. |
| 10 | **Allow only the tools it uses** | 0.5–1.5 | Size estimated. Low risk, though the agent may do edits worse without `edit`. |
| 11 | Quieter playtest summaries | 0.3 | Solid, and not worth doing. |
| 12 | Batching kit reads into fewer requests | 0.25 | Solid, and not worth doing. |

### What the kit could shrink to

Getting to about 16–20k tokens might look like this:

| Now | Tokens | Could become | Tokens |
|---|---:|---|---:|
| REFERENCE.md in full | 8,500 | Catalog of one line per function, plus only the sections a game needs | 3,000 |
| Type files, `cart.d.ts`, palette, test hook | 6,900 | One trimmed API sheet, palette as names | 3,500 |
| Runtime README | 3,800 | The essentials | 1,500 |
| Spec, playtest and pack READMEs | 3,700 | Commands in `KIT.md` | 1,000 |

The rest stays: the dodge cart, recipes, rule guides and checks format, about 8,000 tokens.

**A skill alone won't save this.** Skills load on demand, but a token read from a skill costs the same as one read with bash. The saving comes from reading less, so it needs the instructions and the files to change, whatever the packaging. Attaching the pack as a skill (the D40 experiment, now `studio make --context-pack skill` on the tasks 7+8 branch) would only matter if the agent then reads less.

### What's achievable

These combine changes 2, 5, 6, 7 and 8 and include runtime, using the 16k kit:

| Model | As built | With no cache expiry | Combined, cache expired | Combined, no expiry |
|---|---:|---:|---:|---:|
| Sonnet 5.5 | 68¢ | 59¢ | 44¢ | 38.5¢ |
| Haiku 5.5 | 4.5¢ | 4.0¢ | | 2.7¢ |
| Opus 5.5 | 135¢ | 118¢ | | 76¢ |

Lower effort might bring combined Sonnet down to about 35¢. Sonnet's real floor is probably 25–30¢, since about 12,000 tokens of spec, game and checks have to be written at $10 per million whatever else changes.

## Frozen checks

D44 (commit `0dafe2e` on the tasks 7+8 branch, not yet on main) freezes checks: they're written from the spec before any game code, and a failing check means fix the game. A check, even a simply buggy one, may change only after the agent changes the spec rule or adds an Assumption naming it, then calls `show_plan` again. Changes are logged, not blocked. This session ran before D44, so none of this was in force.

**Freezing doesn't by itself produce a first-try pass.** All five failures here were check bugs, and D44 still lets those be fixed, so the fix rounds would remain. D44 adds to their cost:
- **Each re-plan is another request.** At this point that's roughly 1¢: about 0.7¢ to re-read the prefix, plus the spec edit and `show_plan` output. This is an estimate.
- **Each re-plan can wait on the player.** Waiting over 5 minutes at this size would cost about 16¢ in cache rewrites.

The first-try saving of 5.2¢ therefore has to come from checks being right the first time, which is what writing checks before the game is meant to test. The next build's `first_playtest` and `checks_changed_after_playtest` records will show whether it helps.

All five bugs fit D44's route awkwardly. On R8 and R9 the spec's numbers were already right and the check's arithmetic was wrong, and on R1, R4 and R7 the bug was in the test's setup or bot, so no spec rule needs changing. The likely result is an Assumption added to justify a test fix, shown to a kid. That's worth watching in the logs rather than changing now.

## Suggested order

1. **Replay this fixture on Haiku 5.5** using `--answers`, ideally twice. It would cost about 5–15¢ per run and answers the biggest question. It needs Geoff's OK, since Phase 0 plans only Sonnet and Opus. If Haiku's game is good, most of the rest stops mattering: the whole list is worth under 2¢ there.
2. **Ask questions before reading the kit, and cut the kit reads**, on any model. Both protect against the wait a kid will sometimes cause.
3. **Improve check-writing**: tested bot helpers and number checks driven from the spec. On Sonnet that's the largest single step and all of the fix rounds.
4. **Then re-measure** on the same fixture, because this is one build of a simple game and Falling Blocks will behave differently.
