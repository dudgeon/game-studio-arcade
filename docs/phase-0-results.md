# Phase 0 results (draft for task 10)

**Draft.** These builds use an invented penguin game, not Falling Blocks. Task 10 still needs its Falling Blocks builds, with Geoff answering live and rating them. The quality notes here are Claude's reading of screenshots and code from a simple bot; nobody has played these on a screen or heard them.

## Summary

**Recommendation so far: Sonnet 5.5 as the default model,** now with the library fetched on demand: about 57¢ for this request before, 40¢ from a blank start, 29¢ from a template that fits ([The library redesign](#the-library-redesign-d160d166)).

- It's the best value in these builds: 57¢ for a game close to the Opus ones in polish. It also holds up across all four Sonnet builds so far (57–80¢).
- Opus 5.5 made the most polished games, and passed every auto rule on its first playtest, at 2.3–3.5 times the cost.
- Haiku 5.5 is very cheap when it stays small, but its games looked plainest, one had fish that don't look like fish, and it weakened two checks. Its price jumps 5× past 100k tokens: its two builds cost 9¢ and 44¢.
- Every build finished, passed its checks and stayed under the $3 cap. The highest was $1.98 (Opus).

Two builds per model is not enough to rank anything finely. It's enough to show the size of the differences.

## The library redesign (D160–D166)

Same penguin request, Sonnet 5.5, $3 cap, the D46 brief through `--brief-from-file`, recorded answers matched by question (D47). (a) and the skill run already existed; (b) and (c) are the two new builds, one each.

| | (a) Up-front bundle | Pack as skill (older run) | (b) Catalog + fetch, blank start | (c) Catalog + fetch + template |
|---|---|---|---|---|
| Session | `sesn_014bRzmzmgf22rcR87o2e2Uz` | `sesn_01Mt89MxLgQtq7L6Ezeqf3Jh` | `sesn_012FMNoz656cpCAHhELyyaWp` | `sesn_01Farh4Te3TDARPgbQVEGdKu` |
| Game | Penguin Fish Catch | Penguin Fish Catch | Penguin Catch | Penguin Fish Catch |
| **List cost (computed)** | **56.9¢** | **59.5¢** | **40.4¢** | **13.7¢** |
| Output / writes / reads / runtime, ¢ | 31.1 / 17.3 / 7.8 / 0.8 | 32.1 / 17.5 / 9.2 / 0.7 | 24.7 / 11.1 / 4.1 / 0.5 | 7.3 / 4.1 / 2.1 / 0.2 |
| Active time | 364 s | 296 s | 218 s | 94 s |
| Model requests | 18 | 19 | 17 | 12 |
| Prompt at the first question | 35,267 | 41,293 | 10,200 | 15,559 |
| **Peak prompt** (the 100k line) | 69,091 | 74,727 | 44,256 | 24,996 |
| Output tokens | 31,066 | 32,118 | 24,746 | 7,272 |
| Questions, ended by | 2, answers | 3, answers | 3, answers | 2, make it now (see below) |
| Recorded answers actually used | boot, harder | by position (older replay) | **move, boot, harder** | boot only |
| Rules (auto) | 13 (11) | 13 (11) | 15 (13) | 11 (10) |
| **Auto rules passing, first playtest** | 9 of 11 | 10 of 11 | 12 of 13 | **10 of 10** |
| Fix rounds (agent's report) | 2 | 1 | 1 | 0 |
| `game.js` edits after first playtest | 0 | 0 | 0 | 0 |
| Check bugs / rule changes / unexplained | 2 / 0 / 0 | 0 / 1 / 0 | 1 / 0 / 0 | 0 / 0 / 0 |
| Browser-driver runs | 2 | 1 | 1 | 1 |
| Validate, downloaded cart | ok | ok | ok | ok |
| Playtest, node, downloaded cart | all pass | all pass | all pass | all pass |
| `game.js` size | 7.2 KB | 10.4 KB | 8.2 KB | 5.5 KB |
| **`checks.js` size** | **13.3 KB** | **13.6 KB** | **10.0 KB** | **4.3 KB** |
| Library read before building | everything | everything | catalog, blank, 4 modules, guides | catalog, `catch`, `sprites`, part of `cart-api` |

The skill run is from before D46 and D47, under a brief that said to read everything, so it isn't a fair third design: it shows only that packaging alone saves nothing (D45). No skill was run under the fetch brief, because a token read from a skill costs what a token read with bash does.

**What the numbers say:**
- **Fetching on demand works.** With the same three-question depth and a bigger game than (a), (b) cost 29% less, and its peak prompt fell by a third. Before the first question its prompt was 10k rather than 35k, so a kid's long think now costs about 2.5¢ in cache rewrites rather than 9¢.
- **The bot helps, but one build can't prove how much.** (b) had one first-try failure and (c) none, against two in (a), and `checks.js` shrank by about a quarter in (b) and two-thirds in (c). (b)'s one failure was a real gap in the helper's docs: `t.bot.start()` has already run one frame of play. It's now documented.
- **No check was weakened.** (b)'s one check bug tests the same thing as before, and no `untested` words were needed. Both agents used `t.poke`; (b) also added its own `spawn` option to drop a thing above the penguin, while the catching itself is still real collision and R5 also chases fish for real.
- **Nobody came near the 100k line.**

**What the numbers hide: (c) built a simpler game, and that's a large part of its price.**
- **It's a reskin.** Its spec is the `catch` template with apples turned to fish and rocks to boots, and it says so. Its numbers are the template's.
- **It used only one of the player's three recorded answers.** Its second question, "How do the fish fall?", has no recorded answer, so the replay said D (D47), which stops the questions. So the penguin isn't slippery and boots don't get more common. (b) built both. A kid would have picked a tile and the questions would have gone on, so this is partly a replay effect, and a real (c) build would cost more than 13.7¢. How much more is unmeasured.
- **It also read the template before asking,** against the brief's "ask before reading anything more" (D165). Its questions may have been narrowed by what the template already did. One build can't show that.
- **It looks plainer** (contact sheets in `~/game-studio-data/library-comparison-2026-11-08/`). (c) has a clear penguin, fish and boot on a pale sky, text for lives, and things frozen in the air at game over. (b) has "+10", "MISS" and "OUCH" pop-ups, penguin icons for lives, and "NEW BEST!". (b)'s fish and boots are small against a dark sky, as in (a). These are readings from still frames; nobody has played them.
- **This is a best case for templates:** the request is exactly what `catch` does. A request no template fits would look like (b).

**Recommendation (D166, D169):** use the catalog and fetch on demand for every build; the 29% and the smaller prompt come with no visible loss. D166 held templates back until one honoured the kid's answers; the re-run below did, at 29.4¢, so use them when one fits.

One build each, and the games differ, so these are the size of the differences rather than exact prices. Sonnet builds of this request have ranged 57–80¢ under the old pack.

### Re-run: a template build that honours the answers (D167–D169)

D166's condition was that a template build must honour the kid's answers. So the brief now says to ask before opening any template, and that a template's rules are defaults the answers override, and the replay answers an unmatched question A rather than ending the questions (D168). Same request, Sonnet, $3 cap: `sesn_01W2pcfVneKYM4YUBbsnF3gT`, **Penguin Pond**, from `catch`.

| | (a) Up-front bundle | (b) Fetch, blank | (c) Template, first try | **(c2) Template, tightened brief** |
|---|---:|---:|---:|---:|
| **Cost, attributed** | 56.9¢ | 40.4¢ | 13.7¢ | **29.4¢** |
| Output / writes / reads / runtime, ¢ | 31.1 / 17.3 / 7.8 / 0.8 | 24.7 / 11.1 / 4.1 / 0.5 | 7.3 / 4.1 / 2.1 / 0.2 | 17.0 / 9.3 / 2.8 / 0.3 |
| Active time | 364 s | 218 s | 94 s | 153 s |
| Model requests | 18 | 17 | 12 | 14 |
| Prompt at first question | 35,267 | 10,200 | 15,559 | 10,500 |
| Peak prompt | 69,091 | 44,256 | 24,996 | 37,014 |
| Questions, ended by | 2, answers | 3, answers | 2, make it now | 3, answers |
| Rules (auto) | 13 (11) | 15 (13) | 11 (10) | 13 (11) |
| Auto rules passing, first playtest | 9 of 11 | 12 of 13 | 10 of 10 | **11 of 11** |
| Fix rounds; check bugs; rule changes | 2; 2; 0 | 1; 1; 0 | 0; 0; 0 | 0; 0; 0 |
| `game.js`, `checks.js` | 7.2, 13.3 KB | 8.2, 10.0 KB | 5.5, 4.3 KB | 6.1, 6.9 KB |
| Validate; node playtest; browser runs | ok; pass; 2 | ok; pass; 1 | ok; pass; 1 | ok; pass; 1 |

**Asked first:** all three questions came before it opened the template, and the fallback never fired (no `replay_fallback`).

**Did it honour the answers?** Yes for what it was told, measured by driving the real cart rather than from the spec or its own checks, with (c) as the control:

| Answer | Measured in (c2) | Same measure in (c) |
|---|---:|---:|
| "Really slippery like on ice": slide after letting go at full speed | 74 px over 52 frames | 0 px |
| Frames holding left before it turns round | 10 | 1 |
| First frame of holding right | 0.29 px | 3 px |
| "More boots": boots in frames 0–1200, then 4800–6000 | 4 of 21 (19%), then 15 of 43 (35%) | 4 of 23 (17%), then 4 of 24 (17%) |
| "More fish": things per 1200 frames, same two bands | 21, then 43 | 23, then 24 |
| "Catching a boot loses a life" | 1 life, no score change | 1 life, no score change |
| "Miss three fish and you lose" | game over at 3 landed | game over at 3 landed |

**Two qualifications:**
- **"Faster" didn't reach the agent.** The recording says "Faster and more boots", but the replay's match by meaning (D47) picked the tile "More fish and more boots". So things come more often and fall speed stays 1.5, written down as A3. (b) got the same tile and did the same. That's the replay, not the template, but a kid who meant faster falling wouldn't get it here.
- **It still looks like the template:** text for lives, no pop-ups, things frozen at game over, and small dark boots. The title sits partly under the big penguin, a small bug. (b) is more polished. These are readings from still frames. The test bot scored less here than on (b), which may just mean slippery is hard: R13, whether it's still steerable, needs a person.

**What it shows:** the template's saving is real once it's like for like: 29.4¢ against 40.4¢ for (b) and 56.9¢ for (a), with the same three answers honoured, no fix rounds and no check changes. The first try's 13.7¢ was mostly the cost of not building what was asked. It's still one build, on the request `catch` fits best. Measuring script and contact sheet: `~/game-studio-data/library-comparison-2026-11-08/`.

## The builds

All five built the same request on the same day, one at a time, with the D46 brief through `--brief-from-file` and the Step 5 answers replayed by question (D47).

> "I want a game where a penguin catches fish that fall from the sky, and if you miss three fish you lose, and sometimes a boot falls and you should NOT catch the boot"

| | Haiku 1 | Haiku 2 | Sonnet | Opus 1 | Opus 2 |
|---|---|---|---|---|---|
| Game | Fishy Penguin | Fish Catch | Penguin Fish Catch | Fishy Skies | Flipper Catch |
| **List cost (reported)** | 44¢ | 9¢ | 57¢ | 133¢ | 198¢ |
| Computed from the event stream | 43.69¢ | 8.74¢ | 56.91¢ | 133.10¢ | 197.92¢ |
| Active time | 585 s | 437 s | 364 s | 476 s | 733 s |
| Model requests | 51 | 37 | 18 | 31 | 44 |
| Peak prompt (tokens) | 162,335 | 100,753 | 69,093 | 73,076 | 95,494 |
| Questions | 2 | 2 | 2 | 3 | 3 |
| Ended by | answers | answers | answers | make it now | make it now |
| Rules (auto) | 14 (12) | 13 (11) | 13 (11) | 13 (10) | 12 (10) |
| **Auto rules passing, first playtest** | 9 of 12 | 8 of 11 | 9 of 11 | 10 of 10 | 10 of 10 |
| Failed first time | R5, R7, R8 | R5, R6, R11 | R2, R5 | none | none |
| Fix rounds (agent's report) | 2 | 3 | 2 | 2 | 4 |
| `game.js` edits after first playtest | 0 | 0 | 0 | 2 (sprites) | 2 (a sprite, R9) |
| `checks.js` edits after first playtest | 3 | 5 | 2 | 2 | 8 |
| Check bugs, rules declared | 7 | 8 | 3 | 4 | 3 |
| Check bugs, rules whose own check changed | 5 | 7 | 2 | 1 | 3 |
| Rule changes | 0 | 0 | 0 | 0 | 1 (R9) |
| Unexplained changes | 0 | 0 | 0 | 0 | 0 |
| Browser-driver runs | 1 | 3 | 2 | 2 | 5 |
| Validate, on the downloaded cart | ok | ok | ok | ok | ok |
| Playtest, node driver | all pass | all pass | all pass | all pass | all pass |
| Playtest, browser driver | all pass | all pass | all pass | all pass | all pass |
| `game.js` size | 5.5 KB | 5.6 KB | 7.2 KB | 8.8 KB | 9.0 KB |
| `checks.js` size | 15.0 KB | 14.4 KB | 13.3 KB | 14.3 KB | 14.4 KB |

"Declared" rules can exceed "changed" ones because a fix to a shared bot helper covers several rules, while that rule's own code stays the same.

Sessions, in order: `sesn_01MdoLsVdz8j8gzNr4tcsKgx`, `sesn_01Nd6YxycCNz626gRWoQYoJE`, `sesn_014bRzmzmgf22rcR87o2e2Uz`, `sesn_01Xdvq4PEJEx3sS6vN5Dadw1`, `sesn_01DV6scNXCnwKc4ERtzx18W4`. Each is in `~/game-studio-data/sessions/`, and its cart is in the dev cart library. Opus 1's first-playtest figure is from a correction record: the original log line missed it, because that agent printed results in its own format.

## Where the money went

Attributed from the event streams with the functions in `studio-kit/cli/scripts/cost-attribution.js`, in cents:

| | Haiku 1 | Haiku 2 | Sonnet | Opus 1 | Opus 2 |
|---|---|---|---|---|---|
| Output | 16.37 | 2.81 | 31.07 | 63.18 | 87.50 |
| Cache writes | 5.32 | 1.44 | 17.27 | 36.54 | 47.75 |
| Cache reads | 20.70 | 3.52 | 7.75 | 32.30 | 61.01 |
| Runtime | 1.30 | 0.97 | 0.81 | 1.06 | 1.63 |
| **Total** | 43.69 | 8.74 | 56.91 | 133.10 | 197.92 |

- **Reported and computed cost agree** to within half a cent on all five, which is the reported figure's rounding.
- **Haiku's over-100k price is what separates its two builds.** Past 100,000 prompt tokens Haiku 5.5 costs 5× as much per token. Haiku 1 made 29 of its 51 requests over that line; Haiku 2 made 3 of 37, peaking at 100,753. Without the line, Haiku 1 would have cost about 14¢. A longer Haiku build gets disproportionately dearer, and that can't be seen in advance.
- **Output dominates on Sonnet and Opus.** About half of Sonnet's bill is what it writes. Opus 2's extra cost over Opus 1 is its longer run: 44 requests, each re-reading the context.

## The games

Each cart was played headless for 60 seconds by a simple bot that steers toward falling things and restarts after game over. Contact sheets are in `~/game-studio-data/model-comparison-2026-11-08/`. All five ran title, play, game over and restart correctly, kept score and a best score, and got faster as the bot lasted longer.

| Game | Model | What it's like | Read |
|---|---|---|---|
| **Flipper Catch** | Opus | Bright sky and ice. A big penguin and "CATCH! / NO BOOTS!" on the title. "+10" pops up on a catch, and on a boot the penguin turns red and says "YUCK!". Hearts for lives, a game-over panel, "NEW BEST!". | The most polished. Feedback you could feel. |
| **Fishy Skies** | Opus | Bright blue, with its title teaching the rules with pictures. Game-over panel says "YOU CAUGHT 14 FISH", and the penguin gets X eyes. | Polished and clear. The score counts fish, not points. "BEST" on the title is low contrast. |
| **Penguin Fish Catch** | Sonnet | Dark sky, a large detailed penguin on the title, fish and boot labelled "CATCH!" and "NOT THESE!", hearts, a game-over panel with "NEW BEST!". | Close to the Opus games. Fish and boots are small and sit low-contrast against the sky at play size. |
| **Fishy Penguin** | Haiku | Dark screen, tiny penguin, no ice line, and a title with just the name, the best score and a blinking "PRESS START". "GAME OVER" is plain text with things still hanging in the air. A thing falls every 40 frames, the most often of the five (the others use 45 to 60), so it's crowded and the bot often died quickly. | Works, but bare, and looks harder than intended. |
| **Fish Catch** | Haiku | The same bare look with a thin floor. **The "fish" are grey dots.** | Works, but a kid would ask where the fish are. |

These are readings from still frames. Motion, sound, how the controls feel and whether it's fun can't be judged this way. That's what the you-check rules and Geoff's ratings are for.

## Check bugs and rule changes (D44, D46)

The D46 route worked as designed: every check change was declared, every quote was found in its rule, none was unexplained, and only one build went back to the plan (Opus 2, R9, a fairness rule). The kid wasn't interrupted for test mechanics.

**Almost every first-playtest failure was a test problem, not a game problem.** Reading the diffs and reasons, the failures came from test bots: they died before reaching a boot, ran past the 30 s browser limit, or counted a frame wrongly. No Haiku or Sonnet build changed `game.js` after its first playtest. Opus's edits were sprites, plus one real design fix: Opus 2 noticed that two fish could land too far apart for anyone to catch both, and added a rule for it through the plan. That's the only build that improved the game itself after testing. Checks are also bigger than the games (13–15 KB against 5–9 KB). A tested bot helper in the kit could remove much of this.

**The gap: a correct quote doesn't prove a fix kept the test's strength.** Reading each change against its rule:

- **Fishy Penguin (Haiku), R7 and R8: weakened.** R7 says "up to 3 pixels per frame" and R8 "up to 2 in 5", but the bot couldn't survive that long, so the checks dropped those points. The caps are no longer tested. The code does have them (`Math.min(3, …)`, `Math.min(40, …)`), so the game isn't wrong, but its tests no longer prove that part. Both are logged as check bugs with valid quotes.
- **Fishy Penguin, R5, R6, R7, R8, R12: softened.** These checks now pass if any of 6–8 seeds reaches the moment being tested.
- **Penguin Fish Catch (Sonnet), R8:** dropped two of eight points on the speed curve, but kept the start and the cap. Fine.
- **The others:** no weakening that I can see. Fish Catch's R8 changed from per-frame to per-batch with the same arithmetic. Flipper Catch's R9 got stronger.

So the log was honest, but "check bug" could still hide a test that proves less. Geoff has since decided this (D49): the agent must state which words a fixed check no longer tests, and those become you-check questions on first play. These five carts predate it and have no added questions.

## Replay by question (D47): how equal were these runs?

Closer than before, but still not the same game.

- **No build asked how the penguin moves,** so the recorded "really slippery like on ice" was never used. All five are ordinary movement, unlike Step 5's slippery penguin.
- **Both Opus builds asked about a bonus fish.** That has no recorded answer, so it got D ("make it now"), and they stopped asking. The bonus fish wasn't built. Opus asked three questions each, Haiku and Sonnet two.
- **Options differ, so answers often go through C** with the recorded words, as designed. All five got the boot and getting-harder answers.
- **The agents pick their own numbers,** so speeds and boot rates differ.

So cost and process compare fairly, and game details are similar rather than identical. A kid's answers would vary at least this much.

## What hasn't been measured

- **Falling Blocks.** Task 10's real comparison, with Geoff's live answers and his 1–5 rating ("would Alina play this?").
- **Anyone playing these.** The you-check rules are unanswered.
- **The Pi.** Frame times here are all well under budget off the Pi (node p95 under 0.1 ms, browser p95 0.8 ms), which says little about a Pi.
- **Repeatability.** Two builds per model, one for this Sonnet brief. Three more Sonnet builds under earlier briefs cost 68¢, 80¢ and 60¢.

## Per-build cap

$3 hasn't been reached. The highest so far is $1.98 (Opus); Sonnet's highest is 80¢. For a Sonnet default, a cap of **$1.50** would have allowed every Sonnet build so far with room to spare. It's worth setting only after the Falling Blocks builds, which may be harder.

## Spend so far

From the sessions recorded by the tasks 7+8 worker: these five came to $4.41. Adding Step 5 (68¢), the skill trial (80¢ and 60¢), the parity check (under 1¢) and the three library builds (83¢) makes about **$7.32**. The probe (about 0.3¢) and any other sessions are logged elsewhere. The Phase 0 ceiling is $25.
