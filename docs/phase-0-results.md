# Phase 0 results (draft for task 10)

**Draft.** These builds use an invented penguin game, not Falling Blocks. Task 10 still needs its Falling Blocks builds, with Geoff answering live and rating them. The quality notes here are Claude's reading of screenshots and code from a simple bot; nobody has played these on a screen or heard them.

## Summary

**Recommendation so far: Sonnet 5.5 as the default model.**

- It's the best value in these builds: 57¢ for a game close to the Opus ones in polish. It also holds up across all four Sonnet builds so far (57–80¢).
- Opus 5.5 made the most polished games, and passed every auto rule on its first playtest, at 2.3–3.5 times the cost.
- Haiku 5.5 is very cheap when it stays small, but its games looked plainest, one had fish that don't look like fish, and it weakened two checks. Its price jumps 5× past 100k tokens: its two builds cost 9¢ and 44¢.
- Every build finished, passed its checks and stayed under the $3 cap. The highest was $1.98 (Opus).

Two builds per model is not enough to rank anything finely. It's enough to show the size of the differences.

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

So the log is honest, but "check bug" can still hide a test that proves less. Geoff or the director may want the agent to state which words of the rule are no longer tested, which would make this visible.

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

From the sessions recorded by the tasks 7+8 worker: these five came to $4.41. Adding Step 5 (68¢), the skill trial (80¢ and 60¢) and the parity check (under 1¢) makes about **$6.49**. The probe (about 0.3¢) and any other sessions are logged elsewhere. The Phase 0 ceiling is $25.
